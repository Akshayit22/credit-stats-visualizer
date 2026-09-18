# cred-stats — conventions

Personal statement analytics for India. Upload a credit card or savings
statement PDF, see where the money went. One Next.js app, DynamoDB, five tables.

## Shape

- **One app.** Next.js App Router. Backend lives in `app/api/**/route.ts` and
  `src/server/**`. There is no separate API service in Round 1.
- `src/server/**` is server-only. `src/client/**` is browser-only. `src/shared/**`
  is safe on both sides — types, money, categories. Never import `src/server`
  from a client component.
- Data store is DynamoDB via AWS SDK v3, same code path locally (DynamoDB Local
  in Docker) and in the cloud. The **only** difference is `DDB_ENDPOINT`: set it
  and we pass an endpoint plus dummy credentials, leave it unset and the default
  resolver plus the IAM role take over.

## Non-negotiables

- **Exactly five tables.** users, accounts, statements, transactions, summaries.
  A new entity becomes a new `sk` prefix on one of them, never a sixth table.
  (Billing, when it lands, is `sk = SUBSCRIPTION#…` on users.)
- **PDF bytes never leave the browser.** The server only ever receives extracted
  text. Nothing is written to disk or S3.
- **The PDF password never leaves the browser.** Not sent, not stored, not logged.
- **Money is integer paise** (`amountMinor`) everywhere. Never a float. Format
  only at render time with `Intl.NumberFormat('en-IN')` via `src/shared/money.ts`.
- **No hard-coded hex, font, radius or spacing** in any stylesheet or inline
  style. Always `var(--color-*)`, `var(--space-*)`, `var(--radius-*)`,
  `var(--shadow-*)`. `app/nocturne.css` is a verbatim copy of the design system
  and must not be edited; app-level tokens go in `app/globals.css`.
- **Redact before any LLM call.** No name, address, phone, email, customer id or
  account number may appear in a prompt.
- **Never log** prompts, statement text, transaction descriptions or emails.
  Log provider id, model id, token counts, duration; user ids as a hash prefix.

## Naming

- Resources `cred-stats-<env>-<resource>`, `env ∈ local | dev | prod`.
- Keys `pk`, `sk`, `gsi1pk`, `gsi1sk`, `gsi2pk`, `gsi2sk`; indexes `gsi1`, `gsi2`.
- Key prefixes `USER#`, `ACCOUNT#`, `STATEMENT#`, `TXN#`, `RULE#`, `PERIOD#`,
  `CONTENTHASH#`.
- Attributes camelCase; money ends `Minor`; timestamps end `At` and are ISO-8601
  UTC strings; dates are `YYYY-MM-DD`; periods are `YYYY-MM`.
- Env vars SCREAMING_SNAKE_CASE, app-specific ones prefixed `CRED_STATS_` except
  third-party conventional names (`GOOGLE_CLIENT_ID`, `AWS_REGION`, …).
- Files kebab-case; React components PascalCase inside kebab-case files.
- TypeScript strict. No `any`, no `!` non-null assertions. Discriminated unions
  for `CreditCardStatement | SavingsStatement`.
- API routes are plural nouns; responses are always `{ data }` or
  `{ error: { code, message } }`.
- Branches `feat/<slug>`, `fix/<slug>`, `chore/<slug>`. Conventional Commits.

## Decisions taken while building (and why)

1. **Canonical statement text format.** The browser does not flatten the PDF to
   a blob of words — it reconstructs lines from the text items' x/y positions and
   emits `@@PAGE n` markers with **tab-separated cells** inside each line. Column
   structure is what makes the deterministic parsers possible, and it survives
   as plain text, so redaction stays a regex pass and the LLM fallback still
   gets something readable. See `src/client/lib/pdf-text.ts`.
2. **Wrapped description lines concatenate with no separator.** slice hard-wraps
   mid-word (`…TE` + `LAN` → `…TELAN`). Joining with a space corrupts every
   counterparty name.
3. **The account holder's own name becomes `SELF`** in transaction descriptions
   during the storage redaction pass. It is PII we have no reason to keep, and
   `SELF` is strictly more useful than the name: it marks a self-transfer.
   Counterparty names that are not the holder are kept — categorisation needs
   them, and the build spec allows it.
4. **`contentHash` is taken over the redacted, normalised text,** so the hash
   never depends on PII and is stable across uploads of the same file.
5. **recharts, not ECharts.** The design mockup is built on ECharts; the app
   uses recharts per the build spec, themed entirely from the CSS custom
   properties read at runtime. Chart role colours (`--color-positive`,
   `--color-warning`, `--color-negative`) and the categorical ramp `--chart-1…8`
   are declared once in `app/globals.css`.
6. **Three fixtures, not two.** Both slice statements (July and August) were
   available, so the savings parser is tested against two real months. The July
   file is the one carrying the zero-width space inside `idfcfirst`.
7. **Two redaction passes, not one.** `redactForStorage` strips PII and runs on
   the client and again on the server. `redactForLlm` additionally strips long
   digit runs and is applied only when building a prompt.

## Commands

```bash
npm run db:up && npm run db:create && npm run db:seed && npm run dev:nollm
npm run lint && npm run typecheck && npm run test && npm run build
```

All four gates must pass before a milestone is called done.
