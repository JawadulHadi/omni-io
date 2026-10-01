import { All, Controller, Post, Req, Res } from '@nestjs/common';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { AllowApiToken, CurrentUser } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../../common/request';
import { McpToolsService } from './mcp.tools';

/**
 * MCP over Streamable HTTP (the current transport; HTTP+SSE is deprecated), in
 * stateless mode: each POST gets a fresh server bound to the bearer-token user.
 * Auth is a personal access token (created in the console under API tokens) or
 * a console JWT, enforced by the global AuthGuard.
 */
@Controller('mcp')
@AllowApiToken()
export class McpController {
  constructor(private readonly tools: McpToolsService) {}

  @Post()
  async handle(@Req() req: Request, @Res() res: Response, @CurrentUser() user: AuthUser) {
    const server = this.tools.createServer(user);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  @All()
  methodNotAllowed(@Res() res: Response) {
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed: this MCP server is stateless, use POST' }, id: null });
  }
}
