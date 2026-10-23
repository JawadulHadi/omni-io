/** Rejects after `ms` if `promise` hasn't settled; the loser of the race can't become an unhandled rejection. */
export function withTimeout<T>(promise: Promise<T>, ms: number, message = `Timed out after ${ms}ms`): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}
