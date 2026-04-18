import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { SAMPLE_DATA } from './sample-data';
import type { ReportData } from './types';
import './styles.css';

function readReportData(): ReportData {
  const node = document.getElementById('__shaka_report_data__');
  if (!node || !node.textContent) return SAMPLE_DATA;
  try {
    const parsed = JSON.parse(node.textContent);
    if (parsed && parsed.tests && parsed.meta) return parsed as ReportData;
  } catch {
    // fall through
  }
  return SAMPLE_DATA;
}

const data = readReportData();
const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App data={data} />
    </StrictMode>,
  );
}
