// The hook definitions in .kiro/hooks/ start the entry points here. A wrong path or matcher would not
// fail anywhere else: Kiro treats a command that cannot start as a failed hook and lets the call through.
// .kiro/hooks/*.json is an input of the `test` target (package.json), so changing it runs this test.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { preToolUseMatcher } from "./pre-tool-use/rules.ts";

// The workspace root: the nearest directory above with pnpm-workspace.yaml. Stryker runs a copy of this
// project in a deeper directory (tools/scripts/.stryker-tmp/), so the depth is not fixed.
let workspace = import.meta.dirname;
while (!existsSync(join(workspace, "pnpm-workspace.yaml"))) workspace = dirname(workspace);
const hooksDir = join(workspace, ".kiro/hooks");
const entry = (name: string): string => `tools/scripts/src/hooks/${name}/cli.ts`;
// The compile cache in the directory Node.js uses by default, os.tmpdir() (Node.js docs, "Module compile
// cache"): it speeds up the start after the first one.
const command = (name: string): string =>
  `NODE_COMPILE_CACHE="\${TMPDIR:-/tmp}/node-compile-cache" node ${entry(name)}`;

describe(".kiro/hooks", () => {
  it("has one hook per trigger, each starting its entry point with node and a compile cache", () => {
    const documents = readdirSync(hooksDir)
      .sort()
      .map((name): unknown => JSON.parse(readFileSync(join(hooksDir, name), "utf8")));
    expect(documents).toEqual([
      {
        version: "v1",
        hooks: [
          {
            name: "pre-tool-use",
            trigger: "PreToolUse",
            description: expect.any(String) as unknown,
            // Only the tools a check looks at, so Node does not start for reads and searches.
            matcher: preToolUseMatcher,
            action: { type: "command", command: command("pre-tool-use") },
            timeout: 10,
          },
        ],
      },
      {
        version: "v1",
        hooks: [
          {
            name: "session-start",
            trigger: "SessionStart",
            description: expect.any(String) as unknown,
            action: { type: "command", command: command("session-start") },
            timeout: 10,
          },
        ],
      },
      {
        version: "v1",
        hooks: [
          {
            name: "stop",
            trigger: "Stop",
            description: expect.any(String) as unknown,
            action: { type: "command", command: command("stop") },
            timeout: 10,
          },
        ],
      },
    ]);
  });

  it.each(["pre-tool-use", "session-start", "stop"])(
    "names an entry point that exists: %s",
    (name) => {
      expect(existsSync(join(workspace, entry(name)))).toBe(true);
    },
  );
});
