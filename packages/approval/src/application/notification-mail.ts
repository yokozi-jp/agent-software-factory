import type { NotificationRequested } from "@agent-software-factory/approval-events";
import { BUSINESS_TIME_ZONE } from "@agent-software-factory/shared-kernel/time";
import { Data, Effect } from "effect";

import type { OutgoingMail } from "./mail-sender.ts";

/** A message whose `values` lack an item that its template fills in. It can never succeed, so it is a defect (a DLQ). */
export class MissingTemplateValue extends Data.TaggedError("MissingTemplateValue")<{
  readonly template: string;
  readonly name: string;
}> {
  override get message(): string {
    return `The template ${this.template} needs the value ${this.name}`;
  }
}

/**
 * A moment as the mail writes it: in the time zone of the business, never in the `TZ` of the process (docs/adr/0043).
 * The format and the text of the mail are Japanese only. Whether they follow the language of i18next, as ADR 0043 says
 * of mails, is not decided yet (Issue #504).
 */
const formatBusinessInstant = (instant: Temporal.Instant): string =>
  instant.toLocaleString("ja-JP", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

/** Reads one item of the message's `values`. The caller has checked that the template's items are there. */
type TemplateValue = (name: string) => string;

const templates = {
  review_requested: {
    names: ["applicantName", "claimTitle"],
    subject: (value) => `【承認依頼】${value("claimTitle")}`,
    lines: (value) => [
      `${value("applicantName")} さんから、次の申請の承認が依頼されています。`,
      `申請: ${value("claimTitle")}`,
    ],
  },
  sent_back: {
    names: ["claimTitle", "reason"],
    subject: (value) => `【差戻し】${value("claimTitle")}`,
    lines: (value) => [
      "次の申請が差し戻されました。",
      `申請: ${value("claimTitle")}`,
      `理由: ${value("reason")}`,
    ],
  },
} satisfies Record<
  NotificationRequested["template"],
  {
    readonly names: readonly string[];
    readonly subject: (value: TemplateValue) => string;
    readonly lines: (value: TemplateValue) => string[];
  }
>;

/**
 * The mail for a notification message. Review requests and send-backs have one message shape and differ in the
 * template only. The dates in the body are written in the business time zone: `occurredAt` is when the event happened and
 * `now` is when the mail is sent, which the entry file read once for this message (docs/adr/0043). A message that
 * lacks an item of its template is a defect: waiting for another delivery cannot help.
 */
export const renderNotificationMail = (
  message: NotificationRequested,
  now: Temporal.Instant,
): Effect.Effect<OutgoingMail> => {
  const template = templates[message.template];
  const missing = template.names.find((name) => message.values[name] === undefined);
  if (missing !== undefined)
    return Effect.die(new MissingTemplateValue({ template: message.template, name: missing }));
  // `noUncheckedIndexedAccess` types a lookup as possibly missing; the check above made sure it is not.
  const value: TemplateValue = (name) => message.values[name] ?? "";
  const body = [
    ...template.lines(value),
    "",
    `発生日時: ${formatBusinessInstant(Temporal.Instant.from(message.occurredAt))}`,
    `送信日時: ${formatBusinessInstant(now)}`,
  ];
  return Effect.succeed({
    to: message.to,
    subject: template.subject(value),
    text: body.join("\n"),
  });
};
