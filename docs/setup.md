# Setup

A checklist to follow top to bottom. **Section 1 alone** gives you a working app
with demo data: no Google account, no cloud account, no API key.

---

## 0. Prerequisites

| Need                                                           | Check         |
| -------------------------------------------------------------- | ------------- |
| Node 22.22+ (24 recommended — it is what the image and CI run) | `node -v`     |
| npm 10+                                                        | `npm -v`      |
| Docker Desktop, running — for the local MongoDB                | `docker info` |

The tests do **not** need Docker: they start an in-memory MongoDB of their own.

---

## 1. Run it locally with demo data

```bash
git clone https://github.com/Akshayit22/credit-stats-visualizer.git
cd credit-stats-visualizer
npm ci
cp backend/.env.example backend/.env
npm run db:up      # MongoDB :27017 and mongo-express :8081, in Docker
npm run db:seed    # loads the three real (redacted) statements for the demo user
npm run dev        # API :4000, web app :5173
```

Open <http://localhost:5173> and click **Continue as the demo user**.

`npm run dev` runs three things side by side: the shared package in watch mode,
the API (recompiled and restarted on every save), and Vite, which serves the
app and proxies `/api` to the API. The browser only ever talks to :5173.

| URL                                | What                                           |
| ---------------------------------- | ---------------------------------------------- |
| <http://localhost:5173>            | the app                                        |
| <http://localhost:4000/api/health> | `ok` when MongoDB answers                      |
| <http://localhost:8081>            | mongo-express — browse and edit every document |

Stop MongoDB with `npm run db:down`; its data survives in a Docker volume.

---

## 2. Google sign-in

Only needed for real sign-in instead of the demo user. The app uses **Sign in
with Google** (Google Identity Services): the button gives the browser an ID
token, and the API verifies it against your client id. There is **no client
secret and no redirect URI** to configure.

1. <https://console.cloud.google.com/> → project picker → **New project**
   (e.g. `cred-stats`).
2. **APIs & Services → OAuth consent screen**: user type **External**, app name
   `cred-stats`, your email for support and developer contact. While the app is
   in _Testing_, add every Google account that should be able to sign in under
   **Test users**.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - **Authorised JavaScript origins** — add all that apply:
     - `http://localhost`
     - `http://localhost:5173` (the dev server)
     - `http://localhost:4000` (the production image run locally)
     - `https://<your-service>.onrender.com` (production — see
       [deployment.md](deployment.md))
   - Leave **Authorised redirect URIs** empty.
4. Copy the **Client ID** into `backend/.env`:

   ```bash
   GOOGLE_CLIENT_ID=<id>.apps.googleusercontent.com
   ```

5. Restart `npm run dev`. The sign-in page now shows the Google button.

> **"The given origin is not allowed for the given client ID"** means the page's
> origin is missing from step 3. It must match exactly — scheme, host and port.

The two admin addresses (see [architecture.md](architecture.md#admin)) sign in
the same way and then see an **Admin** link in the sidebar.

---

## 3. AI provider (optional)

The built-in parsers read Axis super.money, slice, IDFC FIRST and Standard
Chartered statements without any model. A model is used only for a bank no
parser covers, for a parse that does not reconcile, and to categorise a
merchant no rule matches.

Pick one provider, set `LLM_PROVIDER` to it, and give it an API key. Nothing is
tied to any one vendor — only the key and the model name change.

### `mock` — no model (the default)

```bash
LLM_PROVIDER=mock
```

Calls no model. A statement from a bank no parser covers is refused with a
message saying so, rather than guessed.

### `groq`

1. <https://console.groq.com/keys> → **Create API Key**, copy it once.
2. Pick a model from <https://console.groq.com/docs/models>.

```bash
LLM_PROVIDER=groq
GROQ_API_KEY=gsk_...
GROQ_MODEL=openai/gpt-oss-120b      # the default if unset
```

**The free tier is about 8,000 tokens a minute, and a statement is not small.**
A 4-page savings statement measured ~4,300 tokens in and ~4,200 out. The app
waits out a short rate limit by itself; a statement too large for the tier is
refused at once with a message that says waiting will not help.

### `azure-foundry` — Azure AI Foundry / Azure OpenAI

1. <https://ai.azure.com/> → your project → **Models + endpoints → Deploy
   model**.
2. From the deployment copy the endpoint host, the key and the deployment name.

```bash
LLM_PROVIDER=azure-foundry
AZURE_AI_ENDPOINT=https://<resource>.openai.azure.com
AZURE_AI_API_KEY=<key>
AZURE_AI_DEPLOYMENT=<deployment name>
AZURE_AI_API_VERSION=2024-10-21     # the default if unset
```

### `openai-compatible` — xAI Grok, OpenAI, OpenRouter, Ollama

Anything that answers `POST {base}/chat/completions` with a bearer token.

| Service        | `OPENAI_COMPATIBLE_BASE_URL`   | Example model                       |
| -------------- | ------------------------------ | ----------------------------------- |
| xAI Grok       | `https://api.x.ai/v1`          | `grok-4`                            |
| OpenAI         | `https://api.openai.com/v1`    | `gpt-4.1-mini`                      |
| OpenRouter     | `https://openrouter.ai/api/v1` | `meta-llama/llama-3.3-70b-instruct` |
| Ollama (local) | `http://localhost:11434/v1`    | `llama3.1` (any non-empty key)      |

```bash
LLM_PROVIDER=openai-compatible
OPENAI_COMPATIBLE_BASE_URL=https://api.x.ai/v1
OPENAI_COMPATIBLE_API_KEY=xai-...
OPENAI_COMPATIBLE_MODEL=grok-4
```

**Settings** in the app shows the active provider, the model, and which
variables are missing — never a key.

---

## 4. Every environment variable

All of them belong to the API and live in `backend/.env` locally (in Render's
dashboard in production). The frontend has no configuration of its own.
`backend/src/environment.ts` is the authority; the API validates everything at
boot and names any variable that is wrong.

| Variable                                                                               | Default                  | What it is                                                                      |
| -------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------- |
| `NODE_ENV`                                                                             | `development`            | `production` turns on Secure cookies and refuses the demo user                  |
| `PORT`                                                                                 | `4000`                   | the API's port                                                                  |
| `LOG_LEVEL`                                                                            | `info`                   | pino level; `silent` under test                                                 |
| `MONGODB_URI`                                                                          | — (required)             | `mongodb://localhost:27017` locally; the Atlas SRV string in production         |
| `MONGODB_DB`                                                                           | `cred-stats`             | the database name                                                               |
| `CRED_STATS_SESSION_SECRET`                                                            | random per process       | signs the session cookie; `openssl rand -base64 32`; **required in production** |
| `GOOGLE_CLIENT_ID`                                                                     | unset                    | §2; unset means no Google button                                                |
| `CRED_STATS_DEV_LOGIN`                                                                 | `false`                  | `true` offers the demo user; ignored in production                              |
| `CRED_STATS_WEB_DIR`                                                                   | unset                    | the built frontend, when the API should serve it (the Docker image sets it)     |
| `LLM_PROVIDER`                                                                         | `mock`                   | §3                                                                              |
| `GROQ_API_KEY`, `GROQ_MODEL`                                                           | —, `openai/gpt-oss-120b` | §3                                                                              |
| `AZURE_AI_ENDPOINT`, `AZURE_AI_API_KEY`, `AZURE_AI_DEPLOYMENT`, `AZURE_AI_API_VERSION` | —, —, —, `2024-10-21`    | §3                                                                              |
| `OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_COMPATIBLE_API_KEY`, `OPENAI_COMPATIBLE_MODEL`   | —                        | §3                                                                              |

A blank value (`GROQ_API_KEY=`) counts as unset.

> **Real keys go in `backend/.env`, never in `backend/.env.example`.** The
> example is committed; `.env` is gitignored. `backend/test/config.test.ts`
> fails the build if a `KEY`, `SECRET`, `TOKEN` or `PASSWORD` variable has a
> value in the example, and if the example stops documenting any variable the
> API reads.

---

## 5. Sanity checks

```bash
curl -s localhost:4000/api/health     # {"data":{"status":"ok","database":"ok",…}}
npm run check                         # lint, format, typecheck, test, build
```
