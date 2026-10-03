# Runbook

## Commands

Run from the repository root.

| Command                                   | What it does                                                       |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `npm ci`                                  | install every workspace                                            |
| `npm run db:up` / `db:down`               | start / stop MongoDB (:27018) and mongo-express (:8081) in Docker  |
| `npm run db:seed`                         | load the three committed statements for the demo user (idempotent) |
| `npm run dev`                             | shared in watch mode, the API on :4000, the web app on :5173       |
| `npm run check`                           | the gates: lint, format, typecheck, test, build                    |
| `npm run test`                            | every test in every workspace                                      |
| `npm run fixtures:build`                  | rebuild `backend/fixtures` from the PDFs in `samples/`             |
| `npm run format`                          | Prettier over everything                                           |
| `docker compose --profile app up --build` | the production image on :4000 against local MongoDB                |

A single workspace: `npm run <script> -w @cred-stats/backend` (or `shared`,
`frontend`).

Health: `curl -s localhost:4000/api/health` — `status: ok` when MongoDB
answers.

## Reset the local database

```bash
docker compose down -v      # stops MongoDB and deletes its volume
npm run db:up && npm run db:seed
```

Or sign in and use **Settings → Delete all my data** for just your user.

## Tests

```bash
npm run test                                       # all three workspaces
npm run test -w @cred-stats/backend -- parsing     # the parser and privacy suites
npm run test -w @cred-stats/backend -- api         # the API, end to end
npm run test -w @cred-stats/frontend -- --watch
```

About 330 tests, well under a minute:

- **shared** — money, periods, formatting, sections, schemas, redaction rule by
  rule.
- **backend** — the parsers against the real (redacted) statements and their
  pinned figures; privacy over every fixture; the AI provider layer with a fake
  `fetch`; repositories and the whole API against **an in-memory MongoDB**
  (`mongodb-memory-server` — downloaded once, ~80 MB, then cached). Each test
  file gets a database of its own, so files run in parallel. No Docker needed.
- **frontend** — the real routes and screens in jsdom against a fake API: sign
  in, upload (with pdf.js extraction stubbed), dashboards, library, settings,
  admin.

No test calls a real model. The mock provider refuses unless a test registers
its answer — which is how the suites prove a statement a built-in parser covers
never reaches a provider.

pdf.js itself cannot run in jsdom. After changing extraction or the upload
dialog, try a real upload in a browser (`npm run dev`, then upload a PDF from
`samples/`).

## Refreshing the fixtures

`backend/fixtures/*.txt` are **redacted** extractions of the real PDFs in
`samples/` (gitignored — keep it that way).

```bash
npm run fixtures:build        # samples/ → backend/fixtures/, redacted
git diff backend/fixtures     # read this before committing it
```

The builder uses the same line reconstruction the browser runs
(`shared/src/pdf-layout.ts`) and refuses to write a file `findPiiLeaks` objects
to. If a real name, address, phone, email, customer id or full account number
shows up in the diff anyway, fix `shared/src/redact.ts` first.

## Adding a bank

1. Put the PDF in `samples/` and run `npm run fixtures:build`.
2. Add a fingerprint to `backend/src/parsing/detect.ts` — strings only this
   issuer prints, plus the structural hints (`Total Payment Due` for a card, an
   opening balance and a running balance column for savings).
3. Write `backend/src/parsing/parsers/<issuer>-<product>.ts` exporting a
   `StatementParser`. Start from the closest one:
   - `axis-supermoney-card.ts` — a card with Dr/Cr suffixes and an issuer
     category column.
   - `slice-savings.ts` — a running-balance ledger with wrapped details.
   - `idfc-savings.ts` — descriptions as multi-line blocks around the row.
   - `scb-savings.ts` — two-column header, payer names wrapped at a space.
4. Register it in `backend/src/parsing/registry.ts`.
5. Add `backend/test/parsing/<issuer>-<product>.test.ts`: row count, totals,
   reconciliation, direction, and that no PII survives.
6. Check how the bank wraps a description: slice and IDFC break mid-word (join
   with nothing), Standard Chartered at a space (join with a space). Getting it
   backwards corrupts every counterparty.

A parser that throws, or whose output does not reconcile, falls back to the
model automatically.

## Troubleshooting

### The API will not start: "Environment validation failed"

It names the variable and the rule, never the value. Usually `MONGODB_URI` is
missing (copy `backend/.env.example` to `backend/.env`), or production is
missing `CRED_STATS_SESSION_SECRET`.

### `/api/health` says `database: unreachable`

```bash
docker ps                                   # is cred-stats-mongo up and healthy?
npm run db:up
docker logs cred-stats-mongo --tail 50
```

In production: the Atlas network rule must allow `0.0.0.0/0`, and a password
with `@ : / ? #` in it must be URL-encoded inside `MONGODB_URI`.

### Port 4000 or 5173 is already in use

Something else — often the production container from `--profile app` — holds
it. `docker compose stop app`, or `lsof -nP -iTCP:4000 -sTCP:LISTEN` to find
it.

### Google says "The given origin is not allowed for the given client ID"

Add the page's exact origin (scheme, host and port) to the OAuth client's
authorised JavaScript origins — [setup.md §2](setup.md#2-google-sign-in).
Changes can take a few minutes to apply.

### The upload hangs, or the console shows a pdf.js worker error

Vite bundles the worker from the installed `pdfjs-dist`, so a version mismatch
cannot happen in a normal build. Hard-reload to drop a cached old bundle. In
production, check the response's `Content-Security-Policy` still has
`worker-src 'self' blob:`.

### A statement from an unknown bank is refused

The message says which of three things happened:

- _"… Set LLM_PROVIDER and its API key …"_ — no model is configured. That is
  the intended behaviour with `mock`.
- _"… is over its rate limit …"_ — upload it again in a minute.
- _"… larger than … allows this account in one request …"_ — waiting will not
  help; raise the provider's limit or use another provider.

**Settings** shows the active provider, the model and any missing variables.

### The model's JSON did not validate

The model is asked once more with the validation error appended. A second
failure refuses the upload rather than storing figures that did not typecheck.
Small models fail this most often — try a larger one. Prompts and responses are
never logged, by design; to debug, reproduce the statement as a fixture and run
the parser in a test.

### "This statement has already been uploaded"

Working as intended: the redacted text's sha256 already exists for this user.
Delete the statement from the library to upload it again. The hash is
recomputed on the server, so a doctored client hash cannot force a duplicate
through.

### A key ended up in `backend/.env.example`

`backend/test/config.test.ts` fails the build when that happens. Move the value
to `backend/.env` and blank the line. If it was ever **committed**, blanking it
is not enough — revoke the key at the provider first.
