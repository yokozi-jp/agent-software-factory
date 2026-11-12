import type { NotificationRequested } from "@agent-software-factory/approval-events";
import { BUSINESS_TIME_ZONE } from "@agent-software-factory/shared-kernel/time";
import { Data, Effect } from "effect";

import type { OutgoingMail } from "./mail-sender.ts";

/**
 * A message whose `values` lack items that its template fills in: every missing name, in the order of the template. It
 * can never succeed, so it is a defect (a DLQ).
 */
export class MissingTemplateValue extends Data.TaggedError("MissingTemplateValue")<{
  readonly template: string;
  readonly names: readonly string[];
}> {
  override get message(): string {
    return `The template ${this.template} is missing the values: ${this.names.join(", ")}`;
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

type Values = Readonly<Record<string, string>>;

interface Content {
  readonly subject: string;
  readonly lines: readonly string[];
}

/** What a template makes of `values`: the content, or the names of the items that are not there. */
type Rendered = Content | { readonly missing: readonly string[] };

/** Whether `values` has every item of `names`. After it, the type says so: an item of `names` reads as a string. */
const hasAll = <N extends string>(
  values: Values,
  names: readonly N[],
): values is Values & Readonly<Record<N, string>> =>
  names.every((name) => values[name] !== undefined);

/**
 * A template: the items it fills in, and how it writes them. Given `values`, it returns the content, or the names of
 * the items that are not there. The check and the read are one step, so `content` gets items that are known to be there
 * and needs no fallback for a missing one.
 */
const template =
  <N extends string>(
    names: readonly N[],
    content: (value: Readonly<Record<N, string>>) => Content,
  ) =>
  (values: Values): Rendered =>
    hasAll(values, names)
      ? content(values)
      : { missing: names.filter((name) => values[name] === undefined) };

const templates = {
  review_requested: template(["applicantName", "claimTitle"], (value) => ({
    subject: `【承認依頼】${value.claimTitle}`,
    lines: [
      `${value.applicantName} さんから、次の申請の承認が依頼されています。`,
      `申請: ${value.claimTitle}`,
    ],
  })),
  sent_back: template(["claimTitle", "reason"], (value) => ({
    subject: `【差戻し】${value.claimTitle}`,
    lines: ["次の申請が差し戻されました。", `申請: ${value.claimTitle}`, `理由: ${value.reason}`],
  })),
} satisfies Record<NotificationRequested["template"], (values: Values) => Rendered>;

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
  const content = templates[message.template](message.values);
  if ("missing" in content) {
    return Effect.die(
      new MissingTemplateValue({ template: message.template, names: content.missing }),
    );
  }
  const body = [
    ...content.lines,
    "",
    `発生日時: ${formatBusinessInstant(Temporal.Instant.from(message.occurredAt))}`,
    `送信日時: ${formatBusinessInstant(now)}`,
  ];
  return Effect.succeed({
    to: message.to,
    subject: content.subject,
    text: body.join("\n"),
  });
};
