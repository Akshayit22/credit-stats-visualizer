# Where this build got to

Round 1 of the `BUILD-PROMPT.md` plan. **M0–M6 are done and committed — Round 1
is complete.** Everything below is the state as of the last commit.

Read `CLAUDE.md` first — it holds the conventions and the decisions taken along
the way. This file is the resume point and the list of what was deliberately
left out.

---

## Current state

```
git log --oneline
  <head>   feat(ship): docker image, gitlab ci, security note, readme            ← M6
  f71e08c  feat(llm): four providers plus mock, schema-validated extraction, …   ← M5
  c18376e  feat(dashboards): overview, card, savings and cashback screens …      ← M4
  419b8f5  feat(upload): end-to-end ingest, repositories, summaries, library      ← M3
  37a17b6  feat(parser): pdf extraction, redaction, two bank parsers, …           ← M2
  19c8caf  feat(auth): google sign-in, jwt session, user upsert, dev-login        ← M1
  89738f2  feat(skeleton): next.js app, dynamodb local, five tables, design …     ← M0
```

All four gates pass:

```bash
npm run lint && npm run typecheck && npm run test && npm run build
# 111 tests across 8 files, 0 failures
```

The Docker image builds, runs against DynamoDB Local, and reports `healthy`.

### To get running again

```bash
npm ci                 # postinstall re-copies the pdf.js worker into public/
npm run db:up          # DynamoDB Local :8000, dynamodb-admin :8001
npm run db:create      # creates the 5 tables if missing
npm run db:seed        # real figures from the 3 committed fixtures + demo months
npm run dev            # http://localhost:3000, signs in as the demo user
```

`samples/` must contain the three real PDFs for `npm run fixtures:build` to
work; it is gitignored, so on a fresh clone the committed `fixtures/*.txt` are
what the tests and the seed run on. Those are enough — nothing needs the PDFs
unless you are adding a bank.

---

## What was NOT done, and why

Round 1 scope, stated so nobody goes looking for it:

- **No cloud deploy.** `infra/tables.json` is CloudFormation-shaped and
  parameterised on `Env`, and `deploy:dev` in the pipeline is a manual job that
  echoes the intended steps. Nothing is provisioned.
- **No email, notifications, payments, sharing, mobile app, or Account
  Aggregator integration** — all explicitly out of Round 1. When billing
  arrives it belongs on the users table as extra `sk` items; the five-table
  limit is a design constraint, not an accident.
- **No rate limiting and no audit log.** Named in `SECURITY.md` under known
  limits rather than left implied.
- **Scanned or photographed statements are refused, not OCR'd.**
- **Screenshots are not committed.** `README.md` has the recipe — which page,
  which size, what each should show. Run it once the demo data is seeded.
- **Only two banks have a deterministic parser.** Everything else goes to the
  AI provider. `RUNBOOK.md` has the recipe for adding one.

### Worth doing next, in rough order

1. **Run the pipeline once on GitLab.** `.gitlab-ci.yml` is written to spec and
   its structure is checked, but it has never executed. The `dynamodb-local`
   service and the Kaniko job are the two parts most likely to need a nudge.
2. **Try a real provider end to end.** Everything has been exercised through
   the `mock` provider. Set a real `LLM_PROVIDER`, upload a statement from a
   third bank, and see whether the prompt in `src/server/llm/prompts.ts` is
   good enough. That is the one part of the system no test can vouch for.
3. **Repository tests against DynamoDB Local.** The fallback suite covers the
   write path incidentally; the two GSI query patterns deserve their own test.
4. **A third bank.** The parser registry was built for it and has never been
   exercised by a third case.

---

## Things a fresh session will want to know

### The three fixtures are real statements

`fixtures/*.txt` are **redacted** extractions of the author's own statements.
`samples/` (the PDFs) is gitignored and must stay that way. `npm run
fixtures:build` regenerates the fixtures and **refuses to write a file that
still carries an email, a UPI handle, a phone number, an IFSC code or an
account number** — `tests/privacy.test.ts` re-checks the committed files, so a
hole in `src/shared/redact.ts` fails the build rather than shipping.

Read the diff on `fixtures/` before committing it, every time.

### Verified figures — these are the numbers the tests pin

```
Axis super.money card, 17 May – 15 Jun 2026
  5,808.40 − 5,808.40 − 96.00 + 19,270.34 + 0.00 + 218.04 = 19,392.38   ✓
  15 rows · cashback earned 267.00 · cashback credited 96.00

slice savings, Aug 2026
  2,75,938.37 + 1,02,031.00 + 1,048.09 − 61,326.19 = 3,17,691.27        ✓
  49 rows

slice savings, Jul 2026
  2,30,150.08 + 1,16,800.00 + 860.74 − 71,900.00 = 2,75,910.82          ✓
  41 rows
```

### Four bugs the real data caught, and where they live

Each has a test; do not "simplify" these away.

1. **Wrapped-line seams.** slice hard-wraps a field mid-word, and redaction
   runs a line at a time, so a masked value's tail survives on the next line —
   `PRIYA RA` + `MACHANDRAN NAI-…` became `SELF` + `MACHANDRAN NAI-…`. Handled by
   `maskSpillLength` / `joinWrappedDetail` / `dropMaskSpill` in
   `src/shared/redact.ts`.
2. **UPI handles are not emails.** `priyanair395@oksbi` has no dot in the
   domain, so the email pattern missed it and the surname leaked. There is now
   a `VPA` pattern, and it must run **after** the IFSC pass — a VPA's local part
   can contain hyphens, so without IFSC already masked it runs left across
   `A-SBIN0004636-` and eats a counterparty's last letter.
3. **A card cycle is not a calendar month.** 17 May – 15 Jun means four of
   fifteen rows are dated in May. A statement's rows come from the transactions
   **gsi2** (`loadStatementRows`), and an account summary is per statement
   cycle, with `ALL#<period>` the sum of the account summaries.
4. **`XXXX9581` is not ₹9,581.** `parseAmountToMinor` rejects anything with a
   letter in it, apart from a trailing `Dr`/`Cr`.

### The chart palette was computed, not chosen

The design mockup's eight-blurple ring and its green-vs-red money-in/money-out
pair both fail colour-vision separation on this ground (the latter at ΔE 1.1
under deuteranopia — indistinguishable). `--series-1/2/3` in `app/globals.css`
are validated: lightness band, chroma floor, adjacent-pair CVD separation and
3:1 contrast all pass. **No chart plots more than three series.** The category
ring is a sequential single-hue ramp and its legend is also its filter, so
identity never rests on colour. Status colours are for tiles and text beside a
written label, never as a series set.

### Privacy claims that are actually enforced

`SECURITY.md` is now the home for these — what is never stored, exactly what
redaction removes, the three real leaks that were found and fixed, what the
logger refuses to accept, and the known limits. It is kept accurate on purpose:
if you change `src/shared/redact.ts` or `src/server/log.ts`, read it and check
it still holds.

### Two deliberate deviations from the build prompt

Both are recorded in `CLAUDE.md`, and both were judgement calls worth
re-examining rather than assuming:

- **Three fixtures, not two.** Both slice months were available, so the savings
  parser is tested against two real statements.
- **The holder's own name becomes `SELF`** in descriptions rather than being
  kept. It is PII we have no reason to hold, and `SELF` is more useful than the
  name — it marks a self-transfer.

### Verifying a screen visually

Headless Chrome clamps its viewport to a 500px minimum, so a 390px screenshot
is a 500px layout cropped — it will show overflow that is not there and hide
overflow that is. The 390px checks were done by loading the page in a 390px
iframe inside a 500px window. The recipe is in the M4 commit message; every
screen currently has zero horizontal overflow at 390px.
