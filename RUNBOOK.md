# cred-stats — runbook

## Start

```bash
npm ci
npm run db:up        # DynamoDB Local :8000, dynamodb-admin :8001
npm run db:create    # creates the 5 tables if missing
npm run db:seed      # demo data
npm run dev          # http://localhost:3000
npm run dev:nollm    # same, with the mock LLM provider forced
```

Check it is alive: `curl -s localhost:3000/api/health | jq`. Status `ok` means
all five tables answered.

## Reset

```bash
npm run db:reset     # drops and recreates all 5 tables, then reseeds
npm run db:down      # stops the containers (data survives in ./.docker)
rm -rf .docker       # nuclear: throws away the DynamoDB Local volume too
```

## Tests

```bash
npm run test                 # everything
npm run test -- parsers      # just the parser suites
npm run test:watch
npm run test -- --coverage
```

Parser tests run entirely off the committed fixtures in `fixtures/`. They need
no Docker and no network.

## Refreshing the fixtures

`fixtures/*.txt` are **redacted** extractions of the real PDFs in `samples/`.
`samples/` is gitignored and must stay that way.

```bash
npm run fixtures:build       # re-extracts samples/ → fixtures/, redacted
git diff fixtures/           # read this diff before committing it
```

If a real name, address, phone, email, customer id or full account number shows
up in that diff, the redaction rules have a hole — fix
`src/server/parsing/redact.ts` first. `tests/privacy.test.ts` asserts the
fixtures are clean, so a hole fails the build.

## Adding a new bank parser

1. Drop the PDF in `samples/` (gitignored) and run `npm run fixtures:build`.
2. Add a fingerprint in `src/server/parsing/detect.ts` — a few strings that only
   this issuer prints, plus the structural hints (`Total Payment Due` for a card,
   `Opening balance` + a running balance column for savings).
3. Write `src/server/parsing/parsers/<issuer>-<product>.ts` exporting a
   `StatementParser`. Copy the closest existing one:
   - `slice-savings.ts` — running-balance savings ledger, wrapped detail lines.
   - `axis-supermoney-card.ts` — card statement with a Dr/Cr suffix and an
     issuer merchant-category column.
4. Register it in `src/server/parsing/registry.ts`.
5. Add a test in `tests/parsers/` asserting row count, totals, reconciliation,
   direction, and that no PII survives.

A parser that throws, or whose output fails reconciliation, falls back to the
LLM automatically — you never have to handle that yourself.

## Troubleshooting

### The PDF worker does not load

Symptom: the upload dialog hangs, or the console shows
`Setting up fake worker failed` / `Failed to fetch dynamically imported module`.

- The worker is served from `/pdf.worker.min.mjs` in `public/`, copied there by
  the `postinstall` step. Check the file exists: `ls -l public/pdf.worker.min.mjs`.
  If it is missing, `npm run postinstall` restores it.
- The worker version must match `pdfjs-dist` exactly. After bumping the package,
  re-run `npm run postinstall` — a stale worker fails with
  `The API version does not match the Worker version`.
- Hard-reload the page; the browser caches the worker aggressively.

### DynamoDB Local is not reachable

Symptom: `/api/health` returns 503, or writes fail with
`ECONNREFUSED 127.0.0.1:8000`.

```bash
docker ps                            # is cred-stats-local-dynamodb up?
docker logs cred-stats-local-dynamodb --tail 50
npm run db:up                        # start it
curl -s -o /dev/null -w '%{http_code}\n' localhost:8000   # 400 means it IS up
```

A bare `GET http://localhost:8000` returning **400** is correct — DynamoDB only
answers signed POSTs. `000` or a refusal means it is down. If port 8000 is taken
by something else, change the left-hand side of the port mapping in
`docker-compose.yml` and `DDB_ENDPOINT` together.

If the tables vanished, the volume was cleared: `npm run db:create && npm run db:seed`.

### The LLM returned JSON that does not validate

Symptom: a statement lands in `needs_review` with
`LLM output did not match the schema`.

- We retry **once**, appending the validation error to the prompt. A second
  failure marks the statement `needs_review` rather than guessing — the figures
  are still there to fix by hand in the review step.
- Check the provider and model actually in use: `/api/health` reports
  `llmProvider`, and Settings shows the provider and model id.
- Small models fail this most often. Try a larger one, or `LLM_PROVIDER=mock` to
  confirm the rest of the pipeline is fine.
- We never log the prompt or the response by design. To debug a specific
  statement, run the parser against its fixture in a test — that is the only
  place the text is visible.

### A statement says "already uploaded"

Working as intended: `contentHash` (sha256 of the redacted, normalised text)
already exists for this user. Delete the statement from the library to re-upload.
