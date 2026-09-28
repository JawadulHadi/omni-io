import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { Env, googleOAuthEnabled } from '../../config/env';

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Authorization-code flow with PKCE and a `state` cookie — no session store and
 * no passport. The ID token arrives straight from Google's token endpoint over
 * TLS in exchange for our client secret, which OIDC Core §3.1.3.7 accepts in
 * place of verifying its signature; we still check `iss` and `aud`.
 */
@Injectable()
export class GoogleOAuthService {
  constructor(private readonly cfg: ConfigService<Env, true>) {}

  get enabled(): boolean {
    return googleOAuthEnabled(this.env());
  }

  /** Returns the redirect URL plus the value to store in the short-lived state cookie. */
  begin(): { url: string; cookie: string } {
    const env = this.requireEnabled();
    const state = randomBytes(16).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      redirect_uri: env.GOOGLE_CALLBACK_URL!,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    return { url: `${AUTH_URL}?${params}`, cookie: `${state}.${verifier}` };
  }

  async complete(code: string | undefined, state: string | undefined, cookie: string | undefined): Promise<GoogleProfile> {
    const env = this.requireEnabled();
    const [expectedState, verifier] = (cookie ?? '').split('.');
    if (!code || !state || !expectedState || state !== expectedState || !verifier) {
      throw new UnauthorizedException('Google sign-in failed: state mismatch — please try again');
    }

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID!,
        client_secret: env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: env.GOOGLE_CALLBACK_URL!,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new UnauthorizedException('Google sign-in failed: code exchange rejected');
    const { id_token: idToken } = (await res.json()) as { id_token?: string };
    const claims = decodeJwtPayload(idToken);

    const issuerOk = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
    if (!issuerOk || claims.aud !== env.GOOGLE_CLIENT_ID || typeof claims.sub !== 'string' || typeof claims.email !== 'string') {
      throw new UnauthorizedException('Google sign-in failed: unexpected ID token');
    }
    return {
      sub: claims.sub,
      email: claims.email,
      emailVerified: claims.email_verified === true,
      name: typeof claims.name === 'string' ? claims.name : undefined,
    };
  }

  private env(): Env {
    return {
      GOOGLE_CLIENT_ID: this.cfg.get('GOOGLE_CLIENT_ID', { infer: true }),
      GOOGLE_CLIENT_SECRET: this.cfg.get('GOOGLE_CLIENT_SECRET', { infer: true }),
      GOOGLE_CALLBACK_URL: this.cfg.get('GOOGLE_CALLBACK_URL', { infer: true }),
    } as Env;
  }

  private requireEnabled(): Env {
    const env = this.env();
    if (!googleOAuthEnabled(env)) throw new NotFoundException('Google sign-in is not configured');
    return env;
  }
}

function decodeJwtPayload(token: string | undefined): Record<string, unknown> {
  const payload = token?.split('.')[1];
  if (!payload) throw new UnauthorizedException('Google sign-in failed: no ID token');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}
