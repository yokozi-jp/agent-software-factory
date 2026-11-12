import { describe, expect, it } from "vite-plus/test";
import { settingsWriteRefusal } from "./settings-writes.ts";

describe("settingsWriteRefusal", () => {
  it.each([".kiro/settings", ".kiro/settings/cli.json", ".kiro/settings/mcp.json"])(
    "%s への書き込みを拒否すること",
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
  ])("%s への書き込みを許可すること", (rel) => {
    expect(settingsWriteRefusal("str_replace", rel)).toBeUndefined();
  });
});
