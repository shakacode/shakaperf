# Cold email reply (the promised writeup)

The cold-outreach sibling of `warm-email` (see README-warm-email.md for the
two-renderer model and the audit inputs both commands share). The scenario it
serves: an Instantly campaign email promised the prospect "your top bottlenecks
and an optimization plan written up - no charge, no obligation, no call"; the
prospect replied. This command drafts the threaded reply that DELIVERS that
promise, with the client-facing report attached.

```bash
shaka-perf cold-email --results ./audit-results --lead ./lead.yaml [--model sonnet] [--out path]
```

Like `warm-email`, it runs over a SAVED audit-results directory (the output of
`shaka-perf audit`), synthesizes the cross-page picture, renders
`client-report.html` (the attachment IS the writeup), and asks the `claude` CLI
to draft the reply. Output is a markdown draft (default
`<results>/../cold-email-draft.md`) with LEAD / DETAILS / SUBJECT / BODY /
ATTACH sections. It is a draft by design: review it, then send the BODY as a
reply in the SAME email thread and attach the report.

## Built-in polish pass (default on)

After generation the draft goes through an in-tool critique/revise loop
(`src/email-polish/polish.ts`), the same pass for every operator on every
machine - no external skill or operator judgment involved. It mirrors the
operator-side polish-loop this replaces:

- TWO PANEL PHASES, in sequence. Phase 1 is the PROFESSIONAL panel: a
  direct-response copywriter, a cold-outreach SOP reviewer, and a fact + rule
  auditor. Phase 2 is the CLIENT panel: the recipient (the busy operator who
  asked), a skeptical buyer, and a non-technical reader. Each critic is its
  OWN sub-agent call with a single-role mandate; the three critics of a round
  run in parallel.
- Each critic answers `VERDICT: SHIP` or a numbered fix list with every fix
  tagged HIGH or MINOR. The round merges the panel's HIGH fixes into one
  revise pass; MINOR-only suggestions are dropped by design (the over-polish
  guard). A phase converges the moment a round raises no high-priority fixes,
  with `--polish-rounds` (default 3) as the per-phase safety cap.
- Rounds ALTERNATE models within a phase - round 1 Opus, round 2 Sonnet,
  round 3 Opus, ... - two different judges catch different problems.
- A CROSS-VENDOR CODEX GATE then reviews the result ONCE with the OpenAI
  `codex` CLI (read-only sandbox, text review only); its fixes get exactly one
  final revise pass. If the codex CLI is not installed, the gate is skipped
  with a console warning - the claude phases still ran. There is no
  cross-model verification of each other's verdicts (that pattern belongs to
  code review, not copy polish).

A revision that loses the draft structure ends the phase with the last good
draft; a failed critic call is skipped without losing the round; a failed
revise call ends the phases and the draft so far still gets the codex pass.
`--no-polish` skips the whole pass (debugging / cost control). Both
`cold-email` and `warm-email` run this identically.

## What makes the reply different from a warm email

- It is a THREADED REPLY: subject = `Re:` + the exact subject the campaign sent
  (taken from the lead file), never a new subject.
- It must deliver, not sell: top bottlenecks as 2-4 plain-language bullets
  (page + what a phone visitor experiences + the number), then the order we
  would tackle them in. WHERE and WHY only - never HOW, never fix-size claims,
  never the word "rebuild". The fix is the conversation that follows.
- Number consistency: the campaign email quoted one number from an earlier
  check (PSI). The audit is presented as the promised deeper full-site run; the
  draft never contradicts or apologizes for the quoted number. If the fresh run
  reads healthy, the draft says so honestly instead of manufacturing a problem.
- The close honors the "no obligation, no call" promise: one soft optional
  door, easy out, no calendar link.
- Signs off as "ShakaCode". The actual reply goes out from whichever mailbox
  sent the campaign email (Instantly unibox), so swap in that sender's
  signature when sending.

## The lead file (--lead)

Free-form yaml/markdown/text, read verbatim into the prompt. It must carry
three things: who the prospect is, the EXACT email we sent them (subject +
body as rendered with their merge fields), and what they replied. Example:

```yaml
lead:
  contact_first_name: Joe
  full_name: Joe Armiger
  email: joe@example.com
  title: Owner - MD
  company: Acme
  site: https://example.com
outreach:
  campaign: 01-react-confident (Instantly)
  sent_subject: "Acme loads in 9.1s on mobile"
  sent_email: |
    Hi Joe,

    Acme's home page takes 9.1 seconds on mobile before anything useful
    appears, and most visitors on a phone give up well before then.

    You can get help from the maintainers of React on Rails (5.2k stars,
    since 2015).

    Most of this is fixable without a rebuild.

    Want Acme's top bottlenecks and an optimization plan written up?
    Reply and I'll send it - no charge, no obligation, no call.
  promised: "top bottlenecks + an optimization plan written up, no charge, no obligation, no call"
reply:
  text: "Sure, send it over."
goal: "deliver the promised writeup, build trust, leave one soft door open"
```

## Campaign mode (the tool reconstructs the sent email itself)

Instead of hand-writing the lead file, point the command at the campaign's own
artifacts and it assembles the context itself - no human re-typing of campaign
copy:

```bash
shaka-perf cold-email --results ./audit-results \
  --campaign-csv  <campaign upload>.csv \
  --campaign-template react-confident-vN-spintax.md \
  --lead-domain example.com \
  --reply-text "Sure, send it over." \
  --sent-from justin@getshakacode.com
```

What it does:

- Reads the lead row from the campaign upload CSV (the merge-field source of
  truth: `email`, `firstName`, `companyName`, `psiSubject`, `psiSummary`,
  `person_title`, `domain`). `--lead-domain` matches www/protocol-insensitively;
  when several leads share a company, disambiguate with `--lead-email` (the
  error lists the candidates). Colleagues who got the same email are recorded
  in the context as `others_at_company_emailed`.
- Reconstructs the EXACT sent email from the spintax template markdown: the
  subject token under the `## Subject` heading (default `{{psiSubject}}`) and
  the first fenced block under `## Email 1`, resolving every
  `{{random | a | b}}` block to option 1 (by template convention option 1 IS
  the frozen base wording) and substituting the lead's merge fields.
  Unresolved merge fields fail the run loudly.
- Writes the assembled context next to the draft as
  `lead-context.generated.yaml` - review what the model was fed, or reuse it
  later as a plain `--lead` file.

`--lead` and the campaign flags are mutually exclusive: the lead file stays
the right tool for replies that need hand-curated context (a real quoted
thread, extra relationship notes).

## End-to-end: from a prospect reply to a ready draft

```bash
# 0. one-time: build + install the current branch globally
cd <shakaperf repo> && yarn install && yarn build && yarn install-global-script

# 1. per-site folder (copy an existing one, e.g. thinkd2.com, as the template)
mkdir <site>/ && cd <site>/
#    - package.json depending on shaka-perf + shaka-shared, npm install
#    - abtests.config.ts: Slow-4G + devtools throttling, phone viewport,
#      parallelism 1 (see the thinkd2.com config comments)
#    - ab-tests/*.abtest.ts: one representative page per page type
#    Extremely slow sites (PSI LCP 30s+, e.g. sunhub.com): set BOTH
#      maxWaitForLoad: 90_000 and maxWaitForFcp: 90_000 in the lighthouse
#      config - Lighthouse's default 30s FCP wait otherwise aborts every run
#      with NO_FCP. Sites whose third-party network never idles (chat widgets,
#      analytics): wrap the abtest's waitUntilPageSettled in try/catch - the
#      Lighthouse pass measures load independently, and a 60s networkidle
#      timeout should not fail the audit. annotate() is capped at 50 chars.

# 2. audit the live site (writes ./audit-results)
shaka-perf audit --url https://<site>

# 3 + 4. draft the reply + render the attachable report. Campaign mode (above)
#    assembles the lead context itself from the campaign CSV + template:
shaka-perf cold-email --results ./audit-results \
  --campaign-csv <campaign>.csv --campaign-template <template>.md \
  --lead-domain <site> --reply-text "<their reply>"
#    ...or hand-write lead.yaml (schema above) and pass --lead ./lead.yaml

# 5. review cold-email-draft.md, send the BODY as a reply in the same thread
#    (Instantly unibox), attach audit-results/client-report.html
```

Flags shared with `warm-email`: `--model` (default `sonnet`), `--out`,
`--report <filename>` (which report ATTACH points at), `--print-prompt`
(dump the generation prompt to stderr; printed before the claude call so it
works when generation fails too).

## Module layout

`src/cold-email/`: `generate.ts` (the reply prompt + claude call),
`campaign-lead.ts` (campaign mode: CSV row pick, spintax base render,
merge-field substitution, lead-context assembly), `program.ts` (CLI command).
Site synthesis and the client report renderer are shared with warm-email
(`src/warm-email/synthesis.ts`, `client-report.ts`). Unit tests:
`src/cold-email/__tests__/generate.test.ts` and `campaign-lead.test.ts`.
