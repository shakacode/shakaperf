/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import {
  parseCsv,
  findLeadRow,
  renderSpintaxBase,
  renderMergeFields,
  extractEmailTemplate,
  assembleLeadFromCampaign,
} from '../campaign-lead';

const CSV = [
  'email,firstName,companyName,psiSubject,psiSummary,domain,person_title',
  'mitch@sunhub.com,Mitch,Sunhub,"Sunhub loads in 46.0s on mobile","Sunhub\'s home page takes 46 seconds, long enough that visitors leave.",sunhub.com,Chief Executive Officer',
  'dan@sharecare.com,Dan,Sharecare,"Sharecare loads in 5.9s on mobile","Sharecare\'s home page makes visitors wait.",sharecare.com,VP Engineering',
  'raja@sharecare.com,Raja,Sharecare,"Sharecare loads in 5.9s on mobile","Sharecare\'s home page makes visitors wait.",sharecare.com,Director',
].join('\r\n');

const TEMPLATE_MD = `# react-confident vN SPINTAX

## Subject (Email 1 only)
\`{{psiSubject}}\` - generated unique per domain. **Not spun.**

## Email 1 - spintax

\`\`\`
{{random | Hi | Hey}} {{firstName}},

{{psiSummary}}

{{random | You can get help from the maintainers of React on Rails (5.2k stars, since 2015). | You can get support from the maintainers of React on Rails (5.2k stars, since 2015).}}

Want {{companyName}}'s {{random | top bottlenecks and an optimization plan written up? | top bottlenecks plus an optimization plan written up?}} {{random | Reply and I'll send it - no charge, no obligation, no call. | Respond and I'll send it - no charge, no obligation, no call.}}

{{accountSignature}}
\`\`\`

## Email 2 - spintax

\`\`\`
{{random | Hi | Hey}} {{firstName}}, follow-up.
\`\`\`
`;

describe('parseCsv', () => {
  it('parses quoted fields with commas and CRLF records', () => {
    const rows = parseCsv(CSV);
    expect(rows).toHaveLength(3);
    expect(rows[0]['psiSummary']).toBe("Sunhub's home page takes 46 seconds, long enough that visitors leave.");
    expect(rows[0]['person_title']).toBe('Chief Executive Officer');
  });

  it('unescapes doubled quotes inside quoted fields', () => {
    const rows = parseCsv('a,b\n"say ""hi""",2');
    expect(rows[0]['a']).toBe('say "hi"');
  });

  it('throws on a header-only file', () => {
    expect(() => parseCsv('a,b\n')).toThrow(/no data rows/);
  });

  it('throws on an unclosed quoted field (truncated export)', () => {
    expect(() => parseCsv('email,firstName\njoe@acme.com,"unclosed')).toThrow(/unclosed quoted field/);
  });
});

describe('findLeadRow', () => {
  const rows = parseCsv(CSV);

  it('matches a domain regardless of www/protocol', () => {
    const { row } = findLeadRow(rows, { domain: 'https://www.sunhub.com' });
    expect(row['email']).toBe('mitch@sunhub.com');
  });

  it('throws with the candidate emails when a domain is ambiguous', () => {
    expect(() => findLeadRow(rows, { domain: 'sharecare.com' })).toThrow(/dan@sharecare\.com, raja@sharecare\.com/);
  });

  it('disambiguates by email and reports colleagues who got the same email', () => {
    const { row, sameCompanyRows } = findLeadRow(rows, { email: 'raja@sharecare.com' });
    expect(row['firstName']).toBe('Raja');
    expect(sameCompanyRows).toHaveLength(1);
    expect(sameCompanyRows[0]['email']).toBe('dan@sharecare.com');
  });

  it('throws when nothing matches', () => {
    expect(() => findLeadRow(rows, { domain: 'nope.com' })).toThrow(/No lead/);
  });

  it('falls back to the email domain when the CSV domain cell is blank', () => {
    // Enriched exports carry a `domain` header with a BLANK cell for un-enriched
    // rows; the lead must still be findable by --lead-domain via its email.
    const blank = parseCsv(['email,firstName,companyName,domain', 'joe@acme.com,Joe,Acme,', 'amy@other.com,Amy,Other,other.com'].join('\n'));
    const { row } = findLeadRow(blank, { domain: 'acme.com' });
    expect(row['email']).toBe('joe@acme.com');
  });
});

describe('renderSpintaxBase', () => {
  it('resolves every block to its first option', () => {
    expect(renderSpintaxBase('{{random | Hi | Hey}} there, {{random | reply | respond}}.')).toBe('Hi there, reply.');
  });

  it('leaves merge fields alone', () => {
    expect(renderSpintaxBase('{{random | Hi | Hey}} {{firstName}}')).toBe('Hi {{firstName}}');
  });
});

describe('renderMergeFields', () => {
  it('substitutes known fields', () => {
    expect(renderMergeFields('Hi {{firstName}} of {{companyName}}', { firstName: 'Mitch', companyName: 'Sunhub' })).toBe('Hi Mitch of Sunhub');
  });

  it('throws naming unresolved or empty fields', () => {
    expect(() => renderMergeFields('Hi {{firstName}}', { firstName: '' })).toThrow(/\{\{firstName\}\}/);
  });
});

describe('extractEmailTemplate', () => {
  it('pulls the Email 1 fence and the subject token', () => {
    const { subjectTemplate, bodyTemplate } = extractEmailTemplate(TEMPLATE_MD);
    expect(subjectTemplate).toBe('{{psiSubject}}');
    expect(bodyTemplate).toContain('{{psiSummary}}');
    expect(bodyTemplate).not.toContain('follow-up');
  });

  it('throws when there is no Email 1 heading', () => {
    expect(() => extractEmailTemplate('# nothing here')).toThrow(/Email 1/);
  });
});

describe('assembleLeadFromCampaign', () => {
  it('builds the full lead context with the reconstructed sent email', () => {
    const { leadContext, sentSubject, sentEmail } = assembleLeadFromCampaign({
      csvText: CSV,
      templateMd: TEMPLATE_MD,
      selector: { domain: 'sunhub.com' },
      replyText: 'Sure, send it over.',
      campaignName: '01-react-confident-243',
      sentFrom: 'justin@getshakacode.com',
    });
    expect(sentSubject).toBe('Sunhub loads in 46.0s on mobile');
    expect(sentEmail).toContain('Hi Mitch,');
    expect(sentEmail).toContain("Want Sunhub's top bottlenecks and an optimization plan written up? Reply and I'll send it - no charge, no obligation, no call.");
    expect(sentEmail).not.toContain('{{');
    expect(leadContext).toContain('sent_subject: "Sunhub loads in 46.0s on mobile"');
    expect(leadContext).toContain('text: "Sure, send it over."');
    expect(leadContext).toContain('sent_from: "justin@getshakacode.com"');
    expect(leadContext).toContain('  sent_email: |');
  });

  it('records same-company colleagues who got the same campaign email', () => {
    const { leadContext } = assembleLeadFromCampaign({
      csvText: CSV,
      templateMd: TEMPLATE_MD,
      selector: { email: 'raja@sharecare.com' },
      replyText: 'Sure.',
      campaignName: '01-react-confident-243',
    });
    expect(leadContext).toContain('others_at_company_emailed:');
    expect(leadContext).toContain('dan@sharecare.com');
  });
});
