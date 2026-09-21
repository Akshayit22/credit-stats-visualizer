/// <reference path="./.sst/platform/config.d.ts" />

/**
 * The cloud deployment: Next.js on Lambda, behind CloudFront, with the static
 * assets on S3. `sst deploy` builds the app through OpenNext and puts each
 * piece where it belongs.
 *
 * **This stack does not own the five DynamoDB tables, on purpose.** They hold
 * the only thing in this system that cannot be rebuilt, and an app stack is
 * something you tear down and redeploy while you are still working out what
 * the app is. `infra/tables.json` creates them — a CloudFormation template
 * generated from the same `table-definitions.ts` the local tables are made
 * from, so there is one source of truth and no schema to keep in step here.
 * What this stack does is grant the Lambda exactly the six actions the
 * repositories use against those tables, and nothing else.
 *
 * Three environment variables are deliberately absent:
 *
 * - `AWS_REGION` is reserved by Lambda and cannot be set. The runtime supplies
 *   it, which is what `src/server/db/client.ts` reads.
 * - `DDB_ENDPOINT` must stay unset in the cloud. `client.ts` branches on it:
 *   absent, the SDK's default chain finds the execution role. Set, it would
 *   look for DynamoDB on localhost.
 * - `NEXTAUTH_URL` is unnecessary — `authConfig` already sets `trustHost`, so
 *   Auth.js reads the host from the request. Which is just as well, since the
 *   CloudFront domain is not known until after this stack is created.
 */
export default $config({
  app(input) {
    return {
      name: 'cred-stats',
      home: 'aws',
      // A removal of prod keeps the bucket and distribution rather than
      // deleting them out from under whoever is using the site.
      removal: input?.stage === 'prod' ? 'retain' : 'remove',
      protect: input?.stage === 'prod',
      providers: { aws: { region: 'ap-south-1' } },
    };
  },

  async run() {
    // Set with `npx sst secret set <Name> <value> --stage <stage>`. They are
    // held in SSM Parameter Store, not in this file and not in the repo.
    const authSecret = new sst.Secret('AuthSecret');
    const googleClientId = new sst.Secret('GoogleClientId');
    const googleClientSecret = new sst.Secret('GoogleClientSecret');
    const groqApiKey = new sst.Secret('GroqApiKey');

    const region = aws.getRegionOutput().name;
    const account = aws.getCallerIdentityOutput().accountId;

    /** Matches the `Env` parameter that `infra/tables.json` is deployed with. */
    const tablePrefix = `cred-stats-${$app.stage}`;

    const site = new sst.aws.Nextjs('Web', {
      environment: {
        DDB_TABLE_PREFIX: tablePrefix,
        AUTH_SECRET: authSecret.value,
        GOOGLE_CLIENT_ID: googleClientId.value,
        GOOGLE_CLIENT_SECRET: googleClientSecret.value,
        LLM_PROVIDER: 'groq',
        GROQ_MODEL: 'openai/gpt-oss-120b',
        GROQ_API_KEY: groqApiKey.value,
      },
      server: {
        // `app/api/statements/route.ts` declares maxDuration = 60 for the one
        // request that can call a model: a statement no parser recognises.
        // A shorter Lambda timeout would cut that upload off mid-extraction.
        timeout: '60 seconds',
        memory: '1024 MB',
      },
      permissions: [
        {
          // Exactly what the repositories call. No Scan — nothing in the app
          // scans — and nothing that could alter or drop a table.
          actions: [
            'dynamodb:GetItem',
            'dynamodb:PutItem',
            'dynamodb:UpdateItem',
            'dynamodb:DeleteItem',
            'dynamodb:Query',
            'dynamodb:BatchWriteItem',
          ],
          resources: [
            $interpolate`arn:aws:dynamodb:${region}:${account}:table/${tablePrefix}-*`,
            $interpolate`arn:aws:dynamodb:${region}:${account}:table/${tablePrefix}-*/index/*`,
          ],
        },
      ],
    });

    return {
      url: site.url,
      /** Paste this into the Google OAuth client before signing in. */
      googleCallbackUrl: $interpolate`${site.url}api/auth/callback/google`,
    };
  },
});
