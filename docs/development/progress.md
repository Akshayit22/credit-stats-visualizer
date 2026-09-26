# Progress

## The rebuild — complete (26 September 2026)

cred-stats was rebuilt from one Next.js app on DynamoDB into three workspaces —
`shared/`, a NestJS API on MongoDB, and a React app — so that it runs on free
tiers (Render + MongoDB Atlas). Each line below was one branch, merged into
`main` with `--no-ff` after the gates passed on it.

- [x] `refactor/shared-package` — npm workspaces; `shared/` with zod entities,
      API contracts, money, periods, formatting, sections, redaction
- [x] `feat/backend-foundation` — NestJS 12: environment, logging, MongoDB,
      error envelope, health
- [x] `feat/backend-parsing` — the four bank parsers, reconciliation,
      categorisation, summaries; fixtures and their tests
- [x] `feat/backend-llm` — AI providers by API key (groq, azure-foundry,
      openai-compatible, mock); Bedrock dropped
- [x] `feat/backend-persistence` — repositories for six collections, indexes
- [x] `feat/backend-auth` — Google ID-token sign-in, session cookie, CSRF,
      rate limits, demo user
- [x] `fix/test-app-listens-once` — an intermittent ECONNRESET in the API tests
- [x] `feat/backend-statements-api` — ingest, statements, views, settings,
      export, delete
- [x] `feat/backend-seed` — demo seed and fixture builder; pdf.js 6
- [x] `feat/frontend-shell` — router, session, sign-in, sidebar, layout
- [x] `feat/frontend-upload` — PDF extraction in the browser, upload, review
- [x] `feat/frontend-dashboards` — overview, card, cashback, savings, charts
- [x] `feat/frontend-library-settings` — library, settings
- [x] `fix/idempotent-redaction` — a second redaction pass ate a word; found by
      uploading the real Axis PDF in Chrome
- [x] `feat/deploy-render` — one Docker image serving API and web app,
      `render.yaml`, compose `app` profile, GitHub Actions
- [x] `fix/session-first-requests` — no workspace request before the session
- [x] `feat/admin-overview` — admin page for the two hard-coded emails
- [x] `chore/remove-nextjs-app` — the old app and the AWS infrastructure
- [x] `docs/rebuild-docs` — `docs/`, README, conventions, decisions

### How it was verified

- ~330 tests across the three workspaces, under a minute, including every
  parser against the real (redacted) statements with their pinned figures.
- In Chrome, against the real stack: the three real PDFs uploaded through the
  dialog, each reconciled (Axis ₹19,392.38 over 15 rows; slice July
  ₹2,75,910.82 over 41; August ₹3,17,691.27 over 49); each upload request
  carried only `{ text, contentHash, meta }` with no PDF bytes; every screen
  drew its charts with no horizontal overflow, at 1440px and at 390px.
- The production Docker image built and ran healthy against MongoDB in Docker,
  and loaded in Chrome with no Content-Security-Policy violations.

### Not verified yet

- **A real deploy.** Render and Atlas need your accounts; follow
  [deployment.md](../deployment.md).
- **Real Google sign-in and the admin page in a browser** — they need a Google
  OAuth client with this app's origins. Both are covered by API and component
  tests with Google's token check faked.
- **A real model.** Every test uses the mock provider. Upload a statement from
  a bank without a parser with `LLM_PROVIDER=groq` to exercise it.

## Worth doing next

1. **Deploy** — Atlas, then the Render Blueprint ([deployment.md](../deployment.md)).
2. **Try a real provider end to end** with a statement from an unsupported
   bank; the extraction prompt is the one part no test can vouch for.
3. **A fifth bank parser** — the registry has taken four; the recipe is in
   [runbook.md](../runbook.md#adding-a-bank).
4. **Admin: more than counts, carefully** — e.g. uploads per week, or which
   banks fail to parse most (still no figures).
