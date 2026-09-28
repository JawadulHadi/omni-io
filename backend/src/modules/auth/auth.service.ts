import { ConflictException, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AccessTokenPayload } from '../../common/request';
import { DbService } from '../../db/db.service';
import type { Role } from '../../db/tenant-context';
import { WorkspacesService } from '../workspaces/workspaces.service';
import type { GoogleProfile } from './google-oauth.service';
import { hashPassword, verifyPassword } from './password';

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_DAYS = 30;

export interface Session {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  workspaceId: string;
  role: Role;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const normalizeEmail = (e: string) => e.trim().toLowerCase();

/**
 * Short-lived JWT access tokens (15 min, `typ: 'access'`) + opaque refresh tokens
 * stored as SHA-256 hashes and rotated on every use. Each login starts a token
 * "family"; if an already-rotated token is ever presented again, someone copied
 * it, and the whole family is revoked.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly db: DbService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async register(input: { email: string; password: string; displayName: string; workspaceName: string }): Promise<Session> {
    const email = normalizeEmail(input.email);
    let userId: string;
    try {
      const [row] = await this.db.global<{ id: string }>(
        'insert into users (email, password_hash, display_name) values ($1, $2, $3) returning id',
        [email, await hashPassword(input.password), input.displayName],
      );
      userId = row.id;
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new ConflictException('An account with that email already exists');
      throw err;
    }
    const membership = await this.workspaces.create(userId, input.workspaceName);
    return this.issue(userId, membership.workspaceId, membership.role, randomUUID());
  }

  async login(email: string, password: string, preferredWorkspaceId?: string): Promise<Session> {
    const [user] = await this.db.global<{ id: string; password_hash: string | null }>(
      'select id, password_hash from auth_find_user($1)',
      [normalizeEmail(email)],
    );
    // verifyPassword burns the same time whether or not the user exists.
    const ok = await verifyPassword(password, user?.password_hash);
    if (!user || !ok) throw new UnauthorizedException('Invalid email or password');
    return this.startSession(user.id, preferredWorkspaceId);
  }

  async loginWithGoogle(profile: GoogleProfile): Promise<Session> {
    if (!profile.emailVerified) throw new UnauthorizedException('Your Google account email is not verified');
    const email = normalizeEmail(profile.email);

    let [user] = await this.db.global<{ id: string }>('select id from users where google_sub = $1', [profile.sub]);
    if (!user) {
      // Link to an existing email/password account (Google has verified the address), or create one.
      [user] = await this.db.global<{ id: string }>('select id from users where email = $1', [email]);
      if (user) {
        await this.db.global('update users set google_sub = $2 where id = $1', [user.id, profile.sub]);
      } else {
        [user] = await this.db.global<{ id: string }>(
          'insert into users (email, google_sub, display_name) values ($1, $2, $3) returning id',
          [email, profile.sub, profile.name ?? email],
        );
        await this.workspaces.create(user.id, `${profile.name ?? email.split('@')[0]}'s workspace`);
      }
    }
    return this.startSession(user.id);
  }

  /** Rotates the refresh token; optionally re-scopes the session to another workspace the user belongs to. */
  async refresh(rawToken: string | undefined, targetWorkspaceId?: string): Promise<Session> {
    if (!rawToken) throw new UnauthorizedException('No session');
    const hash = sha256(rawToken);

    const [token] = await this.db.global<{
      id: string;
      user_id: string;
      workspace_id: string;
      family_id: string;
      used_at: Date | null;
      revoked_at: Date | null;
      expired: boolean;
    }>(
      'select id, user_id, workspace_id, family_id, used_at, revoked_at, expires_at <= now() as expired from refresh_tokens where token_hash = $1',
      [hash],
    );
    if (!token || token.revoked_at || token.expired) throw new UnauthorizedException('Session expired — please sign in again');
    if (token.used_at) {
      await this.revokeFamily(token.family_id);
      this.logger.warn(`Refresh token reuse detected for user ${token.user_id}; revoked family ${token.family_id}`);
      throw new UnauthorizedException('Session expired — please sign in again');
    }

    // Decide the target workspace BEFORE consuming the token, so a rejected switch
    // doesn't leave the user with a burned token and no replacement.
    const workspaceId = targetWorkspaceId ?? token.workspace_id;
    let role = await this.roleIn(workspaceId, token.user_id);
    let scopedWorkspaceId = workspaceId;
    if (!role) {
      if (targetWorkspaceId) throw new ForbiddenException('You are not a member of that workspace');
      // Removed from the session's workspace since login: fall back to another membership.
      const [first] = await this.workspaces.memberships(token.user_id);
      if (!first) {
        await this.revokeFamily(token.family_id);
        throw new UnauthorizedException('You no longer belong to any workspace');
      }
      scopedWorkspaceId = first.workspaceId;
      role = first.role;
    }

    // Atomic consume: of two concurrent refreshes with the same token, exactly one wins.
    const consumed = await this.db.global('update refresh_tokens set used_at = now() where id = $1 and used_at is null returning id', [
      token.id,
    ]);
    if (consumed.length === 0) {
      await this.revokeFamily(token.family_id);
      throw new UnauthorizedException('Session expired — please sign in again');
    }
    return this.issue(token.user_id, scopedWorkspaceId, role, token.family_id);
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    await this.db.global(
      `update refresh_tokens set revoked_at = now()
       where family_id = (select family_id from refresh_tokens where token_hash = $1) and revoked_at is null`,
      [sha256(rawToken)],
    );
  }

  private async startSession(userId: string, preferredWorkspaceId?: string): Promise<Session> {
    const memberships = await this.workspaces.memberships(userId);
    if (memberships.length === 0) throw new ForbiddenException('Your account is not a member of any workspace');
    const chosen = memberships.find((m) => m.workspaceId === preferredWorkspaceId) ?? memberships[0];
    return this.issue(userId, chosen.workspaceId, chosen.role, randomUUID());
  }

  private async roleIn(workspaceId: string, userId: string): Promise<Role | null> {
    const [row] = await this.db.global<{ role: Role | null }>('select workspace_role($1, $2) as role', [workspaceId, userId]);
    return row?.role ?? null;
  }

  private async issue(userId: string, workspaceId: string, role: Role, familyId: string): Promise<Session> {
    const payload: AccessTokenPayload = { sub: userId, wid: workspaceId, role, typ: 'access' };
    const accessToken = this.jwt.sign(payload, { expiresIn: ACCESS_TTL_SECONDS });
    const refreshToken = randomBytes(32).toString('base64url');
    await this.db.global(
      `insert into refresh_tokens (user_id, workspace_id, family_id, token_hash, expires_at)
       values ($1, $2, $3, $4, now() + make_interval(days => $5))`,
      [userId, workspaceId, familyId, sha256(refreshToken), REFRESH_TTL_DAYS],
    );
    return { accessToken, expiresIn: ACCESS_TTL_SECONDS, refreshToken, workspaceId, role };
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.db.global('update refresh_tokens set revoked_at = now() where family_id = $1 and revoked_at is null', [familyId]);
  }
}
