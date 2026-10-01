import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, randomUUID } from 'node:crypto';
import { sha256 } from '../../common/crypto';
import type { AccessTokenPayload } from '../../common/request';
import type { Env } from '../../config/env';
import { DbService, TenantQuery } from '../../db/db.service';
import type { Role } from '../../db/tenant-context';
import type { WorkspaceMembership } from '../workspaces/workspaces.models';
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
  /** Set when the request carried an invite link: whether it was accepted. */
  invitation?: 'accepted' | 'invalid';
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
  workspaceName?: string;
  inviteToken?: string;
}

const normalizeEmail = (e: string) => e.trim().toLowerCase();
const SIGNUP_CLOSED = 'Sign-up is closed — ask a workspace admin for an invite link';
const INVITE_INVALID = 'This invitation link is invalid, already used or expired';

/**
 * Short-lived JWT access tokens (15 min, `typ: 'access'`) + opaque refresh tokens
 * stored as SHA-256 hashes and rotated on every use. Each login starts a token
 * "family"; if an already-rotated token is ever presented again, someone copied
 * it, and the whole family is revoked.
 *
 * New accounts either get their own workspace (when sign-up is open) or join the
 * workspace of the invite link they arrived with — in the same transaction as the
 * user row, so a used-up link never leaves an account with no workspace.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly db: DbService,
    private readonly workspaces: WorkspacesService,
    private readonly cfg: ConfigService<Env, true>,
  ) {}

  get signupOpen(): boolean {
    return this.cfg.get('ALLOW_SIGNUP', { infer: true });
  }

  async register(input: RegisterInput): Promise<Session> {
    const email = normalizeEmail(input.email);
    const passwordHash = await hashPassword(input.password);
    const user = { email, passwordHash, googleSub: null, displayName: input.displayName };
    const { userId, membership } = await this.createAccount(user, input.inviteToken, input.workspaceName);
    const session = await this.issue(userId, membership.workspaceId, membership.role, randomUUID());
    return input.inviteToken ? { ...session, invitation: 'accepted' } : session;
  }

  async login(email: string, password: string, preferredWorkspaceId?: string, inviteToken?: string): Promise<Session> {
    const [user] = await this.db.global<{ id: string; password_hash: string | null }>(
      'select id, password_hash from auth_find_user($1)',
      [normalizeEmail(email)],
    );
    // verifyPassword burns the same time whether or not the user exists.
    const ok = await verifyPassword(password, user?.password_hash);
    if (!user || !ok) throw new UnauthorizedException('Invalid email or password');
    return this.startSession(user.id, preferredWorkspaceId, inviteToken);
  }

  async loginWithGoogle(profile: GoogleProfile, inviteToken?: string): Promise<Session> {
    if (!profile.emailVerified) throw new UnauthorizedException('Your Google account email is not verified');
    const email = normalizeEmail(profile.email);

    const [user] = await this.db.global<{ id: string }>('select id from users where google_sub = $1', [profile.sub]);
    if (user) return this.startSession(user.id, undefined, inviteToken);

    // Never link Google to an existing password account by email alone. Sign-up doesn't verify
    // email ownership, so whoever registered that address first could be anyone — linking would
    // drop the real owner into an account a stranger holds the password for.
    const [existing] = await this.db.global<{ id: string }>('select id from users where email = $1', [email]);
    if (existing) throw new GoogleAccountExistsException();

    const name = profile.name ?? email.split('@')[0];
    const created = await this.createAccount(
      { email, passwordHash: null, googleSub: profile.sub, displayName: profile.name ?? email },
      inviteToken,
      `${name}'s workspace`,
    );
    const session = await this.issue(created.userId, created.membership.workspaceId, created.membership.role, randomUUID());
    return inviteToken ? { ...session, invitation: 'accepted' } : session;
  }

  /** Creates the user, then either joins the invited workspace (same transaction) or creates their own. */
  private async createAccount(
    user: { email: string; passwordHash: string | null; googleSub: string | null; displayName: string },
    inviteToken: string | undefined,
    workspaceName: string | undefined,
  ): Promise<{ userId: string; membership: WorkspaceMembership }> {
    if (!inviteToken) {
      if (!this.signupOpen) throw new ForbiddenException(SIGNUP_CLOSED);
      if (!workspaceName?.trim()) throw new BadRequestException('workspaceName is required');
    }
    const insertUser = async (q: TenantQuery) => {
      try {
        const [row] = await q<{ id: string }>(
          'insert into users (email, password_hash, google_sub, display_name) values ($1, $2, $3, $4) returning id',
          [user.email, user.passwordHash, user.googleSub, user.displayName],
        );
        return row.id;
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw new ConflictException('An account with that email already exists');
        throw err;
      }
    };

    if (inviteToken) {
      return this.db.globalTransaction(async (q) => {
        const userId = await insertUser(q);
        const membership = await this.workspaces.acceptInvitation(userId, inviteToken, q);
        if (!membership) throw new BadRequestException(INVITE_INVALID); // rolls the user back too
        return { userId, membership };
      });
    }
    const userId = await insertUser((sql, params) => this.db.global(sql, params));
    return { userId, membership: await this.workspaces.create(userId, workspaceName!.trim()) };
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

  /** Starts a session in the preferred workspace — or, when an invite link came along, in the one it joins. */
  private async startSession(userId: string, preferredWorkspaceId?: string, inviteToken?: string): Promise<Session> {
    const joined = inviteToken ? await this.workspaces.acceptInvitation(userId, inviteToken) : null;
    const memberships = await this.workspaces.memberships(userId);
    if (memberships.length === 0) throw new ForbiddenException('Your account is not a member of any workspace');
    const target = joined?.workspaceId ?? preferredWorkspaceId;
    const chosen = memberships.find((m) => m.workspaceId === target) ?? memberships[0];
    const session = await this.issue(userId, chosen.workspaceId, chosen.role, randomUUID());
    return inviteToken ? { ...session, invitation: joined ? 'accepted' : 'invalid' } : session;
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

/** A password account already uses the Google account's email address. */
export class GoogleAccountExistsException extends ConflictException {
  constructor() {
    super('An account with this email already exists — sign in with your password');
  }
}
