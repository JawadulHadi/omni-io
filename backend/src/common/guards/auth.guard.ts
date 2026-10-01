import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { TenantContext } from '../../db/tenant-context';
import { API_TOKEN_PREFIX, ApiTokensService } from '../../modules/api-tokens/api-tokens.service';
import { ALLOW_API_TOKEN_KEY, IS_PUBLIC_KEY } from '../decorators/auth.decorators';
import { AccessTokenPayload, getRequest } from '../request';

/**
 * Global guard: every resolver and controller requires a valid access token
 * unless marked @Public(). On success it fills the request's tenant context,
 * which is what DbService.tenant() scopes every query by.
 *
 * Routes marked @AllowApiToken() (only /mcp) also accept a personal access
 * token. It carries no workspace, so it only works where the handler checks
 * membership per call.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly tenant: TenantContext,
    private readonly apiTokens: ApiTokensService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const req = getRequest(context);
    const header: string | undefined = req.headers?.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException('Missing bearer token');

    if (token.startsWith(API_TOKEN_PREFIX)) {
      if (!this.reflector.getAllAndOverride<boolean>(ALLOW_API_TOKEN_KEY, targets)) {
        throw new UnauthorizedException('API tokens only authenticate /mcp');
      }
      const userId = await this.apiTokens.verify(token);
      if (!userId) throw new UnauthorizedException('Invalid, expired or revoked API token');
      req.user = { userId, workspaceId: '', role: 'viewer', viaApiToken: true };
      this.tenant.trySet({ userId });
      return true;
    }

    let payload: AccessTokenPayload;
    try {
      payload = this.jwt.verify<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    // Only access tokens authenticate requests. (Refresh tokens are opaque and
    // never JWTs, but the explicit check keeps any future token type out too.)
    if (payload.typ !== 'access' || !payload.sub || !payload.wid) {
      throw new UnauthorizedException('Invalid token type');
    }

    req.user = { userId: payload.sub, workspaceId: payload.wid, role: payload.role };
    this.tenant.trySet({ userId: payload.sub, workspaceId: payload.wid, role: payload.role });
    return true;
  }
}
