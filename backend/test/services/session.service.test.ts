import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import type { Environment } from '../../src/services/environment.service.js';
import type { LogService } from '../../src/services/log.service.js';
import { SessionService } from '../../src/services/session.service.js';

const SECRET = 'x'.repeat(40);
const log = { warn: () => {} } as unknown as LogService;

function sessions(secret: string | undefined = SECRET): SessionService {
  return new SessionService(
    { env: { CRED_STATS_SESSION_SECRET: secret } } as unknown as Environment,
    log,
  );
}

const user = { userId: 'u'.repeat(32), email: 'a@example.com', name: 'A', avatarUrl: '' };

describe('SessionService', () => {
  it('round-trips a user through a token', async () => {
    const service = sessions();
    expect(await service.verify(await service.issue(user))).toEqual(user);
  });

  it('refuses a token signed with another secret', async () => {
    const token = await sessions('y'.repeat(40)).issue(user);
    expect(await sessions().verify(token)).toBeNull();
  });

  it('refuses an expired token', async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.userId)
      .setIssuer('cred-stats-api')
      .setAudience('cred-stats-web')
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(SECRET));
    expect(await sessions().verify(token)).toBeNull();
  });

  it('refuses the "none" algorithm', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ sub: user.userId })).toString('base64url');
    expect(await sessions().verify(`${header}.${body}.`)).toBeNull();
  });

  it('works without a configured secret outside production', async () => {
    const service = sessions(undefined);
    expect(await service.verify(await service.issue(user))).toEqual(user);
  });
});
