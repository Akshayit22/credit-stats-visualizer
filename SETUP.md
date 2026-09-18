# cred-stats — setup

A checklist you can follow top to bottom. The **first section alone** gives you a
working app with demo data: no Google account, no AWS account, no API key.

---

## 0. Prerequisites

| Need | Check |
|---|---|
| Node 20+ | `node -v` |
| npm | `npm -v` |
| Docker Desktop, running | `docker info` |

---

## 1. Run it locally with demo data (5 minutes, no credentials)

```bash
git clone <this repo> && cd cred-stats
npm ci
cp .env.example .env.local          # the defaults are already the local ones
npm run db:up                       # DynamoDB Local + dynamodb-admin in Docker
npm run db:create                   # creates the 5 tables
npm run db:seed                     # loads demo accounts, statements, transactions
npm run dev:nollm                   # starts on http://localhost:3000 with the mock LLM
```

Open <http://localhost:3000>. `CRED_STATS_DEV_LOGIN=true` in `.env.local` signs
you in as a fixed demo user, so you never see the Google button. This bypass is
refused whenever `NODE_ENV=production`.

Useful while developing:

| URL | What |
|---|---|
| <http://localhost:3000> | the app |
| <http://localhost:3000/api/health> | table + provider status, 200 when healthy |
| <http://localhost:8001> | dynamodb-admin — browse and edit every item |
| <http://localhost:8000> | DynamoDB Local itself (returns 400 to a bare GET; that means it is up) |

Reset everything: `npm run db:reset`. Stop the containers: `npm run db:down`.

---

## 2. Google sign-in

Only needed when you want real sign-in instead of the dev bypass.

1. Go to <https://console.cloud.google.com/>.
2. Top bar → project picker → **New project** (or pick an existing one). Name it
   anything, e.g. `cred-stats`.
3. Left nav → **APIs & Services** → **OAuth consent screen**.
   - User type: **External** → Create.
   - App name `cred-stats`, user support email: your own, developer contact: your own.
   - Save and continue through Scopes (add none) and Test users.
   - On **Test users** → **Add users** → add **your own Google address**. While the
     app is in Testing mode only listed test users can sign in.
4. Left nav → **Credentials** → **Create credentials** → **OAuth client ID**.
   - Application type: **Web application**.
   - Name: `cred-stats local`.
   - **Authorised JavaScript origins** → Add URI → `http://localhost:3000`
   - **Authorised redirect URIs** → Add URI →
     `http://localhost:3000/api/auth/callback/google`
   - Create.
5. Copy the **Client ID** and **Client secret** into `.env.local`:

```bash
GOOGLE_CLIENT_ID=<client id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<client secret>
```

6. Generate the session secret and set the URL:

```bash
openssl rand -base64 32     # paste into AUTH_SECRET
```

```bash
AUTH_SECRET=<the value you just generated>
NEXTAUTH_URL=http://localhost:3000
CRED_STATS_DEV_LOGIN=false
```

7. `npm run dev` and click **Continue with Google**.

> Redirect URI mismatch is the one failure you will hit. The URI must be exactly
> `http://localhost:3000/api/auth/callback/google` — no trailing slash, `http`
> not `https`, port included.

---

## 3. AI provider

The deterministic parsers handle the two banks we ship. The LLM is the fallback
for any other bank and for merchants no rule matches. Pick **one** provider and
set `LLM_PROVIDER` to its id.

### `mock` — no key at all (default)

```bash
LLM_PROVIDER=mock
```

Returns fixture JSON. `npm run dev:nollm` forces this regardless of `.env.local`.

### `azure-foundry` — Azure AI Foundry / Azure OpenAI

1. <https://ai.azure.com/> → your **project** (create one if needed).
2. Left nav → **Models + endpoints** → **Deploy model** → pick a model → Deploy.
3. Open the deployment. Copy:
   - **Target URI** → `AZURE_AI_ENDPOINT` (just the host part, e.g.
     `https://my-project.openai.azure.com`)
   - **Key** → `AZURE_AI_API_KEY`
   - **Deployment name** → `AZURE_AI_DEPLOYMENT`
   - the API version shown in the sample code → `AZURE_AI_API_VERSION`
     (e.g. `2024-10-21`)

```bash
LLM_PROVIDER=azure-foundry
AZURE_AI_ENDPOINT=https://<your-resource>.openai.azure.com
AZURE_AI_API_KEY=<key>
AZURE_AI_DEPLOYMENT=<deployment name>
AZURE_AI_API_VERSION=2024-10-21
```

### `bedrock` — Amazon Bedrock

1. AWS console → **Bedrock** → switch to your region (`ap-south-1` for Mumbai).
2. Left nav → **Model access** → **Modify model access** → tick the models you
   want → Save. Access is per-region and can take a few minutes.
3. Credentials: `aws configure` (a profile the SDK will find), or an IAM user's
   access keys in the env. In the cloud, prefer the instance role and set nothing.

```bash
LLM_PROVIDER=bedrock
AWS_REGION=ap-south-1
BEDROCK_MODEL_ID=apac.anthropic.claude-sonnet-4-5-20250929-v1:0
# optional, only if you are not using a profile or an instance role:
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

> Careful: `AWS_ACCESS_KEY_ID=local` from the DynamoDB Local section would also
> be picked up by Bedrock. If you use Bedrock locally, either use a named AWS
> profile or accept that DynamoDB Local ignores credentials entirely and set the
> real ones.

### `groq`

1. <https://console.groq.com/keys> → **Create API Key** → copy it once.
2. Model ids are listed at <https://console.groq.com/docs/models>.

```bash
LLM_PROVIDER=groq
GROQ_API_KEY=gsk_...
GROQ_MODEL=llama-3.3-70b-versatile
```

### `openai-compatible` — xAI Grok, OpenAI, OpenRouter, Ollama

Any endpoint that speaks `POST {base}/chat/completions` with a bearer token.

```bash
LLM_PROVIDER=openai-compatible
```

| Service | `OPENAI_COMPATIBLE_BASE_URL` | Key from | Example model |
|---|---|---|---|
| xAI Grok | `https://api.x.ai/v1` | <https://console.x.ai/> → API Keys | `grok-4` |
| OpenAI | `https://api.openai.com/v1` | <https://platform.openai.com/api-keys> | `gpt-4.1-mini` |
| OpenRouter | `https://openrouter.ai/api/v1` | <https://openrouter.ai/keys> | `meta-llama/llama-3.3-70b-instruct` |
| Ollama (local) | `http://localhost:11434/v1` | any non-empty string | `llama3.1` |

```bash
OPENAI_COMPATIBLE_BASE_URL=https://api.x.ai/v1
OPENAI_COMPATIBLE_API_KEY=xai-...
OPENAI_COMPATIBLE_MODEL=grok-4
```

---

## 4. Every environment variable

| Variable | Needed for | Where it comes from |
|---|---|---|
| `NEXTAUTH_URL` | auth | `http://localhost:3000` locally; the public origin in the cloud |
| `AUTH_SECRET` | auth | `openssl rand -base64 32` |
| `CRED_STATS_DEV_LOGIN` | local only | `true` to sign in as the demo user. Refused when `NODE_ENV=production` |
| `GOOGLE_CLIENT_ID` | auth | §2 |
| `GOOGLE_CLIENT_SECRET` | auth | §2 |
| `DDB_ENDPOINT` | local only | `http://localhost:8000`. **Leave unset in the cloud** so the SDK uses the default resolver and the IAM role |
| `DDB_TABLE_PREFIX` | always | `cred-stats-local` / `cred-stats-dev` / `cred-stats-prod` |
| `AWS_REGION` | always | `ap-south-1` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | local | any non-empty value; DynamoDB Local ignores them |
| `LLM_PROVIDER` | parsing fallback | §3 |
| `AZURE_AI_*` | azure-foundry | §3 |
| `BEDROCK_MODEL_ID` | bedrock | §3 |
| `GROQ_API_KEY` / `GROQ_MODEL` | groq | §3 |
| `OPENAI_COMPATIBLE_*` | openai-compatible | §3 |

Missing provider variables fail loudly at first use, naming exactly what is absent.

---

## 5. Sanity checks

```bash
curl -s localhost:3000/api/health | jq     # status "ok" and 5 tables "ok"
npm run lint && npm run typecheck && npm run test && npm run build
```
