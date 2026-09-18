import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/**
 * One client for local and cloud. The only difference is the endpoint: when
 * `DDB_ENDPOINT` is set we point at DynamoDB Local and use dummy credentials,
 * otherwise the SDK's default resolver finds the region and the IAM role.
 */
function buildClient(): DynamoDBClient {
  const endpoint = process.env.DDB_ENDPOINT;
  const region = process.env.AWS_REGION ?? 'ap-south-1';

  if (endpoint) {
    return new DynamoDBClient({
      region,
      endpoint,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'local',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'local',
      },
    });
  }
  return new DynamoDBClient({ region });
}

let cached: DynamoDBDocumentClient | null = null;

export function getDocClient(): DynamoDBDocumentClient {
  if (cached) return cached;
  cached = DynamoDBDocumentClient.from(buildClient(), {
    marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: false },
    unmarshallOptions: { wrapNumbers: false },
  });
  return cached;
}

export function getRawClient(): DynamoDBClient {
  return buildClient();
}

/** Drop the memoised client. Tests use this between table resets. */
export function resetDocClient(): void {
  cached = null;
}
