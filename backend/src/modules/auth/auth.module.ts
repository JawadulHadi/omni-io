import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../../config/env';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleOAuthService } from './google-oauth.service';

@Module({
  imports: [
    WorkspacesModule,
    JwtModule.registerAsync({
      global: true, // AuthGuard (an APP_GUARD) verifies tokens everywhere
      inject: [ConfigService],
      useFactory: (cfg: ConfigService<Env, true>) => ({
        secret: cfg.get('JWT_SECRET', { infer: true }),
        signOptions: { algorithm: 'HS256' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, GoogleOAuthService],
  exports: [GoogleOAuthService],
})
export class AuthModule {}
