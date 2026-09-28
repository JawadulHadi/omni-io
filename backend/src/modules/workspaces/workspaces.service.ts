import { Injectable, ForbiddenException } from "@nestjs/common";
import { Pool } from "pg";

const ROLE_RANK = { viewer: 0, editor: 1, admin: 2, owner: 3 } as const;

@Injectable()
export class WorkspacesService {
  constructor(private readonly pool: Pool) {}

  async getWorkspace(workspaceId: string) {
    const { rows } = await this.pool.query("select * from workspaces where id = $1", [workspaceId]);
    return rows[0] ?? null;
  }

  async inviteMember(workspaceId: string, callerRole: keyof typeof ROLE_RANK, userId: string, role: keyof typeof ROLE_RANK) {
    if (ROLE_RANK[callerRole] < ROLE_RANK.admin) {
      throw new ForbiddenException("Only admins or owners can invite members");
    }
    await this.pool.query(
      `insert into workspace_members (workspace_id, user_id, role) values ($1,$2,$3)
       on conflict (workspace_id, user_id) do update set role = excluded.role`,
      [workspaceId, userId, role],
    );
  }
}
