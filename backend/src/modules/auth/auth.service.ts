import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Pool } from "pg";
import * as bcrypt from "bcrypt";

@Injectable()
export class AuthService {
  constructor(private readonly jwt: JwtService, private readonly pool: Pool) {}

  async login(email: string, password: string) {
    const { rows } = await this.pool.query(
      `select u.id as user_id, u.password_hash, m.workspace_id, m.role
       from users u join workspace_members m on m.user_id = u.id
       where u.email = $1 limit 1`,
      [email],
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const payload = { sub: user.user_id, workspaceId: user.workspace_id, role: user.role };
    return {
      accessToken: this.jwt.sign(payload, { expiresIn: "15m" }),
      refreshToken: this.jwt.sign(payload, { expiresIn: "30d" }),
    };
  }

  // TODO: wire Google OAuth via @nestjs/passport + passport-google-oauth20
}
