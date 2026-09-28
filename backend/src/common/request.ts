import type { ExecutionContext } from '@nestjs/common';
import { GqlContextType, GqlExecutionContext } from '@nestjs/graphql';
import type { Role } from '../db/tenant-context';

export interface AuthUser {
  userId: string;
  workspaceId: string;
  /** From the token; RolesGuard replaces it with the live role from workspace_members. */
  role: Role;
}

export interface AccessTokenPayload {
  sub: string;
  wid: string;
  role: Role;
  typ: 'access';
}

/** The underlying request for REST, GraphQL queries/mutations, and WebSocket subscriptions alike. */
export function getRequest(context: ExecutionContext): { headers: Record<string, any>; user?: AuthUser; [key: string]: any } {
  if (context.getType<GqlContextType>() === 'graphql') {
    return GqlExecutionContext.create(context).getContext().req;
  }
  return context.switchToHttp().getRequest();
}
