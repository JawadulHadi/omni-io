import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { randomToken, sha256 } from '../../common/crypto';
import type { AuthUser } from '../../common/request';
import type { Env } from '../../config/env';
import { DbService, TenantQuery } from '../../db/db.service';
import { Role, ROLE_RANK, TenantContext } from '../../db/tenant-context';
import { DEFAULT_WIDGET_THEME } from '../widget/widget-theme';
import {
  CreatedInvitation,
  CreateInvitationInput,
  Invitation,
  LadderSettingsInput,
  Member,
  UpdateMemberRoleInput,
  Workspace,
  WorkspaceMembership,
} from './workspaces.models';

export interface LadderSettings {
  confidenceThreshold: number;
  similarityFloor: number;
}

const WORKSPACE_COLUMNS = 'id, name, plan, widget_key, confidence_threshold, similarity_floor, created_at';

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly db: DbService,
    private readonly tenant: TenantContext,
    private readonly cfg: ConfigService<Env, true>,
  ) {}

  async current(): Promise<Workspace> {
    const [row] = await this.db.query(`select ${WORKSPACE_COLUMNS} from workspaces where id = $1`, [
      this.tenant.requireWorkspaceId(),
    ]);
    if (!row) throw new NotFoundException('Workspace not found');
    return toWorkspace(row);
  }

  async ladderSettings(): Promise<LadderSettings> {
    const w = await this.current();
    return { confidenceThreshold: w.confidenceThreshold, similarityFloor: w.similarityFloor };
  }

  async updateLadderSettings(input: LadderSettingsInput): Promise<Workspace> {
    const [row] = await this.db.query(
      `update workspaces set confidence_threshold = $2, similarity_floor = $3 where id = $1 returning ${WORKSPACE_COLUMNS}`,
      [this.tenant.requireWorkspaceId(), input.confidenceThreshold, input.similarityFloor],
    );
    return toWorkspace(row);
  }

  /** Every workspace a user belongs to — a pre-tenant lookup, so it goes through the definer function. */
  async memberships(userId: string): Promise<WorkspaceMembership[]> {
    const rows = await this.db.global('select workspace_id, name, role from user_workspaces($1)', [userId]);
    return rows.map((r) => ({ workspaceId: r.workspace_id, name: r.name, role: r.role }));
  }

  /** A workspace the signed-in user asked for — capped, so one account can't mint workspaces without limit. */
  async createOwned(userId: string, name: string): Promise<WorkspaceMembership> {
    const max = this.cfg.get('MAX_WORKSPACES_PER_USER', { infer: true });
    const owned = (await this.memberships(userId)).filter((m) => m.role === 'owner').length;
    if (owned >= max) throw new ForbiddenException(`You already own ${owned} workspaces (the limit is ${max})`);
    return this.create(userId, name);
  }

  /** New workspace with `userId` as owner. The id is minted here so the RLS context can be set before the insert. */
  async create(userId: string, name: string): Promise<WorkspaceMembership> {
    const workspaceId = randomUUID();
    await this.db.withWorkspace(workspaceId, () =>
      this.db.tenant(async (q) => {
        await q('insert into workspaces (id, name) values ($1, $2)', [workspaceId, name]);
        await q(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);
        await q('insert into widget_configs (workspace_id, theme) values ($1, $2)', [
          workspaceId,
          { ...DEFAULT_WIDGET_THEME, title: name },
        ]);
      }),
    );
    return { workspaceId, name, role: 'owner' };
  }

  async members(): Promise<Member[]> {
    const rows = await this.db.query(
      `select m.user_id, u.email, u.display_name, m.role, m.created_at
       from workspace_members m join users u on u.id = m.user_id
       where m.workspace_id = $1
       order by m.created_at`,
      [this.tenant.requireWorkspaceId()],
    );
    return rows.map(toMember);
  }

  /**
   * A single-use invite link, valid for 7 days. Nobody is added until the person
   * opens it and accepts — and since it isn't tied to an email address, it says
   * nothing about who has an account.
   */
  async createInvitation(caller: AuthUser, input: CreateInvitationInput): Promise<CreatedInvitation> {
    assertMayGrant(caller.role, input.role);
    const token = randomToken();
    const [row] = await this.db.query(
      `insert into workspace_invitations (workspace_id, token_hash, label, role, created_by)
       values ($1, $2, $3, $4, $5)
       returning ${INVITATION_COLUMNS}`,
      [this.tenant.requireWorkspaceId(), sha256(token), input.label?.trim() || null, input.role, caller.userId],
    );
    return { token, invitation: toInvitation(row) };
  }

  async invitations(): Promise<Invitation[]> {
    const rows = await this.db.query(
      `select ${INVITATION_COLUMNS} from workspace_invitations where workspace_id = $1 and expires_at > now() order by created_at desc`,
      [this.tenant.requireWorkspaceId()],
    );
    return rows.map(toInvitation);
  }

  async revokeInvitation(id: string): Promise<boolean> {
    const rows = await this.db.query('delete from workspace_invitations where id = $1 returning id', [id]);
    if (rows.length === 0) throw new NotFoundException('Invitation not found');
    return true;
  }

  /** Pre-tenant: is this a live invitation? (The invitee isn't a member yet.) */
  async previewInvitation(token: string): Promise<WorkspaceMembership | null> {
    const [row] = await this.db.global('select workspace_id, workspace_name, role from invitation_preview($1)', [sha256(token)]);
    return row ? { workspaceId: row.workspace_id, name: row.workspace_name, role: row.role } : null;
  }

  /**
   * Consumes the invitation and adds the membership. An existing member keeps
   * their role. Pass `q` to run inside a caller's transaction. Null if the link
   * is unknown, used or expired.
   */
  async acceptInvitation(userId: string, token: string, q: TenantQuery = (sql, params) => this.db.global(sql, params)): Promise<WorkspaceMembership | null> {
    const [row] = await q('select workspace_id, workspace_name, role from accept_invitation($1, $2)', [sha256(token), userId]);
    return row ? { workspaceId: row.workspace_id, name: row.workspace_name, role: row.role } : null;
  }

  async updateMemberRole(caller: AuthUser, input: UpdateMemberRoleInput): Promise<Member> {
    assertMayGrant(caller.role, input.role);
    return this.db.tenant(async (q) => {
      const current = await this.lockedRole(q, input.userId);
      assertMayModify(caller.role, current);
      if (current === 'owner' && input.role !== 'owner') await this.assertNotLastOwner(q);
      await q('update workspace_members set role = $3 where workspace_id = $1 and user_id = $2', [
        this.tenant.requireWorkspaceId(),
        input.userId,
        input.role,
      ]);
      return this.memberRow(q, input.userId);
    });
  }

  async removeMember(caller: AuthUser, userId: string): Promise<boolean> {
    return this.db.tenant(async (q) => {
      const current = await this.lockedRole(q, userId);
      assertMayModify(caller.role, current);
      if (current === 'owner') await this.assertNotLastOwner(q);
      await q('delete from workspace_members where workspace_id = $1 and user_id = $2', [this.tenant.requireWorkspaceId(), userId]);
      return true;
    });
  }

  private async lockedRole(q: TenantQuery, userId: string): Promise<Role> {
    const [row] = await q<{ role: Role }>(
      'select role from workspace_members where workspace_id = $1 and user_id = $2 for update',
      [this.tenant.requireWorkspaceId(), userId],
    );
    if (!row) throw new NotFoundException('Not a member of this workspace');
    return row.role;
  }

  private async assertNotLastOwner(q: TenantQuery): Promise<void> {
    const owners = await q(`select user_id from workspace_members where workspace_id = $1 and role = 'owner' for update`, [
      this.tenant.requireWorkspaceId(),
    ]);
    if (owners.length <= 1) throw new ForbiddenException('A workspace must keep at least one owner');
  }

  private async memberRow(q: TenantQuery, userId: string): Promise<Member> {
    const [row] = await q(
      `select m.user_id, u.email, u.display_name, m.role, m.created_at
       from workspace_members m join users u on u.id = m.user_id
       where m.workspace_id = $1 and m.user_id = $2`,
      [this.tenant.requireWorkspaceId(), userId],
    );
    return toMember(row);
  }
}

/** Nobody can hand out a role above their own; only owners can mint owners. */
function assertMayGrant(callerRole: Role, newRole: Role) {
  if (ROLE_RANK[newRole] > ROLE_RANK[callerRole]) throw new ForbiddenException(`You can't grant a role above your own (${callerRole})`);
}

/** Admins can't demote or remove owners. */
function assertMayModify(callerRole: Role, targetRole: Role) {
  if (ROLE_RANK[targetRole] > ROLE_RANK[callerRole]) throw new ForbiddenException(`Only an ${targetRole} can change another ${targetRole}`);
}

function toWorkspace(r: any): Workspace {
  return {
    id: r.id,
    name: r.name,
    plan: r.plan,
    widgetKey: r.widget_key,
    confidenceThreshold: Number(r.confidence_threshold),
    similarityFloor: Number(r.similarity_floor),
    createdAt: r.created_at,
  };
}

const INVITATION_COLUMNS = 'id, label, role, created_at, expires_at';

function toInvitation(r: any): Invitation {
  return { id: r.id, label: r.label, role: r.role, createdAt: r.created_at, expiresAt: r.expires_at };
}

function toMember(r: any): Member {
  return { userId: r.user_id, email: r.email, displayName: r.display_name, role: r.role, createdAt: r.created_at };
}
