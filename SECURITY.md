# Security and privacy

This app reads bank statements. That is about as sensitive as personal data
gets, so the design starts from *what we refuse to hold* rather than from what
we would like to collect.

Everything below is enforced in code and covered by a test. Where a claim rests
on a specific file, that file is named — if you change it, check the claim still
holds.

---

## The short version

- **No PDF is ever stored.** Not on disk, not in S3, not in the database. The
  server never receives one.
- **The PDF password never leaves your browser.**
- **Personal details are removed before anything is saved**, and again before
  anything is sent to an AI provider.
- **Account and card numbers are reduced to their last four digits** the moment
  they are read.
- You can **export everything** we hold about you as one JSON file, and
  **delete all of it** in two clicks.

---

## What the browser does, and what the server never sees

The parse pipeline is deliberately split so the sensitive half never crosses the
network.

```
Browser                                        Server
───────                                        ──────
1. you choose a PDF and, if needed, type
   its password
2. pdf.js decrypts and extracts text
   ─ the bytes and the password stay here
3. redaction pass
4. sha256 of the redacted text
5. POST { text, contentHash, meta }   ────►    6. redaction pass again
                                               7. hash recomputed server-side
                                               8. parse, reconcile, categorise
                                               9. store figures only
```

**The PDF file object is read into an `ArrayBuffer`, handed to `pdf.js`, and
goes out of scope.** It is never uploaded, never written to disk, never put in
`localStorage` or IndexedDB. See `src/client/lib/upload.ts`.

**The password is passed to `getDocument({ data, password })` and to nothing
else.** It is not in the POST body, not in a cookie, not in a log, and not in
component state that outlives the dialog. See `src/client/lib/pdf-text.ts`.

`POST /api/statements` refuses any request whose content type is not
`application/json`, so a multipart upload cannot reach the pipeline even by
mistake.

---

## What redaction removes

Two passes, with different jobs. Both live in `src/shared/redact.ts`.

### `redactForStorage` — runs in the browser, then again on the server

| Removed | Kept as |
|---|---|
| Account number, card number | `XXXX9581` — the last four only |
| The account holder's own name | `SELF` |
| Postal address (all lines, wrapped or not) | `[address]` |
| Phone number | `[phone]` |
| Email address | `[email]` |
| UPI handle / VPA (`someone@bank`) | `[vpa]` |
| Customer id | `[customer-id]` |
| Nominee name | `[name]` |
| IFSC, MICR | `[ifsc]`, `[micr]` |

**Merchant and counterparty names survive**, because categorising your spending
is the entire point of the product and cannot be done without them. The one
exception is your own name, which becomes `SELF` — it is personal data we have
no reason to hold, and `SELF` is more useful than the name anyway, because it
marks a transfer between your own accounts.

It runs **twice on purpose**. The browser pass means nothing sensitive is sent.
The server pass means the server does not have to trust that the text it
received came from our own client.

### `redactForLlm` — runs only when a prompt is being built

On top of the above, this strips long digit runs — UPI and IMPS reference ids.
They are stored (they are how you'd find a transaction in your bank's app) but a
model has no use for them, and once storage redaction has run they are the last
identifying thing left in a description.

So the text that reaches an AI provider contains **no name, address, phone
number, email address, UPI handle, customer id, account number or reference
id**. `tests/llm.test.ts` asserts this against a real fixture.

### Why redaction is harder than a regex sweep, and what broke

Three real leaks were found while building this, all from the same root cause —
**redaction runs one line at a time, and bank PDFs wrap fields mid-word.**

1. `AKSHAY LALUMAN TE` on one line and `LAN-…` on the next. The first half was
   masked; the second half was not, and joining them gave `SELFLAN`.
2. Later, the same wrap with a space in the tail gave `SELF TELAN` — the
   surname, intact.
3. `akshaytelang395@oksbi` is a *UPI handle*, not an email — no dot in the
   domain — so the email pattern missed it entirely and the surname leaked.

`maskSpillLength`, `joinWrappedDetail` and `dropMaskSpill` exist for exactly
this. `tests/privacy.test.ts` asserts on surname **fragments**, not just the
full name, because a half-redacted name is still a leak.

The pass order also matters: the VPA pattern must run **after** the IFSC pattern,
because a VPA's local part may contain hyphens and would otherwise run left
across `A-SBIN0004636-` and swallow a counterparty's last letter.

---

## The committed fixtures

`fixtures/*.txt` are redacted extractions of real statements, committed so the
parser tests run on real data. `samples/` — the actual PDFs — is gitignored, is
in `.dockerignore`, and must stay in both.

`npm run fixtures:build` **refuses to write a fixture** that still contains an
email address, a UPI handle, a phone number, an IFSC code or a long digit run in
the header zone. `tests/privacy.test.ts` re-checks every committed fixture, so a
hole in the redaction rules fails the build rather than reaching a repository.

Read the diff on `fixtures/` before committing it, every time. The automated
check is a backstop, not a substitute.

---

## Logging

`src/server/log.ts` is the only logger, and it is deliberately narrow:

- It accepts **only primitives** — no objects, so a transaction can never be
  spread into a log line by accident.
- It scrubs anything that looks like an email address or a run of seven or more
  digits on the way out, whatever the caller passed.
- It truncates every string field to 200 characters.

What is logged about a parse: parser name, account type, row count, status,
whether it reconciled, provider id, model id, token counts, duration. What is
never logged: statement text, transaction descriptions, merchant names, emails,
prompts, model responses, or a provider's error body (a 400 from a vendor
typically echoes the prompt back, so only the status code is recorded).

User ids are logged as a **12-character hex prefix** (`userIdLogPrefix`), never
in full and never as an email address.

---

## Identity

- Sign-in is Google only, through Auth.js v5, with **no email provider and no
  database adapter** — so none of Auth.js's own session or account tables exist.
- Our user id is a **sha256 of the Google subject**, not the subject itself, so
  the provider's identifier never becomes a partition key or a log field. See
  `src/server/auth/user-id.ts`.
- Sessions are JWTs, 30 days, signed with `AUTH_SECRET`.
- Every screen under `app/(app)` is behind a session check, **and** every route
  handler checks again at the data layer via `withUser`. A missed check in one
  place is never the only thing between a request and someone else's data.
- Every DynamoDB read and write is partitioned by `USER#<userId>`. The two
  global secondary indexes that are not partitioned by user
  (`gsi1 = ACCOUNT#…`, `gsi2 = STATEMENT#…` on the transactions table) have an
  explicit ownership check on the way out —
  `if (String(item.pk) === KEY.user(userId))` — so a guessed account id returns
  nothing.

### The dev-login bypass

`CRED_STATS_DEV_LOGIN=true` signs in a fixed demo user with no Google
credentials. It is checked **twice** — once when building the provider list and
again inside `authorize` — and both checks refuse when `NODE_ENV=production`.
The flag alone is never enough in a deployed build.

---

## Your data

- `GET /api/account/export` returns everything held about you — profile,
  accounts, statements, transactions, summaries, category rules — as one JSON
  document. There are no PDFs in it because there are no PDFs.
- `POST /api/account/delete` with `{"confirm":"delete my data"}` removes every
  item for that user **across all five tables**. It runs from the derived data
  inwards (summaries → transactions → statements → accounts → profile), so an
  interruption never leaves a profile pointing at data that is already gone. The
  explicit confirmation string is required; a bare POST does nothing.
- Deleting a single statement removes its transaction rows *before* the
  statement itself, for the same reason.

---

## Secrets

- `.env*` is gitignored except `.env.example`, which contains no values.
- `.dockerignore` keeps `.env*` and `samples/` out of any image.
- CI reads every key from masked, protected GitLab CI/CD variables. No job
  prints its environment, and the pipeline runs with `LLM_PROVIDER=mock`, so it
  never holds a model vendor's key at all.
- API keys are read from the environment at the point of use and are never
  written to the database, never returned by an endpoint, and never shown in the
  UI. The Settings screen shows the provider id, the model id and whether the
  configuration is complete — never a key, and never a partial one.

---

## Known limits in Round 1

Stated plainly, because a security note that only lists strengths is not useful:

- **Data at rest is not encrypted by us.** Locally that is DynamoDB Local, which
  has no encryption at all. `infra/tables.json` sets `SSESpecification` and
  point-in-time recovery for the cloud round, but nothing is deployed yet.
- **There is no rate limiting** on any endpoint.
- **There is no audit log** of who read what.
- **Scanned or photographed statements are refused, not OCR'd.** That is a
  functional limit, but it is also why no image ever needs to be uploaded.
- **The redaction rules are pattern-based.** They are tested against three real
  statements from two banks. A bank that prints personal data in a shape none of
  these patterns anticipate could get something through — which is why
  `findPiiLeaks` gates the fixture builder, and why the rule is to read the
  fixture diff yourself.

---

## Reporting something

If you find a way to get personal data out of this app that the above says
should not be possible, open an issue **without a working example in it** —
describe the shape of the problem and the file you think is responsible, and
leave the reproduction for a private channel.
