# cred-stats — brief for Claude

Personal statement analytics for India. Upload a credit card or savings
statement PDF, see where the money went. npm workspaces: `shared/` (zod types,
money, redaction), `backend/` (NestJS 12 + MongoDB), `frontend/` (React +
Vite). Deploys as one Docker image on Render with MongoDB Atlas.

**Read before changing anything:** `docs/conventions.md` (the rules),
`docs/architecture.md` (where things live), `docs/decisions.md` (why they are
the way they are). `docs/development/progress.md` records what was built and
what is next.

## Never break these

- PDF bytes and the PDF password never leave the browser; the server receives
  redacted text only.
- Money is integer paise (`…Minor`), never a float.
- Redact before any model call; never log statement text, descriptions,
  merchants, emails or prompts.
- Every MongoDB query is scoped by `userId` through `MongoRepository`. The only
  cross-user reader is `AdminInsightsRepository` (read-only, counts only).
- No hard-coded hex, font, radius or spacing in CSS or inline styles — tokens
  only. `frontend/src/styles/nocturne.css` is verbatim; never edit it.
- The parser tests pin figures from real statements. Do not "simplify" them.
- `samples/` (real PDFs) is gitignored and must stay out of git and images.

## How changes land

Never commit to `main`. One concern per branch (`feat/`, `fix/`, `chore/`,
`docs/`, `refactor/`), `npm run check` must pass on the branch, then
`git merge --no-ff` and delete the branch. Conventional Commits; the body says
why. Chain the gate and the merge with `&&` so a failure stops the merge.

## Commands

```bash
npm run db:up && npm run db:seed && npm run dev    # local, demo user
npm run check                                      # lint, format, typecheck, test, build
```
