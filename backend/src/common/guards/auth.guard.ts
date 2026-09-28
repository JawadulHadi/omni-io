import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { GqlExecutionContext } from "@nestjs/graphql";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.getType() === "http"
      ? context.switchToHttp().getRequest()
      : GqlExecutionContext.create(context).getContext().req;

    const header = req.headers?.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException("Missing bearer token");

    try {
      req.user = this.jwt.verify(token); // { sub, workspaceId, role }
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
  }
}
