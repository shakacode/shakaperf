/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

export type CopyPromptKind = 'ai' | 'perf' | 'a11y';

export interface AiCopyPromptData {
  url: string;
  host: string;
  date: string;
  conditions?: string;
  coveragePct: number;
  rawWords: number;
  renderedWords: number;
  headings: number | string;
  links: number | string;
  textSample?: string;
  rawState: string;
}

export interface PerfCopyPromptData {
  url: string;
  host: string;
  date: string;
  viewportLabel: string;
  throttleProfile: string;
  lcpLabel: string;
  jsKb: number;
  jsFileCount: number;
  kbBeforeLcp?: number;
}

export interface A11yCopyPromptData {
  url: string;
  host: string;
  date: string;
  topRules: {
    ruleId: string;
    impact: string;
    selectors: string[];
    htmlExample?: string;
  }[];
}

export interface CopyPromptDataByKind {
  ai: AiCopyPromptData;
  perf: PerfCopyPromptData;
  a11y: A11yCopyPromptData;
}

export type CopyPromptData<K extends CopyPromptKind = CopyPromptKind> = CopyPromptDataByKind[K];

export const FRAMEWORK_WORDS = [
  'rails',
  'react',
  'next',
  'nextjs',
  'vue',
  'angular',
  'svelte',
  'webpack',
  'vite',
  'rspack',
  'shakapacker',
  'django',
  'laravel',
  'node',
  'express',
] as const;

export const MAX_PROMPT_WORDS = 180;

const DEFAULT_FENCE_CHARS = 140;
const DEFAULT_FENCE_WORDS = 18;
const HTML_EXAMPLE_CHARS = 200;
const HTML_EXAMPLE_WORDS = 28;

const FRAMEWORK_WORD_PATTERN = [
  'next[.\\s-]*js',
  'reactjs',
  'vuejs',
  'nodejs',
  ...FRAMEWORK_WORDS,
].join('|');
const frameworkPattern = new RegExp(`(^|[^a-z0-9])(${FRAMEWORK_WORD_PATTERN})(?=[^a-z0-9]|$)`, 'gi');

export function hasFrameworkWord(s: string): boolean {
  frameworkPattern.lastIndex = 0;
  return frameworkPattern.test(stripStructuralTokens(s));
}

export function fenceValue(raw: string, maxChars = DEFAULT_FENCE_CHARS, maxWords = DEFAULT_FENCE_WORDS): string {
  return fenceValueInternal(raw, maxChars, maxWords, true);
}

function fenceValueInternal(raw: string, maxChars: number, maxWords: number, redactFramework: boolean): string {
  const lines = raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .split(/[\r\n]+/)
    .map((line) => sanitizeLine(line))
    .filter(Boolean);
  const collapsed = lines.join(' ').replace(/\s+/g, ' ').trim();
  const instructionSafe = looksLikeInstruction(collapsed) ? '[redacted site-derived instruction]' : collapsed;
  const frameworkSafe = redactFramework ? instructionSafe.replace(frameworkPattern, (_match, prefix: string) => `${prefix}[stack]`) : instructionSafe;
  return capWords(capChars(frameworkSafe.replace(/"{3,}/g, "''"), maxChars), maxWords);
}

export function buildCopyPrompt(kind: 'ai', data: AiCopyPromptData): string | undefined;
export function buildCopyPrompt(kind: 'perf', data: PerfCopyPromptData): string | undefined;
export function buildCopyPrompt(kind: 'a11y', data: A11yCopyPromptData): string | undefined;
export function buildCopyPrompt(kind: CopyPromptKind, data: CopyPromptData): string | undefined {
  if (kind === 'ai') return buildAiPrompt(data as AiCopyPromptData);
  if (kind === 'perf') return buildPerfPrompt(data as PerfCopyPromptData);
  return buildA11yPrompt(data as A11yCopyPromptData);
}

function buildAiPrompt(data: AiCopyPromptData): string | undefined {
  const url = urlSlot(data.url);
  if (!url || !Number.isFinite(data.renderedWords) || data.renderedWords < 20 || !hasInput(data.rawState) || isBotWallState(data.rawState)) return undefined;

  const date = slot(data.date, 48, 5);
  const host = structuralSlot(data.host, 120, 3);
  const conditions = slot(data.conditions || 'raw HTML versus rendered page', 90, 10);
  const coverage = slot(`${formatNumber(data.coveragePct)}%`, 24, 1);
  const rawWords = slot(formatNumber(data.rawWords), 24, 1);
  const renderedWords = slot(formatNumber(data.renderedWords), 24, 1);
  const headings = slot(String(data.headings), 50, 4);
  const links = slot(String(data.links), 50, 4);
  const hasSample = hasInput(data.textSample);
  const sample = hasSample ? fenceValue(data.textSample || '', 110, 16) : '';
  const sampleIsExact = sample.length > 0 && !sample.includes('[redacted') && !sample.includes('[stack]');
  const verify = hasSample && sampleIsExact
    ? `Run curl -s -- ${shellArg(url)} | grep -F -- ${shellArg(sample)}; it should print that sentence after the fix, and prints nothing today.`
    : `Open view-source for ${url}; the main page text should appear in the HTML before browser code runs.`;

  return finalizePrompt([
    'AI crawlers fetch HTML but run 0% JavaScript, so client-rendered text is invisible to them.',
    '',
    `Measured on ${url} (${date}, ${conditions}):`,
    `- ${coverage} content coverage: ${rawWords} raw HTML words vs ${renderedWords} rendered words.`,
    `- Headings: ${headings}; links: ${links}.`,
    '',
    'Goal: Put the primary page text into the initial HTML so the same sentence is visible before browser code runs.',
    '',
    'Constraints:',
    '- Do not assume a framework or language - inspect this codebase and work within its existing setup.',
    '- Preserve the current visible content, navigation, headings, and links.',
    '- Prefer the smallest change that reaches the goal; the page must look and behave the same for human visitors.',
    '',
    'Verify:',
    `- ${verify}`,
    '',
    `Source: ShakaPerf audit of ${host}, ${date}.`,
  ]);
}

function buildPerfPrompt(data: PerfCopyPromptData): string | undefined {
  const url = urlSlot(data.url);
  if (!url || !hasInput(data.lcpLabel)) return undefined;

  const date = slot(data.date, 48, 5);
  const host = structuralSlot(data.host, 120, 3);
  const viewport = slot(data.viewportLabel, 80, 8);
  const throttle = slot(data.throttleProfile, 80, 8);
  const lcp = slot(data.lcpLabel, 48, 5);
  const jsKb = slot(formatNumber(data.jsKb), 24, 1);
  const jsFiles = slot(formatNumber(data.jsFileCount), 24, 1);
  const beforeLcp = data.kbBeforeLcp == null ? 'not isolated' : `${slot(formatNumber(data.kbBeforeLcp), 24, 1)} KB before LCP`;

  return finalizePrompt([
    'Heavy client-side JavaScript delays the main content on a mid-range phone.',
    '',
    `Measured on ${url} (${date}, ${viewport}, ${throttle}):`,
    `- Main content time: ${lcp}.`,
    `- JavaScript: ${jsKb} KB across ${jsFiles} files; ${beforeLcp}.`,
    '',
    'Goal: Make the main content appear in under 2.5s on the same phone profile.',
    '',
    'Constraints:',
    '- Do not assume a framework or language - inspect this codebase and work within its existing setup.',
    '- Reduce, defer, or split work that blocks the main content before it appears.',
    '- Prefer the smallest change that reaches the goal; the page must look and behave the same for human visitors.',
    '',
    'Verify:',
    '- Run PageSpeed Insights or re-measure LCP under the same profile; confirm LCP is below 2.5s.',
    '',
    `Source: ShakaPerf audit of ${host}, ${date}.`,
  ]);
}

function buildA11yPrompt(data: A11yCopyPromptData): string | undefined {
  const url = urlSlot(data.url);
  if (!url || !Array.isArray(data.topRules) || data.topRules.length === 0) return undefined;

  const top = data.topRules[0];
  const date = slot(data.date, 48, 5);
  const host = structuralSlot(data.host, 120, 3);
  const ruleId = slot(top.ruleId, 80, 4);
  const impact = slot(top.impact, 40, 3);
  const barrier = plainBarrier(top.ruleId);
  const selectors = (Array.isArray(top.selectors) ? top.selectors : []).slice(0, 2).map((selector) => slot(selector, 90, 4)).join('; ') || 'not listed';
  const example = hasInput(top.htmlExample) ? slot(top.htmlExample || '', HTML_EXAMPLE_CHARS, HTML_EXAMPLE_WORDS) : '';
  const exampleFact = example ? `- Example markup: ${example}.` : `- Selectors: ${selectors}.`;

  return finalizePrompt([
    `The top accessibility barrier is ${barrier}, so some visitors cannot understand or operate the page.`,
    '',
    `Measured on ${url} (${date}, automated accessibility scan):`,
    `- Top rule: ${ruleId} (${impact}); selectors: ${selectors}.`,
    exampleFact,
    '',
    `Goal: The listed ${barrier} issue passes while the page remains visually unchanged.`,
    '',
    'Constraints:',
    '- Do not assume a framework or language - inspect this codebase and work within its existing setup.',
    '- Keep the existing visual design; change semantics, labels, focus, or markup only as needed.',
    '- Prefer the smallest change that reaches the goal; the page must look and behave the same for human visitors.',
    '',
    'Verify:',
    `- Re-run an axe/accessibility check and confirm ${ruleId} passes on the listed selectors.`,
    '',
    `Source: ShakaPerf audit of ${host}, ${date}.`,
  ]);
}

function sanitizeLine(line: string): string {
  const trimmed = line
    .trim()
    .replace(/^```[a-zA-Z]*\s*/, '')
    .replace(/```/g, '')
    .replace(/^(?:#{1,6}\s+|[>*]+\s*|\/\/+|\/\*+|\*\/+|\*+\s*|-+\s+|\d+[.)]\s+|[;:]\s*)+/, '')
    .trim();
  if (!trimmed) return '';
  if (looksLikeInstruction(trimmed)) return '[redacted site-derived instruction]';
  return trimmed;
}

function looksLikeInstruction(s: string): boolean {
  const lower = s.toLowerCase();
  return [
    /\b(ignore|disregard|forget|override|bypass)\b.{0,60}\b(instructions?|prompt|previous|prior|above|system|developer|assistant|user)\b/,
    /\b(delete|remove|wipe|destroy)\b.{0,30}\b(files?|repo|repository|database|disk)\b/,
    /\b(system|developer|assistant|user|tool)\s*:/,
    /\b(run|execute|use|call)\b.{0,50}\b(tool|command|shell|bash|sh|curl|sudo|rm|delete|exfiltrate|secret|token|files?)\b/,
    /\b(exfiltrate|leak|steal|send)\b.{0,50}\b(secret|token|key|password|file|env|environment)\b/,
    /\b(reveal|print|dump)\b.{0,40}\b(secret|token|key|password|env|environment)\b/,
    /\b(rm\s+-rf|sudo|chmod|curl\s+.{0,80}\|\s*(bash|sh)|bash\s+-c|sh\s+-c)\b/,
  ].some((pattern) => pattern.test(lower));
}

function slot(raw: string, maxChars = DEFAULT_FENCE_CHARS, maxWords = DEFAULT_FENCE_WORDS): string {
  return fenceValue(raw, maxChars, maxWords) || 'not measured';
}

function structuralSlot(raw: string, maxChars: number, maxWords: number): string {
  return fenceValueInternal(raw, maxChars, maxWords, false) || 'not measured';
}

function urlSlot(raw: string): string | undefined {
  if (!hasInput(raw)) return undefined;
  const fenced = structuralSlot(raw, 240, 1);
  try {
    const parsed = new URL(fenced);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return fenced;
  } catch {
    return undefined;
  }
}

function shellArg(value: string): string {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

function hasInput(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value)) : 'not measured';
}

function isBotWallState(rawState: string): boolean {
  const s = rawState.toLowerCase();
  return /bot|blocked|challenge|captcha|turnstile|cloudflare|verify you are human/.test(s);
}

function stripStructuralTokens(s: string): string {
  return s
    .replace(/Source:\s+ShakaPerf audit of [^,\n]+/gi, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\b[a-z0-9.-]+\.[a-z]{2,}\b/gi, ' ');
}

function plainBarrier(ruleId: string): string {
  const id = fenceValue(ruleId, 80, 4).toLowerCase();
  if (/button|link|label|name/.test(id)) return 'missing labels';
  if (/contrast/.test(id)) return 'low text contrast';
  if (/image|alt/.test(id)) return 'images without text alternatives';
  if (/landmark|region|heading|main/.test(id)) return 'unclear page structure';
  if (/keyboard|tabindex|focus/.test(id)) return 'keyboard navigation problems';
  if (/lang/.test(id)) return 'missing page language';
  if (/refresh/.test(id)) return 'automatic page refresh';
  return 'a flagged accessibility issue';
}

function capChars(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return s.slice(0, Math.max(0, maxChars - 1)).trimEnd();
}

function capWords(s: string, maxWords: number): string {
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return s;
  return words.slice(0, maxWords).join(' ');
}

function finalizePrompt(lines: string[]): string {
  const prompt = lines.join('\n').trim();
  if (wordCount(prompt) > MAX_PROMPT_WORDS) {
    throw new Error(`copy prompt exceeded ${MAX_PROMPT_WORDS} words`);
  }
  if (hasFrameworkWord(prompt)) {
    throw new Error('copy prompt contained a framework word');
  }
  return prompt;
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}
