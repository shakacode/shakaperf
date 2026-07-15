import { parseReportData } from '../../report-shell/src/report-data';

describe('parseReportData', () => {
  it('accepts an ordinary report payload', () => {
    expect(parseReportData(JSON.stringify({ meta: {}, tests: [] }))).toMatchObject({
      meta: {},
      tests: [],
    });
  });

  it('accepts a structurally valid bisect payload', () => {
    expect(parseReportData(JSON.stringify({
      meta: {},
      tests: [],
      bisect: {
        status: 'complete',
        goodSha: 'good',
        badSha: 'bad',
        generatedAt: '2026-07-13T00:00:00.000Z',
        commits: [],
        targets: [],
        targetsById: {},
        views: {
          unresolved: { targetIds: [] },
          invalid: { targetIds: [] },
        },
      },
    }))).not.toBeNull();
  });

  it('rejects malformed bisect data instead of crashing the report shell', () => {
    expect(parseReportData(JSON.stringify({
      meta: {},
      tests: [],
      bisect: {
        status: 'complete',
        commits: 'not-an-array',
      },
    }))).toBeNull();
  });
});
