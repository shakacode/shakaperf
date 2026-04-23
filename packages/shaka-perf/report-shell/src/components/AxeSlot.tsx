import { useState } from 'react';
import type {
  AxeArtifact,
  AxeScanArtifact,
  AxeViolationArtifact,
  AxeViolationNodeArtifact,
} from '../types';

const IMPACT_ORDER: Record<string, number> = {
  critical: 0,
  serious: 1,
  moderate: 2,
  minor: 3,
};

function sortViolations(violations: AxeViolationArtifact[]): AxeViolationArtifact[] {
  return [...violations].sort((a, b) => {
    const ia = a.impact ? IMPACT_ORDER[a.impact] ?? 9 : 9;
    const ib = b.impact ? IMPACT_ORDER[b.impact] ?? 9 : 9;
    if (ia !== ib) return ia - ib;
    return a.ruleId.localeCompare(b.ruleId);
  });
}

/**
 * Renders an axe target breadcrumb. A node's `target` is `Array<string|string[]>`:
 *   - a top-level string selects a DOM element,
 *   - a top-level `string[]` is a descent into an iframe or shadow-root
 *     (each entry is one nested selector).
 *
 * We join iframe/shadow descents with ` › ` and separate top-level segments
 * with ` ‹ ` so the order "outermost first" reads left-to-right.
 */
function TargetBreadcrumb({ target }: { target: AxeViolationNodeArtifact['target'] }) {
  const segments = target.map((seg, i) => {
    if (Array.isArray(seg)) {
      return (
        <span key={i} className="axe-target__segment axe-target__segment--nested">
          {seg.join(' › ')}
        </span>
      );
    }
    return (
      <span key={i} className="axe-target__segment">
        {seg}
      </span>
    );
  });
  return <div className="axe-target">{segments}</div>;
}

function AxeNode({ node }: { node: AxeViolationNodeArtifact }) {
  return (
    <div className="axe-node">
      <TargetBreadcrumb target={node.target} />
      {node.html ? <pre className="axe-node__html">{node.html}</pre> : null}
      {node.failureSummary ? (
        <pre className="axe-node__summary">{node.failureSummary}</pre>
      ) : null}
    </div>
  );
}

function ImpactChip({ impact }: { impact: AxeViolationArtifact['impact'] }) {
  const label = impact ?? 'unknown';
  return <span className={`axe-impact axe-impact--${label}`}>{label}</span>;
}

function ViolationRow({ violation }: { violation: AxeViolationArtifact }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`axe-violation${open ? ' axe-violation--open' : ''}`}>
      <button
        type="button"
        className="axe-violation__head"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="axe-violation__chevron">{open ? '▾' : '▸'}</span>
        <span className="axe-violation__rule">{violation.ruleId}</span>
        <ImpactChip impact={violation.impact} />
        <span className="axe-violation__count">
          {violation.nodes.length} node{violation.nodes.length === 1 ? '' : 's'}
        </span>
        <span className="axe-violation__help" title={violation.help}>
          {violation.help}
        </span>
      </button>
      {open ? (
        <div className="axe-violation__body">
          <a
            className="axe-violation__helpurl"
            href={violation.helpUrl}
            target="_blank"
            rel="noreferrer"
          >
            axe docs →
          </a>
          {violation.nodes.map((n, i) => (
            <AxeNode key={i} node={n} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ScanCard({ scan }: { scan: AxeScanArtifact }) {
  const count = scan.violations.length;
  const statusPill =
    count === 0 ? (
      <span className="axe-scan__status axe-scan__status--clean">clean</span>
    ) : (
      <span className="axe-scan__status axe-scan__status--violations">
        {count} violation{count === 1 ? '' : 's'}
      </span>
    );
  return (
    <div className="axe-scan" data-clean={count === 0 ? 'true' : 'false'}>
      <div className="axe-scan__head">
        <span className="axe-scan__viewport">{scan.viewportLabel}</span>
        {statusPill}
        <span className="axe-scan__url" title={scan.url}>
          {scan.url}
        </span>
      </div>
      {count > 0 ? (
        <div className="axe-scan__body">
          {sortViolations(scan.violations).map((v) => (
            <ViolationRow key={v.ruleId} violation={v} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * V2 report slot for accessibility scans. Rendered once per applicable test
 * by CategorySlot; suppressed entirely for tests that opted out via
 * `options.axe.skip` (see AXE_A11Y_REQUIREMENTS.md §3.10).
 */
export function AxeSlot({ axe }: { axe: AxeArtifact }) {
  if (axe.scans.length === 0) {
    return <div className="empty" style={{ padding: '20px 0' }}>no axe scans captured</div>;
  }
  return (
    <div className="axe">
      {axe.scans.map((scan) => (
        <ScanCard key={scan.viewportLabel} scan={scan} />
      ))}
    </div>
  );
}
