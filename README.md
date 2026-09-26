# cred-stats

Statement analytics for India. Upload a credit card or savings account statement
PDF — password-protected is fine — and see where the money actually went: month
by month, by category, cashback earned against cashback credited, fees and
interest, and a year built from every month you have uploaded.

**The PDF never leaves your browser.** It is unlocked and read there, personal
details are stripped, and only the extracted text is sent. No file is ever
stored, so there is no file to leak. [docs/security.md](docs/security.md) says
exactly what that means and where it is enforced.

---

## Run it in five minutes

No Google account, no cloud account, no API key. Needs Node 22.22+ (24
recommended) and Docker.

```bash
npm ci
cp backend/.env.example backend/.env   # the defaults are the local ones
npm run db:up                          # MongoDB + mongo-express, in Docker
npm run db:seed                        # demo data, parsed from real statements
npm run dev                            # http://localhost:5173
```

Click **Continue as the demo user**. `CRED_STATS_DEV_LOGIN=true` offers that
button locally; it is refused whenever `NODE_ENV=production`.

|                                    |                                       |
| ---------------------------------- | ------------------------------------- |
| <http://localhost:5173>            | the app                               |
| <http://localhost:4000/api/health> | API and database status               |
| <http://localhost:8081>            | mongo-express — browse every document |

---

## What it does

**Upload → parse → review.** pdf.js decrypts the file in the browser and
rebuilds the printed lines, keeping the columns. Personal details are removed,
and the text is posted — only the text.

**Parse.** Four hand-written parsers cover the banks there are real statements
for: Axis super.money (card), slice, IDFC FIRST and Standard Chartered
(savings). Anything else goes to an AI provider you choose with an API key —
Groq, Azure AI Foundry or any OpenAI-compatible endpoint. Either way the result
is validated against the same schema.

**Reconcile.** Every statement is checked against its own summary and against
the rows read from it; a savings statement row by row against its running
balance. One that does not add up is marked `needs review` with a sentence you
can act on — never quietly wrong.

**Categorise**, in this order: a rule you made by recategorising a row, the
issuer's merchant category, a built-in merchant table, then the model.

**Then the dashboards**: Overview, credit card, cashback and savings, by month
or year. An admin page shows who uses the app and how many statements they
uploaded per bank — counts only.

## How it is built

```
shared/     types and zod schemas, money, periods, redaction   (both sides)
backend/    NestJS API on MongoDB: parsers, ingest, auth, views
frontend/   React app: PDF extraction, upload, dashboards
docs/       everything else
```

- **TypeScript** throughout, strict. npm workspaces.
- **Backend:** NestJS 12, layered as controllers → services → repositories,
  MongoDB through the native driver, every document validated by a zod schema.
- **Frontend:** React 19, Vite, React Router, TanStack Query, recharts.
- **Deploys** as one Docker image on Render's free tier with MongoDB Atlas M0 —
  the API serves the web app on the same origin.
- **Money is integer paise** everywhere. `₹1,048.09` is `104809` until it is
  drawn.

## Checks

```bash
npm run check    # lint, format, typecheck, test, build — about a minute
```

~330 tests. The parser suites run on redacted extracts of real statements and
pin real figures; the API suites drive the real app against an in-memory
MongoDB, so no Docker is needed to run them.

## Documentation

|                                              |                                                          |
| -------------------------------------------- | -------------------------------------------------------- |
| [docs/setup.md](docs/setup.md)               | every environment variable and where to get it           |
| [docs/deployment.md](docs/deployment.md)     | MongoDB Atlas + Render, step by step                     |
| [docs/architecture.md](docs/architecture.md) | how the pieces fit, the data model, the flows            |
| [docs/runbook.md](docs/runbook.md)           | commands, tests, adding a bank, troubleshooting          |
| [docs/security.md](docs/security.md)         | what is never stored, what redaction removes, the limits |
| [docs/conventions.md](docs/conventions.md)   | the rules the code follows, and how changes land         |
| [docs/decisions.md](docs/decisions.md)       | the decisions taken while building, and why              |
