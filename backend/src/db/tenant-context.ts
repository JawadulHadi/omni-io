import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

export type Role = 'owner' | 'admin' | 'editor' | 'viewer';
export const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

export interface TenantState {
  userId?: string;
  workspaceId?: string;
  role?: Role;
}

/**
 * Request-scoped tenant context carried by AsyncLocalStorage, so services never
 * thread a workspaceId through every call — and can't pass the wrong one.
 *
 * - HTTP/GraphQL: `middleware` opens an empty store per request; AuthGuard fills it
 *   from the verified JWT.
 * - Widget, worker, MCP: code that resolves a workspace some other way enters it
 *   explicitly with `run({ workspaceId }, fn)`.
 */
@Injectable()
export class TenantContext {
  private readonly als = new AsyncLocalStorage<TenantState>();

  readonly middleware = (_req: Request, _res: Response, next: NextFunction) => this.als.run({}, next);

  run<T>(state: TenantState, fn: () => T): T {
    return this.als.run({ ...state }, fn);
  }

  get(): TenantState | undefined {
    return this.als.getStore();
  }

  /** Fills the current request's store. No-op outside one (e.g. a WebSocket subscription). */
  trySet(patch: TenantState): void {
    const store = this.als.getStore();
    if (store) Object.assign(store, patch);
  }

  requireWorkspaceId(): string {
    const workspaceId = this.als.getStore()?.workspaceId;
    if (!workspaceId) throw new Error('No workspace in tenant context — refusing to run a tenant query');
    return workspaceId;
  }
}
