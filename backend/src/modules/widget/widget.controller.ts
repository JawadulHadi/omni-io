import { Controller, Get, Post, Body, Param, NotFoundException } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Pool } from "pg";
import { AnswerService } from "../answer/answer.service";

/** The only unauthenticated surface — scoped entirely by a rotating opaque key, not a session. */
@Controller("w")
export class WidgetController {
  constructor(private readonly pool: Pool, private readonly answers: AnswerService) {}

  @Get(":key")
  async getConfig(@Param("key") key: string) {
    const { rows } = await this.pool.query(
      "select w.workspace_id, c.theme from workspaces w join widget_configs c on c.workspace_id = w.id where w.widget_key = $1",
      [key],
    );
    if (!rows[0]) throw new NotFoundException("Invalid or rotated widget key");
    return { theme: rows[0].theme };
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(":key/ask")
  async ask(@Param("key") key: string, @Body("query") query: string) {
    const { rows } = await this.pool.query("select id from workspaces where widget_key = $1", [key]);
    if (!rows[0]) throw new NotFoundException("Invalid or rotated widget key");
    return this.answers.askQuestion(rows[0].id, query);
  }
}
