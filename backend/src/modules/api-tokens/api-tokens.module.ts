import { Global, Module } from '@nestjs/common';
import { ApiTokensResolver } from './api-tokens.resolver';
import { ApiTokensService } from './api-tokens.service';

/** Global: AuthGuard (an APP_GUARD) verifies tokens on /mcp. */
@Global()
@Module({
  providers: [ApiTokensService, ApiTokensResolver],
  exports: [ApiTokensService],
})
export class ApiTokensModule {}
