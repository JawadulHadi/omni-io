import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { TenantContext } from '../../db/tenant-context';
import { AuthGuard } from './auth.guard';

const jwt = new JwtService({ secret: 'test-secret-that-is-long-enough-000000' });

function httpContext(req: Record<string, any>): ExecutionContext {
  return {
    getType: () => 'http',
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('AuthGuard', () => {
  const tenant = new TenantContext();
  const guard = new AuthGuard(jwt, new Reflector(), tenant);
  const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

  it('rejects a request with no token', () => {
    expect(() => guard.canActivate(httpContext({ headers: {} }))).toThrow(UnauthorizedException);
  });

  it('rejects a validly-signed token that is not an access token', () => {
    const token = jwt.sign({ sub: 'u1', wid: 'w1', role: 'owner', typ: 'refresh' });
    expect(() => guard.canActivate(httpContext(bearer(token)))).toThrow('Invalid token type');
  });

  it('rejects a token signed with another secret', () => {
    const forged = new JwtService({ secret: 'attacker-secret-attacker-secret-000' }).sign({ sub: 'u1', wid: 'w1', typ: 'access' });
    expect(() => guard.canActivate(httpContext(bearer(forged)))).toThrow('Invalid or expired token');
  });

  it('accepts an access token and fills the tenant context', () => {
    const token = jwt.sign({ sub: 'u1', wid: 'w1', role: 'editor', typ: 'access' });
    const req: Record<string, any> = bearer(token);
    tenant.run({}, () => {
      expect(guard.canActivate(httpContext(req))).toBe(true);
      expect(tenant.get()).toMatchObject({ userId: 'u1', workspaceId: 'w1' });
    });
    expect(req.user).toEqual({ userId: 'u1', workspaceId: 'w1', role: 'editor' });
  });
});
