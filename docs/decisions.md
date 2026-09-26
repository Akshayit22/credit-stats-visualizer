# Decisions, and why

The choices that shaped the code. Each one had an alternative that looked
simpler; the reason is recorded so nobody undoes it by accident.

## Parsing and data

1. **The canonical statement text keeps the columns.** The browser does not
   flatten a PDF to a blob of words: it rebuilds lines from the text items'
   x/y positions, emits `@@PAGE n` markers, and separates cells with a TAB.
   Column structure is what makes the deterministic parsers possible, and it
   survives as plain text — redaction stays a regex pass and the model still
   gets something readable. (`shared/src/pdf-layout.ts`,
   `shared/src/statement-text.ts`)
2. **Wrapped lines join the way the bank wraps them.** slice and IDFC
   hard-wrap mid-word (`…TE` + `LAN`), so their parsers join with nothing;
   Standard Chartered breaks at a space, so its parser joins with one. It is a
   per-bank fact, and getting it backwards corrupts every counterparty.
3. **A transaction can be a block of lines.** IDFC centres a multi-line
   description around the row carrying the money, so the continuation lines
   below a row equal those above it — the only way to tell where one
   transaction ends. Direction comes from the running balance moving, because
   an empty withdrawals/deposits column is not printed.
4. **The holder's own name becomes `SELF`.** It is personal data with no reason
   to be kept, and `SELF` is more useful: it marks a self-transfer.
   Counterparty names are kept — categorisation needs them.
5. **Letters touching a `SELF` are the rest of the name.** A parser joining
   wrapped lines can spell a name no single line contained (`AKS` + `HAY …`).
   A `SELF` is only emitted where a name was, so what is glued to it goes.
6. **Two redaction passes, and the second changes nothing.**
   `redactForStorage` runs in the browser and again on the server;
   `redactForLlm` also strips long digit runs, only for prompts. A mask spills
   onto the next line only in the pass that made it — otherwise each pass
   would eat another word.
7. **`contentHash` is over the redacted, normalised text**, recomputed on the
   server — so it never depends on PII and a doctored client hash cannot force
   a duplicate.
8. **`XXXX9581` is not ₹9,581.** `parseAmountToMinor` rejects anything with a
   letter in it, apart from a trailing `Dr`/`Cr`.
9. **A statement's rows come from the statement, not the calendar month.** The
   Axis cycle runs 17 May – 15 Jun; four of its rows are dated in May. An
   account summary is per statement cycle, and `ALL` is the sum of the account
   summaries.
10. **Summaries are recomputed from what is stored, never incremented** — so
    re-uploading, deleting and recategorising all converge.
11. **The mock AI provider refuses when it has no answer registered**, rather
    than returning something plausible. A mock that invents figures would let a
    broken pipeline look healthy.
12. **Three real fixtures, not two.** Both slice months were available, so the
    savings parser is tested against two real statements.

## The rebuild (September 2026)

13. **NestJS + React + MongoDB instead of Next.js + DynamoDB**, so the app runs
    on free tiers (Render, Atlas M0) rather than AWS. The parsers, redaction,
    reconciliation and categorisation moved over unchanged in behaviour; every
    figure the old tests pinned, the new ones pin.
14. **Laid out like the VTOC backend**: controllers, services, repositories and
    managers in folders, all registered in one file, the environment validated
    by zod, a pino logger, and a base repository that validates every document
    against a zod item schema.
15. **Zod schemas in `shared` are the types.** Every stored entity and API
    payload is a schema; the TypeScript type is inferred from it. The backend
    validates every document it reads with the same schema the frontend's
    types come from.
16. **Six collections, not five tables.** The five-table limit was a DynamoDB
    cost and operations constraint. Category rules, which were `RULE#` items on
    the users table, get their own collection.
17. **Every query is scoped by `userId` in one base class.** The old
    transactions GSIs were not user-partitioned, so each caller had to re-check
    ownership. Now no method can read across users — except the admin's
    read-only, counts-only repository, kept apart on purpose.
18. **Sign in with Google (ID token), not OAuth redirects.** The browser gets a
    signed token and the API verifies it. No client secret, no redirect URIs,
    and the same flow works for a SPA and a server.
19. **A session cookie, not a token in `localStorage`.** httpOnly, Lax, Secure.
    That needs the app and the API on one origin — Vite proxies locally, and in
    production the API serves the built app.
20. **One Render service, not a static site plus an API.** Render documents
    static-site rewrites to external URLs but not whether they proxy POST
    bodies and cookies; sign-in depends on both. One service is also one URL
    and one cold start on the free tier.
21. **CSRF by a required header**, not tokens: a cross-site form cannot add
    `X-Requested-With`, and the API answers no CORS preflight.
22. **Bedrock dropped.** AI providers are configured by API key only (Groq,
    Azure AI Foundry, any OpenAI-compatible endpoint), so nothing is tied to
    AWS.
23. **Node 24, TypeScript 6.0.** NestJS 12 is ESM-only; TypeScript 7 (the
    native compiler) is not yet supported by typescript-eslint.
24. **Vitest everywhere, with an in-memory MongoDB.** The API is tested through
    HTTP against the real module; SWC emits the decorator metadata Nest needs.
    No Docker is required to run the tests.
25. **Playwright is not a gate.** The browser journey (real PDFs in Chrome,
    every screen, the upload request carrying no PDF bytes) is run by hand when
    extraction changes; the gates stay under a minute.
26. **pdf.js 6.** Vite bundles its worker from the installed version, so the
    two cannot drift; the old postinstall copy is gone. It extracts justified
    text as sentences, which changed the Axis terms page in the fixture — and
    exposed the non-idempotent redaction fixed in decision 6.

## Presentation

27. **recharts, themed from CSS custom properties** read at runtime. Chart role
    colours and the series slots `--series-1…3` are declared once in
    `tokens.css`.
28. **The chart palette is computed, not chosen.** The mockup's eight-blurple
    ring and its green-versus-red pair fail colour-vision separation on this
    ground. `--series-1/2/3` pass the lightness band, the chroma floor,
    adjacent-pair CVD separation and 3:1 contrast; no chart plots more than
    three series; the category ring is a sequential ramp whose legend is also
    its filter; the status colours are never a series set.
29. **Admin by hard-coded email**, as the owner asked: two addresses, no admin
    sign-up, no separate login.
