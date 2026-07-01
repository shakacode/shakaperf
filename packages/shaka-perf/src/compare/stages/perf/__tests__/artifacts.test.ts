import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readPerfArtifact } from '../artifacts';

function metric(
  phaseName: string,
  estimatorDelta: string,
  isSignificant = true,
  controlValue = 100,
  experimentValue = 100,
) {
  return {
    heading: 'LH & Vitals',
    phaseName,
    isSignificant,
    estimatorDelta,
    pValue: 0.01,
    controlSevenFigureSummary: { '50': controlValue },
    experimentSevenFigureSummary: { '50': experimentValue },
    asPercent: { percentMedian: 1 },
  };
}

async function readMetrics(vitalsTableData: ReturnType<typeof metric>[]) {
  const perTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-perf-artifacts-test-'));
  fs.writeFileSync(
    path.join(perTestDir, 'report.json'),
    JSON.stringify({ vitalsTableData, diagnosticsTableData: [] }),
  );

  return readPerfArtifact({
    perTestDir,
    reportRoot: perTestDir,
    regressionThreshold: 50,
    saveArtifacts: false,
    statisticalAnalysis: true,
  });
}

describe('readPerfArtifact', () => {
  it('does not promote sub-threshold timing noise to a perf regression', async () => {
    const artifact = await readMetrics([
      metric('TTFB', '4ms'),
      metric('FCP', '55ms'),
    ]);

    expect(artifact.metrics?.find((entry) => entry.label === 'TTFB')?.direction).toBe('none');
    expect(artifact.metrics?.find((entry) => entry.label === 'FCP')?.direction).toBe('regression');
    expect(artifact.regressedMetrics).toEqual(['FCP']);
  });

  it('uses practical floors for non-timing metrics', async () => {
    const artifact = await readMetrics([
      metric('downloads', '0.5KB'),
      metric('js', '1.5KB'),
      metric('CLS', '1.1/100', true, 0.6, 2),
      metric('LH Score', '-2/100'),
      metric('downloads-count', '1'),
    ]);

    expect(artifact.metrics?.find((entry) => entry.label === 'downloads')?.direction).toBe('none');
    expect(artifact.metrics?.find((entry) => entry.label === 'CLS')?.direction).toBe('none');
    expect(artifact.regressedMetrics).toEqual(['js', 'LH Score', 'downloads-count']);
  });

  it('reports CLS regressions when they are practically meaningful', async () => {
    const artifact = await readMetrics([
      metric('CLS', '5.1/100', true, 0.6, 5.7),
      metric('CLS', '2/100', true, 9, 11),
    ]);

    expect(artifact.regressedMetrics).toEqual(['CLS', 'CLS']);
  });
});
