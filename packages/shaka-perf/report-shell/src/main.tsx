import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import type { ReportData } from './types';
import './styles.css';

function readReportData(): ReportData | null {
  const node = document.getElementById('__shaka_report_data__');
  if (!node || !node.textContent) return null;
  try {
    const parsed = JSON.parse(node.textContent);
    if (parsed && parsed.tests && parsed.meta) return parsed as ReportData;
  } catch {
    // fall through
  }
  return null;
}

const data = readReportData();
const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      {data ? <App data={data} /> : <div className="empty">no report data</div>}
    </StrictMode>,
  );
}
