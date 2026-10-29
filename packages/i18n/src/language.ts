export const languages = ["ja", "en"] as const;
export type Language = (typeof languages)[number];

const fallbackLanguage: Language = "en";

const isLanguage = (value: string): value is Language => languages.some((l) => l === value);

/**
 * ブラウザの言語の一覧 (`navigator.languages`) から、表示の言語を決める。優先順位の高い順に見て、ja か en の
 * 最初のものを選ぶ。ja と en 以外だけのときは en (docs/adr/0044)。
 */
export function resolveLanguage(preferred: readonly string[]): Language {
  for (const tag of preferred) {
    const primary = tag.toLowerCase().split("-")[0] ?? "";
    if (isLanguage(primary)) return primary;
  }
  return fallbackLanguage;
}
