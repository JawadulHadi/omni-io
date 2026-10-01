import 'reflect-metadata';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { TenantContext } from '../../db/tenant-context';
import type { ApiTokensService } from '../../modules/api-tokens/api-tokens.service';
import { ALLOW_API_TOKEN_KEY } from '../decorators/auth.decorators';
import { AuthGuard } from './auth.guard';

const jwt = new JwtService({ secret: 'test-secret-that-is-long-enough-000000' });

function httpContext(req: Record<string, any>, handler: () => void = () => undefined): ExecutionContext {
  return {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('AuthGuard', () => {
  const tenant = new TenantContext();
  const apiTokens = { verify: jest.fn(async (token: string) => (token === 'omni_pat_valid' ? 'u9' : null)) };
  const guard = new AuthGuard(jwt, new Reflector(), tenant, apiTokens as unknown as ApiTokensService);
  const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });
  const mcpHandler = () => undefined;
  Reflect.defineMetadata(ALLOW_API_TOKEN_KEY, true, mcpHandler);

  it('rejects a request with no token', async () => {
    await expect(guard.canActivate(httpContext({ headers: {} }))).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a validly-signed token that is not an access token', async () => {
    const token = jwt.sign({ sub: 'u1', wid: 'w1', role: 'owner', typ: 'refresh' });
    await expect(guard.canActivate(httpContext(bearer(token)))).rejects.toThrow('Invalid token type');
  });

  it('rejects a token signed with another secret', async () => {
    const forged = new JwtService({ secret: 'attacker-secret-attacker-secret-000' }).sign({ sub: 'u1', wid: 'w1', typ: 'access' });
    await expect(guard.canActivate(httpContext(bearer(forged)))).rejects.toThrow('Invalid or expired token');
  });

  it('accepts an access token and fills the tenant context', async () => {
    const token = jwt.sign({ sub: 'u1', wid: 'w1', role: 'editor', typ: 'access' });
    const req: Record<string, any> = bearer(token);
    await tenant.run({}, async () => {
      await expect(guard.canActivate(httpContext(req))).resolves.toBe(true);
      expect(tenant.get()).toMatchObject({ userId: 'u1', workspaceId: 'w1' });
    });
    expect(req.user).toEqual({ userId: 'u1', workspaceId: 'w1', role: 'editor' });
  });

  it('refuses a personal access token outside /mcp', async () => {
    await expect(guard.canActivate(httpContext(bearer('omni_pat_valid')))).rejects.toThrow('API tokens only authenticate /mcp');
    expect(apiTokens.verify).not.toHaveBeenCalled();
  });

  it('accepts a valid personal access token on a route that allows it, with no workspace', async () => {
    const req: Record<string, any> = bearer('omni_pat_valid');
    await expect(guard.canActivate(httpContext(req, mcpHandler))).resolves.toBe(true);
    expect(req.user).toEqual({ userId: 'u9', workspaceId: '', role: 'viewer', viaApiToken: true });
  });

  it('rejects an unknown, revoked or expired personal access token', async () => {
    await expect(guard.canActivate(httpContext(bearer('omni_pat_revoked'), mcpHandler))).rejects.toThrow('Invalid, expired or revoked API token');
  });
});
