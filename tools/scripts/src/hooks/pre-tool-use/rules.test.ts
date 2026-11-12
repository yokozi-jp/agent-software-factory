import { describe, expect, it } from "vite-plus/test";
import { preToolUse, preToolUseMatcher, type PreToolUseDeps } from "./rules.ts";

const shell = (command: string, tool = "execute_bash") => ({
  hook_event_name: "PreToolUse",
  tool_name: tool,
  tool_input: { command },
});
const write = (tool: string, path: string) => ({
  hook_event_name: "PreToolUse",
  tool_name: tool,
  tool_input: { path, text: "x" },
});

// Deps that record the tools whose write target was asked for. The target is the path in the input.
function deps(): PreToolUseDeps & { targets: string[] } {
  const targets: string[] = [];
  return {
    targets,
    writeTarget(tool, input) {
      targets.push(tool);
      const path: unknown = Reflect.get(
        Object(input),
        tool === "delete_file" ? "targetFile" : "path",
      );
      return typeof path === "string" ? path : undefined;
    },
  };
}
const allow = { status: 0, stdout: "", stderr: "" };
const forcePushMessage =
  "block-force-push: refused. Force push rewrites the remote branch. Ask the user to run it, or merge without rewriting history (PRs are squash merged, docs/adr/0004).";
const iweNormalizeMessage =
  "block-iwe-normalize: refused. `iwe normalize` rewrites every document under docs/ (docs/adr/0006). Edit files directly instead; see docs/knowledge/documentation-authoring.md.";
describe("preToolUse: force push の拒否", () => {
  it.each(["execute_bash", "shell"])(
    "%s からの force push を終了コード 2 で拒否し、理由を stderr に出力すること",
    (tool) => {
      expect(preToolUse(shell("git push -f", tool), {}, deps())).toEqual({
        status: 2,
        stdout: "",
        stderr: `${forcePushMessage}\n`,
      });
    },
  );

  it("通常の push を許可すること", () => {
    expect(preToolUse(shell("git push"), {}, deps())).toEqual(allow);
  });

  it("KIRO_ALLOW_FORCE_PUSH=1 のとき force push を許可すること", () => {
    expect(preToolUse(shell("git push -f"), { KIRO_ALLOW_FORCE_PUSH: "1" }, deps())).toEqual(allow);
  });

  it("シェルでない tool を見ないこと", () => {
    expect(preToolUse(write("fs_write", "git push -f"), {}, deps())).toEqual(allow);
  });
});

describe("preToolUse: iwe normalize の拒否", () => {
  it("シェルからのサブコマンドを拒否すること", () => {
    expect(preToolUse(shell("iwe normalize"), {}, deps())).toEqual({
      status: 2,
      stdout: "",
      stderr: `${iweNormalizeMessage}\n`,
    });
  });

  it("iwe の MCP tool を拒否すること", () => {
    const event = { tool_name: "@iwe/iwe_normalize", tool_input: {} };
    expect(preToolUse(event, {}, deps()).status).toBe(2);
  });

  it("IWE_ALLOW_NORMALIZE=1 のとき両方を許可すること", () => {
    const env = { IWE_ALLOW_NORMALIZE: "1" };
    expect(preToolUse(shell("iwe normalize"), env, deps())).toEqual(allow);
    expect(preToolUse({ tool_name: "@iwe/iwe_normalize" }, env, deps())).toEqual(allow);
  });

  it("コマンドが両方に当たるとき、すべての理由を述べること", () => {
    expect(preToolUse(shell("git push -f; iwe normalize"), {}, deps())).toEqual({
      status: 2,
      stdout: "",
      stderr: `${forcePushMessage}\n${iweNormalizeMessage}\n`,
    });
  });

  it("matcher の外の tool を見ないこと", () => {
    expect(preToolUse({ tool_name: "fs_write_iwe_normalize" }, {}, deps()).status).toBe(0);
  });
});

describe("preToolUse: 生成されたファイル", () => {
  it.each(["fs_write", "str_replace", "fs_append"])(
    "生成されたファイルへの %s を拒否すること",
    (tool) => {
      const result = preToolUse(write(tool, "pnpm-lock.yaml"), {}, deps());
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(
        new RegExp(
          `^block-generated-writes: refused ${tool} on pnpm-lock.yaml\\. .*pnpm install.*\\n$`,
        ),
      );
    },
  );

  it("ファイルを targetFile と名付ける delete_file を拒否すること", () => {
    const event = { tool_name: "delete_file", tool_input: { targetFile: "skills-lock.json" } };
    expect(preToolUse(event, {}, deps()).stderr).toContain("pnpm dlx skills update");
  });

  it("ほかのファイルを許可すること", () => {
    expect(preToolUse(write("fs_write", "README.md"), {}, deps())).toEqual(allow);
  });

  it("hook が位置づけられない書き込みを許可すること", () => {
    expect(preToolUse({ tool_name: "fs_write", tool_input: {} }, {}, deps())).toEqual(allow);
  });

  it("KIRO_ALLOW_GENERATED_WRITE=1 のとき生成されたファイルを許可すること", () => {
    const env = { KIRO_ALLOW_GENERATED_WRITE: "1" };
    expect(preToolUse(write("fs_write", "pnpm-lock.yaml"), env, deps())).toEqual(allow);
  });

  it("読み取りや、似た名前の tool の path を解決しないこと", () => {
    const d = deps();
    preToolUse(write("read_file", "pnpm-lock.yaml"), {}, d);
    preToolUse(write("fs_write2", "pnpm-lock.yaml"), {}, d);
    preToolUse(write("xfs_write", "pnpm-lock.yaml"), {}, d);
    expect(d.targets).toEqual([]);
  });
});

describe("preToolUse: 禁止のコマンド", () => {
  it.each(["execute_bash", "shell"])("%s からの gh pr merge を拒否すること", (tool) => {
    const result = preToolUse(shell("gh pr merge 12", tool), {}, deps());
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(
      /^block-forbidden-commands: refused\. .*The user merges it\. .*\n$/,
    );
  });

  it("通常のコマンドを許可すること", () => {
    expect(preToolUse(shell("gh pr create --fill"), {}, deps())).toEqual(allow);
  });

  it("通す変数がないこと", () => {
    const env = {
      KIRO_ALLOW_FORCE_PUSH: "1",
      IWE_ALLOW_NORMALIZE: "1",
      KIRO_ALLOW_GENERATED_WRITE: "1",
    };
    expect(preToolUse(shell("git push origin main"), env, deps()).status).toBe(2);
  });

  it("シェルでない tool を見ないこと", () => {
    expect(preToolUse(write("fs_write", "gh pr merge 12"), {}, deps())).toEqual(allow);
  });

  it("コマンドが両方に当たるとき、両方の検査の理由を述べること", () => {
    const result = preToolUse(shell("git push -f origin main"), {}, deps());
    expect(result.stderr).toContain("block-force-push");
    expect(result.stderr).toContain("block-forbidden-commands");
  });
});

describe("preToolUse: コミットしていない変更を捨てること", () => {
  const ask = (reason: string) => ({
    status: 0,
    stdout: JSON.stringify({
      hookSpecificOutput: { permissionDecision: "ask", permissionDecisionReason: reason },
    }),
    stderr: "",
  });

  const discardReason =
    "ask-discard-changes: this git command discards uncommitted changes, which git cannot restore. The working tree may hold another session's edits or your own uncommitted ones. To undo your own edit, write the file back with the file tools, or keep the changes with `git stash`. To change branch, use `git switch <branch>` (docs/tooling/agent-permissions.md).";

  it.each(["execute_bash", "shell"])(
    "%s のとき、終了コード 0 で尋ね、判断を stdout に出力すること",
    (tool) => {
      expect(preToolUse(shell("git checkout -- src/a.ts", tool), {}, deps())).toEqual(
        ask(discardReason),
      );
    },
  );

  it("変更を残すコマンドでは尋ねないこと", () => {
    expect(preToolUse(shell("git restore --staged src/a.ts"), {}, deps())).toEqual(allow);
  });

  it("シェルでない tool を見ないこと", () => {
    expect(preToolUse(write("fs_write", "git reset --hard"), {}, deps())).toEqual(allow);
  });

  it("コマンドが拒否にも当たるとき、尋ねずに拒否すること", () => {
    const result = preToolUse(shell("git reset --hard && git push -f"), {}, deps());
    expect(result).toEqual({ status: 2, stdout: "", stderr: `${forcePushMessage}\n` });
  });
});

describe("preToolUse: .kiro/settings の保護", () => {
  it.each(["fs_write", "str_replace", "fs_append", "delete_file"])("%s を拒否すること", (tool) => {
    const event = {
      tool_name: tool,
      tool_input:
        tool === "delete_file"
          ? { targetFile: ".kiro/settings/cli.json" }
          : { path: ".kiro/settings/cli.json" },
    };
    const result = preToolUse(event, {}, deps());
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(
      /^block-settings-writes: refused .* on \.kiro\/settings\/cli\.json\./,
    );
  });

  it("通す変数がないこと", () => {
    const env = { KIRO_ALLOW_GENERATED_WRITE: "1" };
    expect(preToolUse(write("fs_write", ".kiro/settings/cli.json"), env, deps()).status).toBe(2);
  });

  it(".kiro/agents を許可すること", () => {
    expect(preToolUse(write("fs_write", ".kiro/agents/factory.json"), {}, deps())).toEqual(allow);
  });
});

describe("preToolUseMatcher", () => {
  const matcher = new RegExp(preToolUseMatcher);
  it.each([
    "shell",
    "execute_bash",
    "@iwe/iwe_normalize",
    "fs_write",
    "str_replace",
    "fs_append",
    "delete_file",
  ])("検査が見る %s のとき、hook を起動すること", (tool) => {
    expect(matcher.test(tool)).toBe(true);
  });

  // fsWrite, write and the other names only the concurrent-sessions ask looked at (removed in #191).
  it.each([
    "read_file",
    "grep_search",
    "list_directory",
    "code",
    "web_fetch",
    "fsWrite",
    "strReplace",
    "fsAppend",
    "deleteFile",
    "write",
  ])("%s のとき起動しないこと", (tool) => {
    expect(matcher.test(tool)).toBe(false);
  });
});

describe("preToolUse: 読めないイベント", () => {
  it.each([
    undefined,
    null,
    "text",
    1,
    [],
    {},
    { tool_name: 1 },
    { tool_name: "execute_bash" },
    { tool_name: "execute_bash", tool_input: { command: 1 } },
  ])("%j を許可すること", (event) => {
    expect(preToolUse(event, {}, deps())).toEqual(allow);
  });
});
