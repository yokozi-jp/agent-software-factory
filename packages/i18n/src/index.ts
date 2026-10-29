// 型の augmentation を、この package を import する program に届ける。
import type {} from "./i18next-types.ts";

export { createI18n } from "./i18n.ts";
export { languages, resolveLanguage, type Language } from "./language.ts";
export { problemMessage } from "./problem.ts";
