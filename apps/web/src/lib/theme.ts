// ライト / ダーク / システムの 3 択。既定はシステム (OS の設定)。手動の選択は Local Storage に保存し、
// 直近の明示的な操作を優先する (docs/web-frontend/dark-mode.md)。inline script は CSP で使えないので、
// main.tsx が createRoot の前に `applyStoredTheme` を呼ぶ。

/** `<html>` のように class を切り替えられるもの。 */
export interface ClassTarget {
  readonly classList: { toggle(token: string, force: boolean): unknown };
}

/** `matchMedia` の結果のうち、使う部分。 */
export interface MediaTarget {
  readonly matches: boolean;
  addEventListener(type: "change", listener: () => void): void;
}

export type ThemePreference = "light" | "dark" | "system";

export const themePreferences: readonly ThemePreference[] = ["light", "dark", "system"];

const themeStorageKey = "theme";

export const darkSchemeQuery = "(prefers-color-scheme: dark)";

function isThemePreference(value: unknown): value is ThemePreference {
  return themePreferences.some((preference) => preference === value);
}

/** 保存した選択。なければ、読めなければ、知らない値なら "system"。Local Storage は無効にされていることがある。 */
export function readThemePreference(storage: Pick<Storage, "getItem">): ThemePreference {
  try {
    const stored = storage.getItem(themeStorageKey);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

/** `<html>` の `.dark` を、選択と OS の設定から決める。 */
export function applyTheme(
  preference: ThemePreference,
  root: ClassTarget,
  prefersDark: boolean,
): void {
  root.classList.toggle("dark", preference === "dark" || (preference === "system" && prefersDark));
}

/** 選択を保存して反映する。保存に失敗しても (容量、無効化)、この画面では反映する。 */
export function setThemePreference(
  preference: ThemePreference,
  storage: Pick<Storage, "setItem">,
  root: ClassTarget,
  prefersDark: boolean,
): void {
  try {
    storage.setItem(themeStorageKey, preference);
  } catch {
    // 保存できなくても、画面の切り替えは行う。
  }
  applyTheme(preference, root, prefersDark);
}

/** 起動時に保存した選択を反映し、"system" のときは OS の設定の変更に追従する。 */
export function applyStoredTheme(
  storage: Pick<Storage, "getItem">,
  root: ClassTarget,
  media: MediaTarget,
): void {
  applyTheme(readThemePreference(storage), root, media.matches);
  media.addEventListener("change", () => {
    applyTheme(readThemePreference(storage), root, media.matches);
  });
}

export function systemPrefersDark(): boolean {
  return window.matchMedia(darkSchemeQuery).matches;
}
