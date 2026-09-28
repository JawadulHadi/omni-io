import { Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { TenantContext } from '../../db/tenant-context';
import { withThemeDefaults, WidgetThemeValue } from './widget-theme';
import { WidgetConfig, WidgetThemeInput } from './widget.models';

const WIDGET_KEY_PATTERN = /^[0-9a-f]{32}$/;

@Injectable()
export class WidgetConfigService {
  constructor(
    private readonly db: DbService,
    private readonly tenant: TenantContext,
  ) {}

  /** Pre-tenant lookup via the definer function; junk keys never reach the database. */
  async resolveKey(key: string): Promise<string> {
    if (!WIDGET_KEY_PATTERN.test(key)) throw new NotFoundException('Invalid or rotated widget key');
    const [row] = await this.db.global<{ id: string | null }>('select resolve_widget_key($1) as id', [key]);
    if (!row?.id) throw new NotFoundException('Invalid or rotated widget key');
    return row.id;
  }

  async get(): Promise<WidgetConfig> {
    const [row] = await this.db.query(
      `select w.widget_key, c.theme, coalesce(c.rotated_at, w.created_at) as rotated_at,
              (select count(*)::int from documents d where d.workspace_id = w.id and d.visibility = 'public' and d.status = 'ready') as public_docs
       from workspaces w left join widget_configs c on c.workspace_id = w.id
       where w.id = $1`,
      [this.tenant.requireWorkspaceId()],
    );
    if (!row) throw new NotFoundException('Workspace not found');
    return {
      widgetKey: row.widget_key,
      theme: withThemeDefaults(row.theme),
      rotatedAt: row.rotated_at,
      publicDocumentCount: row.public_docs,
    };
  }

  async publicTheme(): Promise<WidgetThemeValue> {
    const [row] = await this.db.query('select theme from widget_configs where workspace_id = $1', [this.tenant.requireWorkspaceId()]);
    return withThemeDefaults(row?.theme);
  }

  async updateTheme(input: WidgetThemeInput): Promise<WidgetConfig> {
    await this.db.query(
      `insert into widget_configs (workspace_id, theme) values ($1, $2)
       on conflict (workspace_id) do update set theme = excluded.theme`,
      [this.tenant.requireWorkspaceId(), { ...input }],
    );
    return this.get();
  }

  /** Old key stops working immediately; the admin console session is unaffected. */
  async rotateKey(): Promise<WidgetConfig> {
    const workspaceId = this.tenant.requireWorkspaceId();
    await this.db.tenant(async (q) => {
      await q(`update workspaces set widget_key = encode(gen_random_bytes(16), 'hex') where id = $1`, [workspaceId]);
      await q(
        `insert into widget_configs (workspace_id, rotated_at) values ($1, now())
         on conflict (workspace_id) do update set rotated_at = now()`,
        [workspaceId],
      );
    });
    return this.get();
  }
}
