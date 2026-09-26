# Rebuild progress — Next.js + DynamoDB → NestJS + React + MongoDB

The working checklist for the rebuild. Each line is one branch, merged into
`main` with `--no-ff` after `npm run check` (lint, typecheck, test, build)
passes on the branch. **Resume from the first unchecked line.**

Until the last branch lands, the old Next.js app still sits in `app/`, `src/`,
`tests/`, `scripts/` and `design/` as the reference being ported. It is not
built, linted or tested; each branch moves the pieces it ports out of it.

## Branches

- [x] `refactor/shared-package` — npm workspaces; `shared/` with zod entities,
      API contracts, money, periods, formatting, sections, redaction
- [x] `feat/backend-foundation` — NestJS 12 app: environment, logging, Mongo
      connection, error envelope, health endpoint
- [x] `feat/backend-parsing` — parsers, reconciliation, categorisation,
      summaries; fixtures and their tests
- [x] `feat/backend-llm` — AI providers (groq, azure-foundry,
      openai-compatible, mock)
- [x] `feat/backend-persistence` — repositories for the six collections, indexes
- [x] `feat/backend-auth` — Google ID-token sign-in, session cookie, dev login
- [x] `feat/backend-statements-api` — ingest, statements, transactions,
      summaries, views, settings, profile export/delete
- [ ] `feat/backend-seed` — demo seed and fixture builder scripts
- [ ] `feat/frontend-shell` — Vite + React app, router, auth, layout, sidebar
- [ ] `feat/frontend-upload` — PDF extraction in the browser, upload dialog,
      review step
- [ ] `feat/frontend-dashboards` — overview, card, cashback, savings screens and
      charts
- [ ] `feat/frontend-library-settings` — statement library, settings
- [ ] `feat/deploy-render` — backend Dockerfile, `render.yaml`, docker-compose
- [ ] `feat/admin-overview` — (asked for 2026-09-26) an admin page, no separate
      login: the hard-coded admin emails `akshayit22@gmail.com` and
      `akshaytelang395@gmail.com` see every user, when they last signed in, and
      how many statements each uploaded per bank. Counts and metadata only —
      never another user's transactions.
- [ ] `chore/remove-nextjs-app` — delete the ported Next.js app and AWS infra
- [ ] `docs/rebuild-docs` — `docs/` folder, README, conventions

## Requests from the owner, beyond the port

- **AI providers are configured by API key only** (asked 2026-09-26): nothing
  tied to AWS or Bedrock. `LLM_PROVIDER` picks Groq, Azure AI Foundry or any
  OpenAI-compatible endpoint; the key and model come from `backend/.env`.
  Done in `feat/backend-llm`.
- **Admin overview** — see `feat/admin-overview` above.

## Decisions (and why)

- **NestJS 12 is ESM-only**, so the backend is an ES module with `nodenext`
  resolution; relative imports carry `.js` extensions. The shared package
  follows the same rule so the backend can load its compiled output directly.
- **TypeScript 6.0**, not 7: typescript-eslint supports `<6.1`, and the Nest
  CLI ships 6.0.
- **Vitest everywhere.** The backend uses `unplugin-swc` so Nest's decorator
  metadata is emitted under test.
- **Zod entity schemas in `shared/`** (the VTOC pattern): every type the API
  returns is inferred from a schema, and every document read from MongoDB is
  validated against the same schema.
- **Period maths and display formatting live once**, in `shared/`. The old app
  had two copies (server `dates.ts`, client `format.ts`).
