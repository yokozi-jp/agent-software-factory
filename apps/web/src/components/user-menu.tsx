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

// スマホ (`md` 未満) で 44px 以上にする (docs/web-frontend/mobile.md)。Tailwind が読めるよう、クラスは完全な文字列で書く。
const touchTargetClass = "max-md:h-11";

interface UserMenuProps {
  readonly name: string;
  readonly onSignOut: () => Promise<void>;
}

// SidebarFooter に置く、氏名、テーマの 3 択、ログアウト。ログアウトは確認なし (Issue #407)。
export function UserMenu({ name, onSignOut }: UserMenuProps) {
  const { t } = useTranslation();
  const [signOutFailed, setSignOutFailed] = useState(false);
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
            className={touchTargetClass}
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
        className={touchTargetClass}
        onClick={() => {
          setSignOutFailed(false);
          onSignOut().catch(() => {
            setSignOutFailed(true);
          });
        }}
      >
        {t("userMenu.signOut")}
      </Button>
      {signOutFailed && (
        <p role="alert" className="text-sm text-destructive">
          {t("userMenu.signOutFailed")}
        </p>
      )}
    </div>
  );
}
