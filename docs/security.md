# Security and privacy

This app reads bank statements. That is about as sensitive as personal data
gets, so the design starts from _what we refuse to hold_ rather than from what
we would like to collect.

Everything below is enforced in code and covered by a test. Where a claim rests
on a specific file, that file is named — if you change it, check the claim
still holds.

---

## The short version

- **No PDF is ever stored.** Not on disk, not in the database. The server never
  receives one.
- **The PDF password never leaves your browser.**
- **Personal details are removed before anything is saved**, and again before
  anything is sent to an AI provider.
- **Account and card numbers are reduced to their last four digits** the moment
  they are read.
- You can **export everything** held about you as one JSON file, and **delete
  all of it** in two clicks.

---

## What the browser does, and what the server never sees

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

**The PDF is read into an `ArrayBuffer`, handed to pdf.js, and goes out of
scope.** It is never uploaded, never written anywhere, never put in
`localStorage` or IndexedDB — `frontend/src/utils/upload.ts`.

**The password goes to pdf.js's `getDocument` and to nothing else.** It is not in
the request, a cookie, a log, or state that outlives the dialog —
`frontend/src/utils/pdf-text.ts`.

`POST /api/statements` refuses any request that is not `application/json`, so a
file upload cannot reach the pipeline even by mistake.

**Asserted, not assumed.** `frontend/test/upload.test.tsx` checks that the
request body is exactly `{ text, contentHash, meta }` and contains no `%PDF`,
no password, no holder name and no email. The same journey was run in Chrome
with the real statements while rebuilding, intercepting each upload request.

---

## What redaction removes

Two passes, in `shared/src/redact.ts`.

### `redactForStorage` — in the browser, then again on the server

| Removed                                     | Kept as                         |
| ------------------------------------------- | ------------------------------- |
| Account number, card number                 | `XXXX9581` — the last four only |
| The account holder's own name               | `SELF`                          |
| Postal address (every line, wrapped or not) | `[address]`                     |
| Phone number                                | `[phone]`                       |
| Email address                               | `[email]`                       |
| UPI handle (`someone@bank`)                 | `[vpa]`                         |
| Customer id                                 | `[customer-id]`                 |
| Nominee name                                | `[name]`                        |
| IFSC, MICR                                  | `[ifsc]`, `[micr]`              |

**Merchant and counterparty names survive**, because categorising spending is
the point of the product and cannot be done without them. The exception is your
own name, which becomes `SELF` — personal data with no reason to be held, and
`SELF` is more useful anyway: it marks a transfer between your own accounts.

It runs **twice on purpose**: the browser pass means nothing sensitive is sent,
the server pass means the server does not trust that the text came from our own
client. The second pass must change nothing, and does not — every committed
fixture is checked for that, and a second pass also reports nothing removed.

### `redactForLlm` — only when a prompt is built

On top of the above it strips long digit runs — UPI and IMPS reference ids. They
are stored (they are how you find a transaction in your bank's app) but a model
has no use for them. So a prompt contains **no name, address, phone, email, UPI
handle, customer id, account number or reference id**
(`backend/test/llm/llm.test.ts`, `backend/test/services/llm.service.test.ts`).

### Why redaction is harder than a regex sweep

Redaction runs a line at a time, and bank PDFs wrap fields mid-word. Leaks found
while building, each now pinned by a test:

1. A name wrapped as `…PRIYA RA` + `MACHANDRAN NAI-…` — the first half masked,
   the second not, and joining them gave `SELF` + surname.
2. `priyanair395@oksbi` is a UPI handle, not an email (no dot in the domain);
   the email pattern missed it and the surname leaked.
3. A name split `AKS` / `HAY` across lines is not a name on either line; a parser
   joining the description spelled it again.
4. A second pass of the rules ate the word after a mask made by the first — so
   the server's pass over the browser's changed the text. A mask spills only in
   the pass that makes it.

`maskSpillLength`, `joinWrappedDetail`, the seam check and the remnant collapse
exist for these. The privacy suites assert on name **fragments**, not just the
full name, because a half-redacted name is still a leak. Pass order matters
too: the UPI pattern runs after the IFSC pattern, or it runs left across
`A-SBIN0004636-` and swallows a counterparty's last letter.

---

## The committed fixtures

`backend/fixtures/*.txt` are redacted extractions of real statements, committed
so the parser tests run on real data. `samples/` — the PDFs — is gitignored, in
`.dockerignore`, and must stay in both.

`npm run fixtures:build` **refuses to write a fixture** that still carries an
email, UPI handle, phone number, IFSC or unmasked account number.
`backend/test/parsing/privacy.test.ts` re-checks every committed fixture, so a
hole in the rules fails the build rather than reaching the repository. Read the
fixture diff before committing it anyway.

---

## Identity and sessions

- **Sign in with Google** only (plus a demo user locally). The browser gets an
  ID token; the API verifies its signature, issuer, expiry and that the audience
  is our client id (`backend/src/managers/google-auth-client.manager.ts`). There
  is no client secret, and no Google token is stored.
- **Our user id is a sha256 of the Google subject**, never the subject itself
  (`backend/src/auth/user-id.ts`).
- **The session** is an HS256 JWT in a cookie that is `httpOnly` (page scripts
  cannot read it), `SameSite=Lax` (not sent on cross-site POSTs) and `Secure`
  in production. Thirty days. Production refuses to start without
  `CRED_STATS_SESSION_SECRET`.
- **Every route is private unless marked `@Public()`** — the global `AuthGuard`
  runs first. The user id a handler uses comes only from the session.
- **Every query is scoped to one user.** `MongoRepository` adds `userId` to
  every read, write and delete; there is no cross-user method on it. A guessed
  statement or account id returns 404.

### Cross-site request forgery

Every write must carry `X-Requested-With: cred-stats`
(`backend/src/auth/csrf.guard.ts`). A form on another site can make a browser
send a POST, but it cannot add a custom header without a CORS preflight — and
the API answers none. Together with the `Lax` cookie that closes CSRF.

### Rate limits

`@nestjs/throttler`: 300 requests a minute per address overall, 10 sign-in
attempts, 20 uploads.

### Security headers

helmet, with a Content Security Policy that allows our own origin plus exactly
what Sign in with Google needs (`backend/src/bootstrap.ts`), `frame-ancestors
'none'`, and `Cross-Origin-Opener-Policy: same-origin-allow-popups` for Google's
popup.

### The demo user

`CRED_STATS_DEV_LOGIN=true` offers a fixed demo user with no Google account. It
is checked on every sign-in, not once at boot, and refused whenever
`NODE_ENV=production` whatever the flag says.

### The admin overview

The two hard-coded admin addresses (`backend/src/auth/admins.ts`) can see every
user's name and email, when they last signed in, and how many statements they
uploaded per bank. That is the only cross-user read in the app. It goes through
`AdminInsightsRepository`, read-only, with explicit projections; it never reads
a transaction, an amount or a summary, and a test asserts the response carries
none.

---

## Logging

`backend/src/services/log.service.ts` is the only logger, and deliberately
narrow:

- It takes an event name and **primitive fields only** — an object cannot be
  spread into a log line by accident.
- It scrubs anything shaped like an email address or a run of seven or more
  digits, whatever the caller passed, and truncates strings to 200 characters.
- A 5xx is logged as the error's **name**, never its message, which could hold
  statement text.

Logged about a parse: parser, account type, row count, status, whether it
reconciled, provider, model, token counts, duration. **Never** logged: statement
text, descriptions, merchant names, emails, prompts, model responses, or a
provider's error body (a vendor's 400 typically echoes the prompt, so only the
status is kept). Users appear as a **12-character prefix** of their id.

---

## Your data

- `GET /api/profile/export` returns everything held — profile, accounts,
  statements, transactions, summaries, category rules — as one JSON download.
  There are no PDFs in it because there are no PDFs.
- `POST /api/profile/delete` with `{"confirm":"delete my data"}` removes every
  document for that user in every collection, from derived data inwards
  (summaries → transactions → statements → accounts → rules → profile), then
  ends the session. The phrase is required; a bare POST does nothing.
- Deleting one statement removes its rows first, then the statement, then
  recomputes that month.

---

## Secrets

- `.env` files are gitignored; `backend/.env.example` is committed with no
  values, and a test fails the build if a key, secret, token or password ever
  gets one.
- `.dockerignore` keeps every `.env` and `samples/` out of the image.
- API keys are read from the environment and never stored, returned by an
  endpoint or shown in the UI. Settings shows the provider, the model and which
  variables are missing — never a key, not even part of one.
- In production the secrets live in Render's dashboard (`sync: false` in
  `render.yaml`); the session secret is generated there.

---

## Known limits

- **Data at rest is encrypted by Atlas**, not by the app. Anyone with the
  database password can read the stored figures (which carry no PDF and no
  personal identifiers beyond your name, email and the counterparties'
  names).
- **The Atlas network rule is open** (`0.0.0.0/0`), because Render's free
  services have no fixed outbound address. The database password is the
  protection.
- **There is no audit log** of who read what.
- **Rate limits are per process**, in memory — enough for one Render instance,
  not for several.
- **Scanned or photographed statements are refused**, not OCR'd — which is also
  why no image ever needs to be uploaded.
- **Redaction is pattern-based.** It is tested against real statements from two
  banks and synthetic lines shaped like two more. A bank that prints personal
  data in a shape none of the rules anticipates could get something through —
  which is why `findPiiLeaks` gates the fixture builder, and why you read the
  fixture diff yourself.

---

## Reporting something

If you find a way to get personal data out of this app that the above says
should not be possible, open an issue **without a working example in it** —
describe the shape of the problem and the file you think is responsible, and
leave the reproduction for a private channel.
