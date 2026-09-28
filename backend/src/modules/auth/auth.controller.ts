import { Body, Controller, Get, HttpCode, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { Env } from '../../config/env';
import { Public } from '../../common/decorators/auth.decorators';
import { LoginDto, RegisterDto, SwitchWorkspaceDto } from './auth.dto';
import { AuthService, REFRESH_TTL_DAYS, Session } from './auth.service';
import { GoogleOAuthService } from './google-oauth.service';

const REFRESH_COOKIE = 'omniio_rt';
const STATE_COOKIE = 'omniio_oauth';

/**
 * REST, not GraphQL, because these endpoints set and read an httpOnly cookie.
 * The refresh token never touches JavaScript: it lives in a SameSite=Strict
 * cookie scoped to /auth, while the short-lived access token stays in memory.
 */
@Public()
@Controller('auth')
@UseGuards(ThrottlerGuard)
@SkipThrottle({ workspace: true })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly google: GoogleOAuthService,
    private readonly cfg: ConfigService<Env, true>,
  ) {}

  @Get('providers')
  @SkipThrottle()
  providers() {
    return { password: true, google: this.google.enabled };
  }

  @Post('register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.register(dto));
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.login(dto.email, dto.password, dto.workspaceId));
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      return this.respond(res, await this.auth.refresh(req.cookies?.[REFRESH_COOKIE]));
    } catch (err) {
      this.clearSession(res);
      throw err;
    }
  }

  @Post('switch-workspace')
  @HttpCode(200)
  async switchWorkspace(@Req() req: Request, @Body() dto: SwitchWorkspaceDto, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], dto.workspaceId));
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    this.clearSession(res);
  }

  @Get('google')
  googleStart(@Res() res: Response) {
    const { url, cookie } = this.google.begin();
    res.cookie(STATE_COOKIE, cookie, {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'lax', // must survive the top-level redirect back from Google
      path: '/auth/google',
      maxAge: 10 * 60 * 1000,
    });
    res.redirect(url);
  }

  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    res.clearCookie(STATE_COOKIE, { path: '/auth/google' });
    const origin = this.cfg.get('CONSOLE_ORIGIN', { infer: true }).split(',')[0];
    try {
      const profile = await this.google.complete(code, state, req.cookies?.[STATE_COOKIE]);
      this.respond(res, await this.auth.loginWithGoogle(profile));
      res.redirect(`${origin}/?signin=google`);
    } catch {
      res.redirect(`${origin}/login?error=google`);
    }
  }

  private respond(res: Response, session: Session) {
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'strict',
      path: '/auth',
      maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
    });
    return {
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
      workspaceId: session.workspaceId,
      role: session.role,
    };
  }

  private clearSession(res: Response) {
    res.clearCookie(REFRESH_COOKIE, { path: '/auth' });
  }

  private get secure(): boolean {
    return this.cfg.get('COOKIE_SECURE', { infer: true });
  }
}
