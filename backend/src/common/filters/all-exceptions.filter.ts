import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { GqlContextType } from '@nestjs/graphql';
import type { Response } from 'express';
import { GraphQLError } from 'graphql';

const GQL_CODES: Record<number, string> = {
  400: 'BAD_USER_INPUT',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'TOO_MANY_REQUESTS',
};

/**
 * Never leaks a stack trace or internal error message past the API boundary.
 * GraphQL and REST need different handling: a GraphQL filter must RETURN an
 * error for Apollo to format — there is no Express response to write to.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('UnhandledException');

  catch(exception: unknown, host: ArgumentsHost) {
    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const message = isHttp ? publicMessage(exception) : 'Internal server error';

    if (status >= 500) {
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    }

    if (host.getType<GqlContextType>() === 'graphql') {
      return new GraphQLError(message, {
        extensions: { code: GQL_CODES[status] ?? 'INTERNAL_SERVER_ERROR', statusCode: status },
      });
    }

    if (host.getType() === 'http') {
      const res = host.switchToHttp().getResponse<Response>();
      if (res.headersSent) return;
      res.status(status).json({ statusCode: status, message });
    }
  }
}

function publicMessage(exception: HttpException): string {
  const body = exception.getResponse();
  if (typeof body === 'string') return body;
  const msg = (body as { message?: unknown }).message;
  if (Array.isArray(msg)) return msg.join('; ');
  return typeof msg === 'string' ? msg : exception.message;
}
