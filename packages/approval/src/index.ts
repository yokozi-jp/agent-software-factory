// The public API of the 承認 (approval) module. Other packages import only this file, by the package name.
// approval may import claim, but not closing: modules depend one way, closing → approval → claim
// (docs/adr/0026). The layers are domain/, application/, infrastructure/ and http/. This file wires them
// together and exports what apps/api and the workers assemble. The module has the handler of the notification mail
// (docs/adr/0041) and no other code yet.
export {
  handleNotification,
  type NotificationContext,
  type NotificationResult,
} from "./application/handle-notification.ts";
export { MailSender, MailSendFailed, type OutgoingMail } from "./application/mail-sender.ts";
export { MissingTemplateValue } from "./application/notification-mail.ts";
export { NotificationStore } from "./application/notification-store.ts";
export type { ApprovalDatabase } from "./infrastructure/database.ts";
export { NotificationStoreLayer } from "./infrastructure/notification-store.ts";
export { ApprovalTx } from "./infrastructure/transaction.ts";
