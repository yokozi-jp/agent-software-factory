/** What the entry file closes at a stop signal, in this order. */
export interface StopSteps {
  /** Stops accepting connections and resolves when the requests in flight have ended (`server.close` of node:http). */
  readonly closeServer: () => Promise<void>;
  /** Disposes the runtime and ends the pool (docs/adr/0028). */
  readonly closeResources: () => Promise<void>;
  /** Sends the spans not sent yet (docs/adr/0048). */
  readonly flushTelemetry: () => Promise<void>;
}

/**
 * ECS sends SIGTERM and kills the task with SIGKILL after `stopTimeout` (30 seconds by default), so the wait for the
 * requests in flight ends before that, leaving time to close the rest (a judgment).
 */
const defaultTimeoutMs = 25_000;

/**
 * Stops the api after a stop signal: no new requests, the requests in flight end (up to `timeoutMs`), then the runtime and
 * the pool close, then the spans go out. A request still running at the limit is cut; its transaction rolls back. A failure
 * to stop the server does not keep the rest from closing; a failure to close the resources is thrown after the spans are
 * sent, so the entry can report it.
 */
export async function stopGracefully(
  steps: StopSteps,
  { timeoutMs = defaultTimeoutMs }: { readonly timeoutMs?: number } = {},
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([steps.closeServer().catch(() => undefined), limit]);
  } finally {
    clearTimeout(timer);
  }
  try {
    await steps.closeResources();
  } finally {
    await steps.flushTelemetry();
  }
}
