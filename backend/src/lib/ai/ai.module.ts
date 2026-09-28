import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { AI_PROVIDER, AiProvider } from './ai.provider';
import { FakeProvider } from './fake.provider';
import { GeminiProvider } from './gemini.provider';

@Global()
@Module({
  providers: [
    {
      provide: AI_PROVIDER,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService<Env, true>): AiProvider => {
        const provider =
          cfg.get('AI_PROVIDER', { infer: true }) === 'gemini'
            ? new GeminiProvider(
                cfg.get('GEMINI_API_KEY', { infer: true })!,
                cfg.get('GEMINI_CHAT_MODEL', { infer: true }),
                cfg.get('GEMINI_EMBED_MODEL', { infer: true }),
              )
            : new FakeProvider();
        new Logger('AiModule').log(`AI provider: ${provider.name} (chat=${provider.chatModel}, embed=${provider.embeddingModel})`);
        return provider;
      },
    },
  ],
  exports: [AI_PROVIDER],
})
export class AiModule {}
