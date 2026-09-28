import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DbService } from '../../db/db.service';
import { Role, ROLE_RANK, TenantContext } from '../../db/tenant-context';
import { MIN_ROLE_KEY } from '../decorators/auth.decorators';
import { getRequest } from '../request';

/**
 * Checks @Roles(min) against the caller's CURRENT row in workspace_members, so a
 * demoted or removed member loses access immediately rather than when their
 * access token expires.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DbService,
    private readonly tenant: TenantContext,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const minRole = this.reflector.getAllAndOverride<Role | undefined>(MIN_ROLE_KEY, [context.getHandler(), context.getClass()]);
    if (!minRole) return true;

    const req = getRequest(context);
    if (!req.user) return true; // @Public route; AuthGuard already decided.

    const [row] = await this.db.global<{ role: Role | null }>('select workspace_role($1, $2) as role', [
      req.user.workspaceId,
      req.user.userId,
    ]);
    const role = row?.role;
    if (!role) throw new ForbiddenException('You are no longer a member of this workspace');
    if (ROLE_RANK[role] < ROLE_RANK[minRole]) throw new ForbiddenException(`Requires ${minRole} role or higher`);

    req.user.role = role;
    this.tenant.trySet({ role });
    return true;
  }
}
