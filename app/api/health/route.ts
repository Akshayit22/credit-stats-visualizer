import { NextResponse } from 'next/server';
import { DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { getRawClient } from '@/server/db/client';
import { TABLE_KINDS, tableName, tablePrefix } from '@/server/db/table-names';

export const dynamic = 'force-dynamic';

/**
 * Liveness plus the one dependency that matters locally: are the five tables
 * there? Returns 200 when everything is reachable, 503 when it is not, so
 * `curl -fsS localhost:3000/api/health` is a usable readiness gate.
 */
export async function GET() {
  const client = getRawClient();
  const tables: Record<string, 'ok' | 'missing'> = {};
  let unreachable: string | null = null;

  for (const kind of TABLE_KINDS) {
    const name = tableName(kind);
    try {
      await client.send(new DescribeTableCommand({ TableName: name }));
      tables[name] = 'ok';
    } catch (error) {
      tables[name] = 'missing';
      if (error instanceof Error && error.name !== 'ResourceNotFoundException') {
        unreachable = error.name;
      }
    }
  }

  const healthy = unreachable === null && Object.values(tables).every((s) => s === 'ok');

  return NextResponse.json(
    {
      data: {
        status: healthy ? 'ok' : 'degraded',
        tablePrefix: tablePrefix(),
        endpoint: process.env.DDB_ENDPOINT ?? 'aws-default',
        region: process.env.AWS_REGION ?? 'ap-south-1',
        llmProvider: process.env.LLM_PROVIDER ?? 'mock',
        tables,
        ...(unreachable ? { dynamodb: unreachable } : {}),
      },
    },
    { status: healthy ? 200 : 503 },
  );
}
