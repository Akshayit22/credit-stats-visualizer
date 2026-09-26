import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { verifyGoogleIdToken } from '../../src/managers/google-auth-client.manager.js';

/** Tokens signed with a local key standing in for Google's. */
const CLIENT_ID = 'client.apps.googleusercontent.com';
let keys: ReturnType<typeof createLocalJWKSet>;
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  keys = createLocalJWKSet({
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' }],
  });
});

function token(
  claims: Record<string, unknown>,
  options: { audience?: string; issuer?: string } = {},
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setSubject('google-sub-1')
    .setIssuer(options.issuer ?? 'https://accounts.google.com')
    .setAudience(options.audience ?? CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(privateKey);
}

const verified = {
  email: 'priya@example.com',
  email_verified: true,
  name: 'Priya',
  picture: 'https://x/p.png',
};

describe('verifying a Google ID token', () => {
  it('accepts a token Google signed for our client', async () => {
    expect(await verifyGoogleIdToken(await token(verified), CLIENT_ID, keys)).toEqual({
      subject: 'google-sub-1',
      email: 'priya@example.com',
      name: 'Priya',
      avatarUrl: 'https://x/p.png',
    });
  });

  it('refuses a token minted for another site', async () => {
    const other = await token(verified, { audience: 'someone-else.apps.googleusercontent.com' });
    expect(await verifyGoogleIdToken(other, CLIENT_ID, keys)).toBeNull();
  });

  it('refuses a token from another issuer', async () => {
    const forged = await token(verified, { issuer: 'https://evil.example.com' });
    expect(await verifyGoogleIdToken(forged, CLIENT_ID, keys)).toBeNull();
  });

  it('refuses an unverified email', async () => {
    const unverified = await token({ ...verified, email_verified: false });
    expect(await verifyGoogleIdToken(unverified, CLIENT_ID, keys)).toBeNull();
  });

  it('refuses a token signed with a key that is not Google’s', async () => {
    const stranger = await generateKeyPair('RS256');
    const forged = await new SignJWT(verified)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setSubject('x')
      .setIssuer('https://accounts.google.com')
      .setAudience(CLIENT_ID)
      .setExpirationTime('10m')
      .sign(stranger.privateKey);
    expect(await verifyGoogleIdToken(forged, CLIENT_ID, keys)).toBeNull();
  });

  it('refuses garbage', async () => {
    expect(await verifyGoogleIdToken('not-a-token', CLIENT_ID, keys)).toBeNull();
  });
});
