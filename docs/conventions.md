# Conventions

The rules the code follows. They are few, and they are enforced — by the lint
config, by tests, or by review.

## Non-negotiables

- **PDF bytes never leave the browser.** The server only ever receives
  extracted, redacted text. Nothing is written to disk.
- **The PDF password never leaves the browser.** Not sent, not stored, not
  logged.
- **Money is integer paise** (`amountMinor`) everywhere. Never a float. Format
  only when drawing, with `formatMinor` from `@cred-stats/shared`
  (`Intl.NumberFormat('en-IN')`).
- **Redact before any model call.** No name, address, phone, email, customer id
  or account number may appear in a prompt (`redactForLlm`).
- **Never log** prompts, statement text, transaction descriptions, merchant
  names or emails. Log provider, model, token counts, durations and counts; a
  user as `userIdLogPrefix(userId)`.
- **Every query is scoped to one user.** Repositories extend
  `MongoRepository`, which adds `userId` to every query. The only exception is
  `AdminInsightsRepository`, read-only and counts-only; do not add another.
- **No hard-coded hex, font, radius or spacing** in any stylesheet or inline
  style. Use `var(--color-*)`, `var(--space-*)`, `var(--radius-*)`,
  `var(--shadow-*)`. `frontend/src/styles/nocturne.css` is a verbatim copy of
  the design system and must not be edited; app-level tokens go in
  `frontend/src/styles/tokens.css`. Inline styles are for data only — a series
  colour, a chart height, a bar's width.

## Where code goes

- `shared/` runs on both sides: no Node, DOM or network APIs. The backend and
  frontend never import each other.
- Backend layering ([architecture.md](architecture.md#backend)): controllers
  validate and delegate; services hold the logic and never query MongoDB;
  repositories are the only code that does; managers wrap external clients;
  pure logic goes in `domain/`, `parsing/` or `llm/`. Register every new class
  in `providers-and-controllers.ts`.
- Nothing reads `process.env` except `backend/src/environment.ts`. A new
  variable goes in its zod schema **and** in `backend/.env.example` (a test
  checks both).
- Frontend: a route is a `pages/` component (fetch, loading, error) rendering a
  `screens/` component (props only). Every API call is in
  `services/endpoints.ts`; every query and mutation in `hooks/queries.ts`.

## Naming

- Files kebab-case; React components PascalCase inside them.
- Collections camelCase plural (`categoryRules`). Fields camelCase; money ends
  `Minor`; instants end `At` and are ISO-8601 UTC; dates are `YYYY-MM-DD`;
  months (`period`) are `YYYY-MM`.
- Ids are derived, never generated ([architecture.md](architecture.md#data-model)).
- Environment variables SCREAMING_SNAKE_CASE; the app's own are prefixed
  `CRED_STATS_`, conventional ones are not (`MONGODB_URI`, `GOOGLE_CLIENT_ID`,
  `PORT`).
- API routes are plural nouns under `/api`; responses are always `{ data }` or
  `{ error: { code, message } }`.

## TypeScript

- Strict, plus `noUncheckedIndexedAccess`. No `any`, no `!` non-null
  assertions (lint errors).
- Types for anything stored or sent come from the zod schemas in
  `shared/src/entities` and `shared/src/api` — infer, do not redeclare.
- Discriminated unions for `CreditCardStatement | SavingsStatement`.
- The backend and shared are ES modules with `nodenext` resolution: relative
  imports end in `.js`. The frontend uses bundler resolution and does not.
- `import type` for types, inline (`import { x, type Y }`). In the backend the
  lint rule knows that a constructor-injected class must stay a value import.

## Branching

**Nothing is committed directly to `main`.** Every change is a branch, merged
with `--no-ff` after the gates pass on it.

```bash
git checkout main && git pull
git checkout -b feat/savings-interest-chart

# …work, then the gates…
npm run check

git commit                        # Conventional Commits; the body says why
git checkout main
git merge --no-ff feat/savings-interest-chart
git branch -d feat/savings-interest-chart
```

- Branches: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `docs/<slug>`,
  `refactor/<slug>`.
- **One concern per branch.** A fix and a feature that touch the same file are
  still two branches — the merge commits are what a reviewer reads.
- **The gates pass on the branch, before the merge.** `main` is never where a
  failure is discovered. **`npm run check`, locally, is the only thing that
  runs them** — nothing on a server repeats it. The GitHub workflow is
  `workflow_dispatch` only, because this workspace has no Actions allowance to
  spend, so a branch merged without running it is a branch nothing checked.
  Chain the gate to the merge with `&&` and that cannot happen by accident:

  ```bash
  npm run check && git checkout main && git merge --no-ff -
  ```

- `--no-ff` always: the merge commit is what keeps the branch visible in
  `git log --graph`. Delete the branch after merging.

## Tests

- Keep the whole suite under a minute. Tests that need a database use the
  in-memory MongoDB via `createTestApp()` or `createTestDatabase()`, never a
  shared one.
- A bug found in real data gets a test shaped like that data before it is
  fixed. The parser suites pin figures from real statements; do not "simplify"
  them away.
