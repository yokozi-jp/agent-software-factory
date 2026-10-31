import { describe, expect, it } from "vite-plus/test";

import { applyTheme, readThemePreference, setThemePreference } from "./theme.ts";

const storageOf = (value: string | null) => ({ getItem: () => value });
const rootOf = (dark: boolean) => {
  const classes = new Set<string>(dark ? ["dark"] : []);
  return {
    classList: {
      toggle: (name: string, force: boolean) => {
        if (force) classes.add(name);
        else classes.delete(name);
        return classes.has(name);
      },
    },
    has: (name: string) => classes.has(name),
  };
};

describe("テーマの選択 (docs/web-frontend/dark-mode.md)", () => {
  it.each([
    { stored: "light", expected: "light" },
    { stored: "dark", expected: "dark" },
    { stored: "system", expected: "system" },
    { stored: null, expected: "system" },
    { stored: "<script>", expected: "system" },
  ])("保存した値 $stored を読むと $expected", ({ stored, expected }) => {
    expect(readThemePreference(storageOf(stored))).toBe(expected);
  });

  it("Local Storage が読めなくても system", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readThemePreference(blocked)).toBe("system");
  });

  it.each([
    { preference: "light", prefersDark: true, dark: false },
    { preference: "dark", prefersDark: false, dark: true },
    { preference: "system", prefersDark: true, dark: true },
    { preference: "system", prefersDark: false, dark: false },
  ] as const)("$preference (OS がダーク: $prefersDark) なら .dark は $dark", (c) => {
    const root = rootOf(!c.dark);
    applyTheme(c.preference, root, c.prefersDark);
    expect(root.has("dark")).toBe(c.dark);
  });

  it("選択を保存して反映する。保存に失敗しても反映する", () => {
    const saved: string[] = [];
    const root = rootOf(false);
    setThemePreference("dark", { setItem: (_key, value) => void saved.push(value) }, root, false);
    expect(saved).toEqual(["dark"]);
    expect(root.has("dark")).toBe(true);

    const full = rootOf(false);
    setThemePreference(
      "dark",
      {
        setItem: () => {
          throw new Error("quota");
        },
      },
      full,
      false,
    );
    expect(full.has("dark")).toBe(true);
  });
});
