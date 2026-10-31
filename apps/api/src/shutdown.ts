/** What the entry file closes at a stop signal, in this order. */
export interface StopSteps {
  /** Stops accepting connections and resolves when the requests in flight have ended (`server.close` of node:http). */
  readonly closeServer: () => Promise<void>;
  /** Disposes the runtime and ends the pools (docs/adr/0028). */
  readonly closeResources: () => Promise<void>;
  /** Sends the spans not sent yet (docs/adr/0048). */
  readonly flushTelemetry: () => Promise<void>;
}

/**
 * ECS sends SIGTERM and kills the task with SIGKILL after `stopTimeout` (30 seconds by default), so closing the server
 * and the resources ends before that, leaving time to send the spans (a judgment).
 */
const defaultTimeoutMs = 25_000;

/**
 * Stops the api after a stop signal: no new requests, the requests in flight end, the runtime and the pools close, then
 * the spans go out. One deadline of `timeoutMs` bounds the first two steps together. A pool waits for the connections in
 * use (pg-pool's `end`), so a request still running at the deadline keeps the pools open: the spans are sent anyway, and
 * the stop fails with that reason, for the entry to report and exit. The open transactions roll back when the process
 * ends and the connections close. A failure to stop the server does not keep the resources from closing (closing them
 * says whether anything was left); a failure to close the resources is thrown after the spans are sent.
 */
export async function stopGracefully(
  steps: StopSteps,
  { timeoutMs = defaultTimeoutMs }: { readonly timeoutMs?: number } = {},
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"deadline">((resolve) => {
    timer = setTimeout(() => resolve("deadline"), timeoutMs);
  });
  try {
    await Promise.race([steps.closeServer().catch(() => undefined), deadline]);
    const closed = await Promise.race([
      steps.closeResources().then(() => "closed" as const),
      deadline,
    ]);
    if (closed === "deadline")
      throw new Error(
        `The runtime and the database pools did not close within ${timeoutMs} ms: a request or a transaction was still running.`,
      );
  } finally {
    clearTimeout(timer);
    await steps.flushTelemetry();
  }
}
