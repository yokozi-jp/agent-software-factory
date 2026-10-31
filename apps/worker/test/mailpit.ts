import { inject } from "vite-plus/test";
import { z } from "zod";

// Mailpit の API の応答のうち、テストが読む項目だけ。
const searchResult = z.object({
  messages: z.array(z.object({ ID: z.string(), Subject: z.string() })),
});
const messageDetail = z.object({ Text: z.string() });

/** The mail that Mailpit received for one address. */
export interface ReceivedMail {
  readonly subject: string;
  readonly text: string;
}

const api = () => inject("mailpitApi");

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(`${api()}${path}`);
  if (!response.ok) throw new Error(`Mailpit ${path}: ${response.status}`);
  return response.json();
}

/**
 * A new address for one test. Mailpit is shared by every test, so each test sends to an address of its own and reads
 * only the mail for it.
 */
export const newRecipient = (): string => `${crypto.randomUUID()}@example.test`;

/** The mail that Mailpit has received for `address` so far, oldest first. */
export async function mailTo(address: string): Promise<ReceivedMail[]> {
  const found = searchResult.parse(
    await getJson(`/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`),
  );
  const received: ReceivedMail[] = [];
  for (const message of found.messages.toReversed()) {
    const detail = messageDetail.parse(await getJson(`/api/v1/message/${message.ID}`));
    received.push({ subject: message.Subject, text: detail.Text });
  }
  return received;
}

/**
 * Waits until `count` mails have reached `address`, then returns them. SMTP is done when `sendMail` returns, but Mailpit
 * indexes the mail a moment later, so the read retries for a few seconds.
 */
export async function waitForMail(address: string, count: number): Promise<ReceivedMail[]> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const received = await mailTo(address);
    if (received.length >= count || Date.now() > deadline) return received;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
