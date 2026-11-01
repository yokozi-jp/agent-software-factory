// `.` の入口 (docs/adr/0044、docs/adr/0054)。再 export だけを書く。i18next は web だけが使う薄い包みなので、
// `.` が infrastructure/ も再 export する (docs/adr/0051 の例外、docs/domain-model/package-layout.md D4)。
// 型の augmentation を、この package を import する program に届ける。
import type {} from "./infrastructure/i18next-types.ts";

export { createI18n } from "./infrastructure/i18n.ts";
export { languages, resolveLanguage, type Language } from "./domain/language.ts";
export { problemMessage } from "./infrastructure/problem.ts";
