import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomToken, sha256 } from '../../common/crypto';
import { DbService } from '../../db/db.service';
import { ApiToken, CreatedApiToken, CreateApiTokenInput } from './api-tokens.models';

export const API_TOKEN_PREFIX = 'omni_pat_';
const MAX_ACTIVE_TOKENS = 20;
const COLUMNS = 'id, name, created_at, last_used_at, expires_at';

/**
 * Personal access tokens for MCP clients, which can't run the console's
 * refresh-cookie flow. A token acts as its user — every MCP tool still checks
 * live workspace membership — and only authenticates /mcp, never GraphQL.
 * Stored as SHA-256; the plaintext is returned once.
 */
@Injectable()
export class ApiTokensService {
  constructor(private readonly db: DbService) {}

  async list(userId: string): Promise<ApiToken[]> {
    const rows = await this.db.global(
      `select ${COLUMNS} from api_tokens
       where user_id = $1 and revoked_at is null and (expires_at is null or expires_at > now())
       order by created_at desc`,
      [userId],
    );
    return rows.map(toApiToken);
  }

  async create(userId: string, input: CreateApiTokenInput): Promise<CreatedApiToken> {
    if ((await this.list(userId)).length >= MAX_ACTIVE_TOKENS) {
      throw new ForbiddenException(`You already have ${MAX_ACTIVE_TOKENS} active tokens — revoke one first`);
    }
    const token = randomToken(API_TOKEN_PREFIX);
    const [row] = await this.db.global(
      `insert into api_tokens (user_id, name, token_hash, expires_at)
       values ($1, $2, $3, case when $4::int is null then null else now() + make_interval(days => $4::int) end)
       returning ${COLUMNS}`,
      [userId, input.name.trim(), sha256(token), input.expiresInDays ?? null],
    );
    return { token, apiToken: toApiToken(row) };
  }

  async revoke(userId: string, id: string): Promise<boolean> {
    const rows = await this.db.global('update api_tokens set revoked_at = now() where id = $1 and user_id = $2 and revoked_at is null returning id', [
      id,
      userId,
    ]);
    if (rows.length === 0) throw new NotFoundException('Token not found');
    return true;
  }

  /** The token's user id, or null if it is unknown, revoked or expired. */
  async verify(token: string): Promise<string | null> {
    const [row] = await this.db.global<{ user_id: string }>(
      `update api_tokens set last_used_at = now()
       where token_hash = $1 and revoked_at is null and (expires_at is null or expires_at > now())
       returning user_id`,
      [sha256(token)],
    );
    return row?.user_id ?? null;
  }
}

function toApiToken(r: any): ApiToken {
  return { id: r.id, name: r.name, createdAt: r.created_at, lastUsedAt: r.last_used_at, expiresAt: r.expires_at };
}
