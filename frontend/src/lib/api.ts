/** Empty in dev (Vite proxies to the API); set VITE_API_BASE when the API lives on another origin. */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? '';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function readError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
  const message = Array.isArray(body?.message) ? body.message.join('; ') : body?.message;
  return new ApiError(res.status, message || `Request failed (${res.status})`);
}

/** Pull a human message out of a urql CombinedError without the "[GraphQL]" prefix. */
export function gqlErrorMessage(error: { graphQLErrors?: { message: string }[]; networkError?: Error; message: string } | undefined) {
  if (!error) return null;
  return error.graphQLErrors?.[0]?.message ?? error.networkError?.message ?? error.message;
}
