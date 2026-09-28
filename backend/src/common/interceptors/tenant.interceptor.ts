import { CallHandler, ExecutionContext, Injectable, NestInterceptor, UnauthorizedException } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Observable } from 'rxjs';
import { from, switchMap } from 'rxjs';
import { Pool } from 'pg';

/**
 * Sets the Postgres session variable `app.workspace_id` from the verified
 * JWT before the request's query runs. This is what makes row-level
 * security policies (drizzle/migrations/0001_init.sql) actually enforce
 * isolation — a missed `.where(workspaceId = ...)` in a service can't leak
 * another tenant's rows, because the database itself won't return them.
 *
 * Requires AuthGuard to have already attached `req.user.workspaceId`.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(private readonly pool: Pool) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = this.extractRequest(context);
    const workspaceId = req?.user?.workspaceId;

    if (!workspaceId) {
      throw new UnauthorizedException('No workspace context on request');
    }

    return from(this.pool.query('SELECT set_config($1, $2, true)', ['app.workspace_id', workspaceId])).pipe(
      switchMap(() => next.handle()),
    );
  }

  private extractRequest(context: ExecutionContext) {
    if (context.getType() === 'http') {
      return context.switchToHttp().getRequest();
    }
    return GqlExecutionContext.create(context).getContext().req;
  }
}
