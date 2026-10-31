import { Button } from "@agent-software-factory/ui/components/button";
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  readThemePreference,
  setThemePreference,
  systemPrefersDark,
  themePreferences,
  type ThemePreference,
} from "@/lib/theme.ts";

// `t` のキーは文字列のリテラルで書く規則 (docs/adr/0044)。
const themeLabels: Record<ThemePreference, (t: TFunction) => string> = {
  light: (t) => t("theme.light"),
  dark: (t) => t("theme.dark"),
  system: (t) => t("theme.system"),
};

interface UserMenuProps {
  readonly name: string;
  readonly onSignOut: () => Promise<void>;
}

// SidebarFooter に置く、氏名、テーマの 3 択、ログアウト。ログアウトは確認なし (Issue #407)。
export function UserMenu({ name, onSignOut }: UserMenuProps) {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<ThemePreference>(() => readThemePreference(localStorage));

  const choose = (preference: ThemePreference) => {
    setThemePreference(preference, localStorage, document.documentElement, systemPrefersDark());
    setTheme(preference);
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="truncate text-sm font-medium">{name}</p>
      <fieldset className="flex gap-1">
        <legend className="sr-only">{t("userMenu.theme")}</legend>
        {themePreferences.map((preference) => (
          <Button
            key={preference}
            type="button"
            size="sm"
            variant={theme === preference ? "secondary" : "ghost"}
            aria-pressed={theme === preference}
            onClick={() => {
              choose(preference);
            }}
          >
            {themeLabels[preference](t)}
          </Button>
        ))}
      </fieldset>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          void onSignOut();
        }}
      >
        {t("userMenu.signOut")}
      </Button>
    </div>
  );
}
