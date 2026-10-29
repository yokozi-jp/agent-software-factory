import en from "./locales/en/translation.json" with { type: "json" };
import ja from "./locales/ja/translation.json" with { type: "json" };

export const defaultNamespace = "translation";

export const resources = {
  ja: { [defaultNamespace]: ja },
  en: { [defaultNamespace]: en },
} as const;
