import { Controller, Get, Inject, Module } from '@nestjs/common';
import { Field, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { Public } from '../../common/decorators/auth.decorators';
import { DbService } from '../../db/db.service';
import { AI_PROVIDER, AiProvider } from '../../lib/ai/ai.provider';
import { AuthModule } from '../auth/auth.module';
import { GoogleOAuthService } from '../auth/google-oauth.service';

@Controller('health')
export class HealthController {
  constructor(private readonly db: DbService) {}

  @Public()
  @Get()
  async check() {
    await this.db.global('select 1');
    return { status: 'ok' };
  }
}

@ObjectType()
export class SystemInfo {
  @Field() aiProvider: string;
  @Field() chatModel: string;
  @Field() embeddingModel: string;
  @Field() googleOAuth: boolean;
}

@Resolver()
export class SystemResolver {
  constructor(
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
    private readonly google: GoogleOAuthService,
  ) {}

  @Query(() => SystemInfo)
  systemInfo(): SystemInfo {
    return {
      aiProvider: this.ai.name,
      chatModel: this.ai.chatModel,
      embeddingModel: this.ai.embeddingModel,
      googleOAuth: this.google.enabled,
    };
  }
}

@Module({
  imports: [AuthModule],
  controllers: [HealthController],
  providers: [SystemResolver],
})
export class HealthModule {}
