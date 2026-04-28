/**
 * Shared shape of the per-test engine error payload that both perf and
 * visreg embed at the top of their per-test `report.json` files.
 *
 * - `engineError` is a short, single-line message for inline display
 *   (error banner text, status pills, CI log summaries).
 * - `engineOutput` is the full diagnostic transcript shown in the
 *   "view logs" dialog — stdout/stderr tail for perf, pair-by-pair
 *   error dump for visreg.
 *
 * Writing: perf writes via `foldEngineArtifactsIntoReport` in bench's
 * compare command; visreg writes via the reslicer in
 * `engine-bridge/visreg.ts`. Both put these fields at the TOP of the
 * per-test report.json (sibling to metrics / pair tests) so a single
 * read path picks them up.
 *
 * Reading: harvesters copy these into `CategoryResult.error` /
 * `CategoryResult.errorLog`, which the shared `SlotError` component
 * in `report-shell/src/components/CategorySlot.tsx` surfaces as a
 * clickable banner → engine-log dialog. Exactly one dialog component
 * for both engines by construction.
 */
export interface EngineErrorPayload {
  engineError?: string;
  engineOutput?: string;
}

/** Max bytes kept when folding large transcripts into report.json; avoids
 * multi-MB JSON reads in the harvester and multi-MB embeds in the final
 * single-file HTML report. Truncation is head-first so the tail (which
 * usually contains the actual failure) is preserved. */
export const MAX_ENGINE_OUTPUT_BYTES = 512 * 1024;

/** Truncate a transcript from the head while keeping its tail, prefixing a
 * marker so readers know content was elided. */
export function truncateEngineOutput(raw: string): string {
  if (raw.length <= MAX_ENGINE_OUTPUT_BYTES) return raw;
  const head = '[… truncated; earlier output dropped …]\n';
  return head + raw.slice(raw.length - MAX_ENGINE_OUTPUT_BYTES);
}

/**
 * Compose a unified engine-error payload from a short error string and a
 * longer transcript. Either or both may be null — returns an empty object
 * when neither is present so callers can spread into their per-test report
 * without littering the JSON with null fields.
 */
export function composeEngineErrorPayload(
  shortMessage: string | null,
  transcript: string | null,
): EngineErrorPayload {
  const payload: EngineErrorPayload = {};
  if (shortMessage) payload.engineError = shortMessage;
  if (transcript) payload.engineOutput = truncateEngineOutput(transcript);
  return payload;
}
