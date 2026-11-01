/** What the entry file closes at a stop signal, in this order. */
export interface StopSteps {
  /**
   * Stops accepting connections and resolves when the requests in flight have ended (`server.close` of node:http). It
   * rejects with an `Error` when the server was not running.
   */
  readonly closeServer: () => Promise<void>;
  /** Disposes the runtime and ends the pools (docs/adr/0028). */
  readonly closeResources: () => Promise<void>;
  /** Sends the spans not sent yet (docs/adr/0048). */
  readonly flushTelemetry: () => Promise<void>;
}

/**
 * ECS sends SIGTERM and kills the container if it has not exited after `stopTimeout`, 30 seconds unless the task
 * definition sets it ("Container timeouts" of
 * https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html). The two limits add up to
 * 29 seconds, one less than that (a judgment): 25 for the server and the resources, 4 for the spans.
 */
const defaultTimeoutMs = 25_000;
const defaultFlushTimeoutMs = 4_000;

type Outcome = "done" | "deadline";

/** Resolves with "done" when `work` settles (its failure is the caller's), or with "deadline" when `deadline` is first. */
const within = (work: Promise<void>, deadline: Promise<Outcome>): Promise<Outcome> =>
  Promise.race([work.then(() => "done" as const), deadline]);

/**
 * Stops the api after a stop signal: no new requests, the requests in flight end, the runtime and the pools close, then
 * the spans go out.
 *
 * One deadline of `timeoutMs` bounds the first two steps together. A pool waits for the connections in use (pg-pool's
 * `end`), so a request still running at the deadline keeps the pools open; the open transactions roll back when the
 * process ends and the connections close. The spans have a limit of their own, `flushTimeoutMs`, after which the stop goes
 * on without them (the collector is unreachable, so nothing would go out anyway).
 *
 * The stop fails, after the spans are sent, when the server did not stop accepting, when the resources did not close, or
 * when the deadline passed, so the entry can report it and exit with a non-zero code. A failure to stop the server does not
 * keep the resources from closing.
 */
export async function stopGracefully(
  steps: StopSteps,
  {
    timeoutMs = defaultTimeoutMs,
    flushTimeoutMs = defaultFlushTimeoutMs,
  }: { readonly timeoutMs?: number; readonly flushTimeoutMs?: number } = {},
): Promise<void> {
  const timers: ReturnType<typeof setTimeout>[] = [];
  const after = (ms: number) =>
    new Promise<Outcome>((resolve) => {
      timers.push(setTimeout(() => resolve("deadline"), ms));
    });
  const deadline = after(timeoutMs);
  // node:http passes an Error to the callback of close (closeServer in server.ts).
  let serverError: Error | undefined;
  try {
    await within(
      steps.closeServer().catch((error: Error) => {
        serverError = error;
      }),
      deadline,
    );
    if ((await within(steps.closeResources(), deadline)) === "deadline")
      throw new Error(
        `The runtime and the database pools did not close within ${timeoutMs} ms: a request or a transaction was still running.`,
      );
    if (serverError !== undefined)
      throw new Error(`The server did not stop accepting: ${serverError.message}`, {
        cause: serverError,
      });
  } finally {
    await within(steps.flushTelemetry(), after(flushTimeoutMs));
    for (const timer of timers) clearTimeout(timer);
  }
}
