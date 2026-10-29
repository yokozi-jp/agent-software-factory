import i18next, { type i18n } from "i18next";

import { type Language } from "./language.ts";
import { defaultNamespace, resources } from "./resources.ts";

/**
 * 言語ごとの i18next の instance を作る。グローバルの instance は使わない。テストと、将来の SSR や複数の
 * 言語の同時の利用で、状態が混ざらないようにするため。文言は resources に束ねてあり、通信しない。
 */
export async function createI18n(language: Language): Promise<i18n> {
  const instance = i18next.createInstance();
  await instance.init({
    lng: language,
    fallbackLng: "en",
    resources,
    defaultNS: defaultNamespace,
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instance;
}
