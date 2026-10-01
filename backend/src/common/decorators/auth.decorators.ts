import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '../../db/tenant-context';
import { AuthUser, getRequest } from '../request';

export const IS_PUBLIC_KEY = 'isPublic';
/** Skips AuthGuard. Used only by login/refresh, the widget, and health. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ALLOW_API_TOKEN_KEY = 'allowApiToken';
/** Also accept a personal access token (omni_pat_…). Only for handlers that check membership per call. */
export const AllowApiToken = () => SetMetadata(ALLOW_API_TOKEN_KEY, true);

export const MIN_ROLE_KEY = 'minRole';
/**
 * Minimum role required (owner > admin > editor > viewer), checked against
 * workspace_members on every call — not against the role baked into the JWT.
 */
export const Roles = (minRole: Role) => SetMetadata(MIN_ROLE_KEY, minRole);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const user = getRequest(ctx).user;
  if (!user) throw new Error('CurrentUser used on a route without AuthGuard');
  return user;
});
