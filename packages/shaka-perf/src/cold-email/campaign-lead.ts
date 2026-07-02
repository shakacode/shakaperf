/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Campaign mode for `shaka-perf cold-email`: assemble the lead context from
// the campaign's own artifacts instead of a hand-written lead file. The
// operator points at the campaign upload CSV (the merge-field source of truth
// for every sent email) and the locked spintax template; the tool
// reconstructs the exact base email that was sent (option 1 of every spintax
// block IS the frozen base wording) and builds the lead-context block the
// generator consumes. No human re-typing of campaign copy.

export type CampaignRow = Record<string, string>;

// Minimal RFC4180 reader: quoted fields, "" escapes, CRLF/LF records. The
// campaign CSVs carry commas inside quoted psiSummary fields, so a naive
// split-on-comma corrupts exactly the field this mode exists to use.
export function parseCsv(text: string): CampaignRow[] {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      record.push(field);
      field = '';
      records.push(record);
      record = [];
    } else {
      field += ch;
    }
  }
  if (inQuotes) {
    throw new Error('Campaign CSV has an unclosed quoted field (truncated export?). Re-export the CSV and try again.');
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  const rows = records.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ''));
  if (rows.length < 2) {
    throw new Error('Campaign CSV has no data rows (need a header line plus at least one lead).');
  }
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const row: CampaignRow = {};
    header.forEach((h, idx) => {
      row[h] = (r[idx] ?? '').trim();
    });
    return row;
  });
}

function normalizeDomain(s: string): string {
  return s
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .trim();
}

// A row's domain: the explicit `domain` column when present AND non-empty,
// otherwise the email's domain. Use `||`, not `??`: enriched campaign exports
// routinely carry a `domain` header whose cell is BLANK for un-enriched rows,
// and `??` (null/undefined only) would keep that empty string and never fall
// back to the email - making the lead unmatchable by --lead-domain and
// mis-grouping same-company rows under "".
function domainOfRow(r: CampaignRow): string {
  return normalizeDomain(r['domain'] || r['email']?.split('@')[1] || '');
}

export interface LeadSelector {
  domain?: string;
  email?: string;
}

export interface LeadMatch {
  row: CampaignRow;
  // Other leads in the same campaign at the same company - they received the
  // same email, and the reply draft should know who else saw it.
  sameCompanyRows: CampaignRow[];
}

// Pick exactly one lead. Domain match is www/protocol-insensitive; when one
// company has several leads, --lead-email disambiguates. Failing loud beats
// silently drafting a reply to the wrong person.
export function findLeadRow(rows: CampaignRow[], selector: LeadSelector): LeadMatch {
  const { domain, email } = selector;
  if (!domain && !email) {
    throw new Error('Pass --lead-domain or --lead-email to pick the lead from the campaign CSV.');
  }
  let candidates = rows;
  if (domain) {
    const want = normalizeDomain(domain);
    candidates = candidates.filter((r) => domainOfRow(r) === want);
  }
  if (email) {
    const want = email.toLowerCase();
    candidates = candidates.filter((r) => (r['email'] ?? '').toLowerCase() === want);
  }
  if (candidates.length === 0) {
    throw new Error(`No lead in the campaign CSV matches ${email ?? domain}.`);
  }
  if (candidates.length > 1) {
    const emails = candidates.map((r) => r['email'] || '(no email)').join(', ');
    throw new Error(`${candidates.length} leads match ${domain ?? email} (${emails}). Disambiguate with --lead-email.`);
  }
  const row = candidates[0];
  const rowDomain = domainOfRow(row);
  const sameCompanyRows = rows.filter(
    (r) => r !== row && domainOfRow(r) === rowDomain,
  );
  return { row, sameCompanyRows };
}

// Resolve every Instantly-style `{{random | a | b | c}}` block to its FIRST
// option: by template convention option 1 is the frozen base wording and
// every later option is a single-word deviation, so option 1 is the canonical
// "what we sent" reconstruction.
export function renderSpintaxBase(template: string): string {
  const rendered = template.replace(/\{\{\s*random\s*\|([^{}]*)\}\}/g, (_m, body: string) => body.split('|')[0].trim());
  if (/\{\{\s*random\b/.test(rendered)) {
    throw new Error('Template has a malformed or nested {{random | ...}} block - merge fields must never sit inside spintax.');
  }
  return rendered;
}

// Substitute `{{field}}` merge tokens from the CSV row. Unresolved tokens
// throw: a reconstruction with literal {{braces}} in it is not the email that
// was sent, and the model would faithfully quote the garbage back.
export function renderMergeFields(text: string, fields: Record<string, string>): string {
  const missing = new Set<string>();
  const rendered = text.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g, (_m, name: string) => {
    const v = fields[name];
    if (v === undefined || v === '') {
      missing.add(name);
      return _m;
    }
    return v;
  });
  if (missing.size > 0) {
    throw new Error(`Merge field(s) {{${[...missing].join('}}, {{')}}} are not in the CSV row (or are empty). Available: ${Object.keys(fields).join(', ')}.`);
  }
  return rendered;
}

export interface EmailTemplate {
  subjectTemplate: string;
  bodyTemplate: string;
}

// Pull Email 1 out of a spintax template markdown (the react-confident-vN
// format): the body is the first fenced code block under the "Email 1"
// heading; the subject is the first {{merge-field}} under the "Subject"
// heading, defaulting to {{psiSubject}} (the campaign convention).
export function extractEmailTemplate(md: string): EmailTemplate {
  const emailHeading = md.match(/^##[^\n]*Email 1[^\n]*$/im);
  if (!emailHeading || emailHeading.index === undefined) {
    throw new Error('Template markdown has no "## Email 1" heading - is this the campaign spintax file?');
  }
  const afterHeading = md.slice(emailHeading.index);
  const fence = afterHeading.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
  if (!fence) {
    throw new Error('No fenced code block under the "## Email 1" heading - the template body must live in a ``` fence.');
  }
  const bodyTemplate = fence[1].trim();

  let subjectTemplate = '{{psiSubject}}';
  const subjectHeading = md.match(/^##[^\n]*Subject[^\n]*$/im);
  if (subjectHeading && subjectHeading.index !== undefined) {
    const section = md.slice(subjectHeading.index, md.indexOf('\n## ', subjectHeading.index + 1) === -1 ? undefined : md.indexOf('\n## ', subjectHeading.index + 1));
    const token = section.match(/\{\{\s*[A-Za-z][A-Za-z0-9_]*\s*\}\}/);
    if (token) subjectTemplate = token[0];
  }
  return { subjectTemplate, bodyTemplate };
}

function yamlQuote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function indentBlock(s: string, pad: string): string {
  return s
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : pad + line))
    .join('\n');
}

export interface BuildLeadContextOptions {
  row: CampaignRow;
  sameCompanyRows: CampaignRow[];
  sentSubject: string;
  sentEmail: string;
  replyText: string;
  campaignName: string;
  sentFrom?: string;
}

// The assembled context mirrors the hand-written lead.yaml shape the
// generator was built against, so --lead files and campaign mode produce the
// same kind of prompt input.
export function buildLeadContext(opts: BuildLeadContextOptions): string {
  const { row, sameCompanyRows, sentSubject, sentEmail, replyText, campaignName, sentFrom } = opts;
  const domain = domainOfRow(row);
  const lines: string[] = [
    '# Lead context assembled by `shaka-perf cold-email` campaign mode.',
    '# Sent email = the campaign template\'s frozen base wording (option 1 of',
    '# every spintax block) + this lead\'s merge fields from the campaign CSV.',
    '',
    'lead:',
    `  contact_first_name: ${yamlQuote(row['firstName'] ?? '')}`,
    `  email: ${yamlQuote(row['email'] ?? '')}`,
  ];
  if (row['person_title']) lines.push(`  title: ${yamlQuote(row['person_title'])}`);
  lines.push(`  company: ${yamlQuote(row['companyName'] ?? '')}`);
  lines.push(`  site: ${yamlQuote(`https://${domain}`)}`);
  if (sameCompanyRows.length > 0) {
    const others = sameCompanyRows
      .map((r) => [r['firstName'], r['person_title'] ? `(${r['person_title']})` : '', r['email'] ? `<${r['email']}>` : ''].filter(Boolean).join(' '))
      .join('; ');
    lines.push(`  others_at_company_emailed: ${yamlQuote(others)}`);
  }
  lines.push('');
  lines.push('outreach:');
  lines.push(`  campaign: ${yamlQuote(campaignName)}`);
  if (sentFrom) lines.push(`  sent_from: ${yamlQuote(sentFrom)}`);
  lines.push(`  sent_subject: ${yamlQuote(sentSubject)}`);
  lines.push('  sent_email: |');
  lines.push(indentBlock(sentEmail, '    '));
  lines.push('');
  lines.push('reply:');
  lines.push(`  from: ${yamlQuote(row['email'] ?? '')}`);
  lines.push(`  text: ${yamlQuote(replyText)}`);
  lines.push('');
  lines.push('goal: deliver the promised writeup in full, build trust with honest numbers, leave one soft door open to a conversation');
  return lines.join('\n') + '\n';
}

export interface AssembleOptions {
  csvText: string;
  templateMd: string;
  selector: LeadSelector;
  replyText: string;
  campaignName: string;
  sentFrom?: string;
  // The literal text standing in for {{accountSignature}} in the
  // reconstruction. The real signature is added by the sending mailbox, so a
  // neutral marker keeps the reconstruction honest without inventing one.
  signatureText?: string;
}

export interface AssembledLead {
  leadContext: string;
  row: CampaignRow;
  sentSubject: string;
  sentEmail: string;
}

// One call from CSV + template to the generator-ready lead context.
export function assembleLeadFromCampaign(opts: AssembleOptions): AssembledLead {
  const rows = parseCsv(opts.csvText);
  const { row, sameCompanyRows } = findLeadRow(rows, opts.selector);
  const { subjectTemplate, bodyTemplate } = extractEmailTemplate(opts.templateMd);
  const fields: Record<string, string> = {
    ...row,
    accountSignature: opts.signatureText ?? '(the sending mailbox\'s signature block)',
  };
  const sentSubject = renderMergeFields(renderSpintaxBase(subjectTemplate), fields);
  const sentEmail = renderMergeFields(renderSpintaxBase(bodyTemplate), fields);
  const leadContext = buildLeadContext({
    row,
    sameCompanyRows,
    sentSubject,
    sentEmail,
    replyText: opts.replyText,
    campaignName: opts.campaignName,
    sentFrom: opts.sentFrom,
  });
  return { leadContext, row, sentSubject, sentEmail };
}
