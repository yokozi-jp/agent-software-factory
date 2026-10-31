/**
 * One line of JSON for a message that failed (docs/logging). Only the id of the message and the text of the error:
 * the body of the message has the address of a person, so it is not written.
 */
export function failureLine(error: unknown, messageId: string | undefined): string {
  return JSON.stringify({
    level: "error",
    event: "notification_failed",
    messageId,
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  });
}

/** Writes `failureLine` to stderr: the `onError` of both workers. */
export function reportFailure(error: unknown, messageId: string | undefined): void {
  console.error(failureLine(error, messageId));
}
