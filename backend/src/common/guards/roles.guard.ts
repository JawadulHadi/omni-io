import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { GqlExecutionContext } from "@nestjs/graphql";

export const ROLES_KEY = "roles";
export const Roles = (...roles: string[]) => Reflect.metadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!required || required.length === 0) return true;

    const req = context.getType() === "http"
      ? context.switchToHttp().getRequest()
      : GqlExecutionContext.create(context).getContext().req;

    if (!required.includes(req.user?.role)) {
      throw new ForbiddenException(`Requires one of roles: ${required.join(", ")}`);
    }
    return true;
  }
}
