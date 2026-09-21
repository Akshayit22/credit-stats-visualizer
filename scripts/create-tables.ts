/**
 * Creates the five DynamoDB tables against whatever endpoint the environment
 * points at — DynamoDB Local by default. Also writes the same definitions to
 * `infra/tables.json` so the cloud round can hand them straight to CDK/CFN.
 *
 *   npm run db:create            create anything missing
 *   npm run db:create -- --drop  delete first, then recreate (destroys data)
 */
import { config as loadEnv } from 'dotenv';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  ResourceNotFoundException,
  waitUntilTableExists,
  waitUntilTableNotExists,
} from '@aws-sdk/client-dynamodb';
import { getRawClient } from '../src/server/db/client';
import { allTableDefinitions } from '../src/server/db/table-definitions';
import { TABLE_KINDS, tablePrefix } from '../src/server/db/table-names';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ quiet: true });

const drop = process.argv.includes('--drop');
const client = getRawClient();

async function exists(name: string): Promise<boolean> {
  try {
    await client.send(new DescribeTableCommand({ TableName: name }));
    return true;
  } catch (error) {
    if (error instanceof ResourceNotFoundException) return false;
    throw error;
  }
}

async function main(): Promise<void> {
  const endpoint = process.env.DDB_ENDPOINT ?? '(aws default endpoint)';
  console.log(`prefix   ${tablePrefix()}`);
  console.log(`endpoint ${endpoint}`);
  console.log(`region   ${process.env.AWS_REGION ?? 'ap-south-1'}\n`);

  for (const definition of allTableDefinitions()) {
    const name = definition.TableName as string;

    if (drop && (await exists(name))) {
      await client.send(new DeleteTableCommand({ TableName: name }));
      await waitUntilTableNotExists({ client, maxWaitTime: 60 }, { TableName: name });
      console.log(`dropped  ${name}`);
    }

    if (await exists(name)) {
      console.log(`exists   ${name}`);
      continue;
    }

    await client.send(new CreateTableCommand(definition));
    await waitUntilTableExists({ client, maxWaitTime: 60 }, { TableName: name });
    const gsis = (definition.GlobalSecondaryIndexes ?? []).map((g) => g.IndexName).join(', ');
    console.log(`created  ${name}${gsis ? `  (${gsis})` : ''}`);
  }

  writeInfra();
  console.log(`\n${TABLE_KINDS.length} tables ready. infra/tables.json refreshed.`);
}

/**
 * The same shapes as CloudFormation resource properties, with the table name
 * left as a `<prefix>` placeholder so one file serves dev and prod.
 */
function writeInfra(): void {
  const resources = allTableDefinitions().map((definition) => {
    const name = definition.TableName as string;
    return {
      Type: 'AWS::DynamoDB::Table',
      Properties: {
        // `Fn::Sub`, not a bare string: CloudFormation only substitutes `${Env}`
        // inside one. Emitted plainly it asks DynamoDB for a table literally
        // named `cred-stats-${Env}-users`, and `$`, `{` and `}` are not legal
        // in a table name — so the stack fails on create rather than making
        // something wrong, which is the only mercy in it.
        TableName: { 'Fn::Sub': name.replace(tablePrefix(), 'cred-stats-${Env}') },
        BillingMode: definition.BillingMode,
        AttributeDefinitions: definition.AttributeDefinitions,
        KeySchema: definition.KeySchema,
        ...(definition.GlobalSecondaryIndexes
          ? { GlobalSecondaryIndexes: definition.GlobalSecondaryIndexes }
          : {}),
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
        SSESpecification: { SSEEnabled: true },
        DeletionProtectionEnabled: true,
      },
    };
  });

  const logicalIds = TABLE_KINDS.map(
    (kind) => `${kind.charAt(0).toUpperCase()}${kind.slice(1)}Table`,
  );
  const template = {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'cred-stats — the five DynamoDB tables (Round 1).',
    Parameters: {
      Env: { Type: 'String', AllowedValues: ['dev', 'prod'], Default: 'dev' },
    },
    Resources: Object.fromEntries(logicalIds.map((id, i) => [id, resources[i]])),
    Outputs: Object.fromEntries(
      TABLE_KINDS.map((kind, i) => [
        `${logicalIds[i]}Name`,
        { Value: { Ref: logicalIds[i] }, Description: `cred-stats ${kind} table` },
      ]),
    ),
  };

  mkdirSync(resolve('infra'), { recursive: true });
  writeFileSync(resolve('infra/tables.json'), `${JSON.stringify(template, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
