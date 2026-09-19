# cred-stats

Statement analytics for India. Upload a credit card or savings account
statement PDF — password-protected is fine — and see where the money actually
went: month by month, by category, cashback earned against cashback credited,
fees and interest, and a year built from every month you have uploaded.

**The PDF never leaves your browser.** It is unlocked and read there, the
personal details are stripped, and only the extracted figures are sent anywhere.
There is no file to leak because no file is ever stored. See
[SECURITY.md](SECURITY.md) for what that means in practice and where it is
enforced.

---

## Run it in five minutes

No Google account, no AWS account, no API key.

```bash
npm ci
cp .env.example .env.local     # the defaults are already the local ones
npm run db:up                  # DynamoDB Local + dynamodb-admin, in Docker
npm run db:create              # creates the five tables
npm run db:seed                # demo data, parsed from real statements
npm run dev:nollm              # http://localhost:3000
```

`CRED_STATS_DEV_LOGIN=true` in `.env.local` signs you in as a demo user, so you
land straight on the dashboards. The bypass is refused whenever
`NODE_ENV=production`.

| | |
|---|---|
| <http://localhost:3000> | the app |
| <http://localhost:3000/api/health> | table and provider status |
| <http://localhost:8001> | dynamodb-admin — browse every item |

[SETUP.md](SETUP.md) is the full checklist, including where to get Google
sign-in credentials and an AI provider key when you want them.

---

## What it does

**Upload → parse → review.** `pdf.js` decrypts the file and reconstructs the
printed lines from the text items' positions, keeping the column structure.
Personal details are removed. The text — and only the text — is posted.

**Parse.** Two hand-written parsers cover the banks we have real statements
for; anything else falls back to an AI provider of your choosing. Either way the
output is validated against the same schema.

**Reconcile.** Every statement is checked against its own summary *and* against
the transactions we read from it. A savings statement is checked row by row
against its running balance column. A statement that does not add up is marked
`needs_review` with a sentence you can act on — never quietly wrong.

```
Axis super.money, 17 May – 15 Jun 2026
  5,808.40 − 5,808.40 − 96.00 + 19,270.34 + 0.00 + 218.04 = 19,392.38   ✓

slice savings, Aug 2026
  2,75,938.37 + 1,02,031.00 + 1,048.09 − 61,326.19 = 3,17,691.27        ✓
```

**Categorise**, in this order: a rule you wrote by recategorising a row, the
issuer's own merchant category column, a built-in merchant table, then the model
for whatever is left. Change a category once and it sticks for that merchant.

**Then the dashboards.** Overview, credit card, cashback and savings — month or
year, with a coverage note that tells you how many months a figure is actually
built from.

### Banks with a built-in parser

| Issuer | Product | Notes |
|---|---|---|
| Axis Bank | super.money RuPay Credit Card | Dr/Cr suffixes, issuer merchant categories, cashback earned vs credited |
| slice small finance bank | Savings account | Running balance, daily interest, UPI/IMPS description grammar |

Everything else goes to the AI provider. [RUNBOOK.md](RUNBOOK.md) has the recipe
for adding a bank — it is a fingerprint, a parser file, one line in a registry,
and a test.

---

## How it is built

- **One Next.js app.** App Router, React, TypeScript strict. The backend is
  route handlers plus `src/server/**` — there is no separate API service.
- **DynamoDB, five tables**, through the AWS SDK v3. Locally that is DynamoDB
  Local in Docker, on exactly the same code path; the only difference is whether
  `DDB_ENDPOINT` is set.
- **Pluggable AI provider** — Azure AI Foundry, Amazon Bedrock, Groq, or any
  OpenAI-compatible endpoint (xAI Grok, OpenAI, OpenRouter, Ollama). Chosen by
  one env var. A `mock` provider means the whole app, fallback path included,
  runs with no key at all.
- **Money is integer paise everywhere.** Never a float. `₹1,048.09` is `104809`
  until the moment it is rendered.

```
app/            routes and screens
src/server/     parsing, domain logic, repositories, providers   (server only)
src/client/     components, charts, the browser half of the pipeline
src/shared/     types, money, categories, redaction               (both sides)
fixtures/       redacted text from real statements — committed
samples/        the real PDFs — gitignored, and must stay that way
```

## Checks

```bash
npm run lint && npm run typecheck && npm run test && npm run build
```

101 tests. The parser suites run against redacted extracts of three real
statements, so they assert real figures rather than invented ones. The
repository and fallback suites run against DynamoDB Local when it is up, and
skip with a clear message when it is not.

## In a container

```bash
docker compose --profile app up --build
```

Or directly:

```bash
docker build -t cred-stats .
docker run --rm -p 3000:3000 --network cred-stats_default \
  -e DDB_ENDPOINT=http://dynamodb-local:8000 \
  -e DDB_TABLE_PREFIX=cred-stats-local \
  -e AWS_REGION=ap-south-1 \
  -e AWS_ACCESS_KEY_ID=local -e AWS_SECRET_ACCESS_KEY=local \
  -e AUTH_SECRET="$(openssl rand -base64 32)" \
  -e NEXTAUTH_URL=http://localhost:3000 \
  cred-stats
```

`.dockerignore` keeps `samples/` and every `.env*` out of the image — check that
first if you ever change it.

---

## Screenshots

The screenshots in this README are taken from the seeded demo data, so they are
reproducible and contain nothing personal.

```bash
npm run db:reset          # fresh tables + demo data
npm run dev:nollm
```

Then, with the app running and signed in as the demo user, capture at
**1440 × 1700** in a dark window:

| File | Page | What it should show |
|---|---|---|
| `docs/screenshots/overview.png` | `/overview` | the needs-review banner, four tiles, three trend charts, the accounts list |
| `docs/screenshots/card.png` | `/accounts/axis-bank-credit-card-9581?period=2026-06` | totals reconciled, the cycle chart, the category ring, 15 transactions |
| `docs/screenshots/savings.png` | `/savings/slice-small-finance-bank-savings-6993?period=2026-08` | the balance line, the interest tile, the folded-away interest note |
| `docs/screenshots/cashback.png` | `/accounts/axis-bank-credit-card-9581/cashback?period=2026-06` | earned vs credited, the per-transaction scatter, "earned nothing" |
| `docs/screenshots/library.png` | `/library` | parsed and needs-review badges, the privacy footer line |

For the responsive shot, note that headless Chrome clamps its viewport to a
500px minimum — a 390px screenshot is really a 500px layout cropped, which will
show overflow that is not there. Load the page in a 390px `<iframe>` inside a
500px window instead. The recipe is in the M4 commit message.

Before committing any screenshot, look at it: the demo data is derived from real
statements, and the point of using it is that the redaction has already run.

---

## Round 1 scope

In: Google sign-in, upload and parse, dashboards, the statement library, export,
delete everything.

Not in, deliberately: email and notifications, payments and billing, sharing
between users, a mobile app, Account Aggregator integration. When billing
arrives it belongs on the users table as extra `sk` items — the five-table limit
is a design constraint, not an accident.

## Documentation

| | |
|---|---|
| [SETUP.md](SETUP.md) | every environment variable and exactly where to get it |
| [RUNBOOK.md](RUNBOOK.md) | start, reset, test, add a bank, and the three failures you will actually hit |
| [SECURITY.md](SECURITY.md) | what is never stored, what redaction removes, and the known limits |
| [CLAUDE.md](CLAUDE.md) | conventions, and the decisions taken while building |
| [RESUME.md](RESUME.md) | where the build stands and what is left |
