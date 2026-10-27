import { describe, expect, it } from "vite-plus/test";
import { settingsWriteRefusal } from "./settings-writes.ts";

describe("settingsWriteRefusal", () => {
  it.each([".kiro/settings", ".kiro/settings/cli.json", ".kiro/settings/mcp.json"])(
    "refuses a write to %s",
    (rel) => {
      const message = settingsWriteRefusal("fs_write", rel);
      expect(message).toMatch(/^block-settings-writes: refused fs_write on /);
      expect(message).toContain(rel);
      expect(message).toContain("docs/tooling/agent-permissions.md");
      expect(message).toContain("PR");
    },
  );

  it.each([
    ".kiro/agents/factory.json",
    ".kiro/hooks/pre-tool-use.json",
    ".kiro/settings-notes.md",
    "docs/.kiro/settings/cli.json",
    "README.md",
  ])("allows a write to %s", (rel) => {
    expect(settingsWriteRefusal("str_replace", rel)).toBeUndefined();
  });
});
