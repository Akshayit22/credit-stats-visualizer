import { ERRORS, ok, withUser } from '@/server/api/respond';
import { statementUploadSchema } from '@/server/domain/schemas';
import { UnparseableStatementError, ingestStatement } from '@/server/domain/ingest';
import { listStatements } from '@/server/db/repositories/statements';
import { listAccounts } from '@/server/db/repositories/accounts';
import { getLlmFallback } from '@/server/llm';

export const dynamic = 'force-dynamic';
/** Parsing a long statement plus one LLM round trip needs more than the default. */
export const maxDuration = 60;

/**
 * The statement library. Accounts come along with it because every screen that
 * lists statements also needs to name their accounts.
 */
export const GET = withUser(async (user) => {
  const [statements, accounts] = await Promise.all([
    listStatements(user.userId),
    listAccounts(user.userId),
  ]);
  return ok({ statements, accounts });
});

/**
 * Upload. The body is extracted text — never a PDF, never the password.
 * Anything else is refused before it reaches the pipeline.
 */
export const POST = withUser(async (user, request) => {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return ERRORS.badRequest('Send the extracted text as JSON. PDF bytes are never uploaded.');
  }

  const payload = statementUploadSchema.parse(await request.json());

  try {
    const result = await ingestStatement({
      userId: user.userId,
      text: payload.text,
      contentHash: payload.contentHash,
      llm: getLlmFallback(),
    });
    return ok(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof UnparseableStatementError) {
      return ERRORS.badRequest(error.message);
    }
    throw error;
  }
});
