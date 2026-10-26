// Process tests for sh/guard-push.sh, the pre-push hook that refuses pushes to main. Git writes one line per
// ref to its stdin: "<local ref> <local sha> <remote ref> <remote sha>".
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { runIn, sandbox, type Sandbox } from "../test/sandbox.ts";

const script = join(import.meta.dirname, "../../sh/guard-push.sh");
const a = "1".repeat(40);
const b = "2".repeat(40);
const zero = "0".repeat(40);

let box: Sandbox;
beforeAll(() => {
  box = sandbox();
});
afterAll(() => {
  box.remove();
});

const push = (lines: string[], allow = "") =>
  runIn(box.root, "sh", [script], {
    input: lines.map((line) => `${line}\n`).join(""),
    env: { ALLOW_PUSH_TO_MAIN: allow },
  });

describe("guard-push.sh", () => {
  it.each([
    ["a fast-forward to main", [`refs/heads/x ${a} refs/heads/main ${b}`]],
    ["creating main", [`refs/heads/x ${a} refs/heads/main ${zero}`]],
    ["deleting main", [`(delete) ${zero} refs/heads/main ${b}`]],
    [
      "main among other refs",
      [`refs/heads/x ${a} refs/heads/x ${zero}`, `refs/heads/x ${a} refs/heads/main ${b}`],
    ],
  ])("refuses %s", (_, lines) => {
    const result = push(lines);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("guard-push: refusing to push to main.");
  });

  it.each([
    ["a feature branch", [`refs/heads/x ${a} refs/heads/x ${zero}`]],
    ["a branch named like main", [`refs/heads/x ${a} refs/heads/main-fix ${zero}`]],
    ["tags", [`refs/tags/api@1.0.0 ${a} refs/tags/api@1.0.0 ${zero}`]],
    ["an empty push", []],
  ])("allows %s", (_, lines) => {
    expect(push(lines)).toMatchObject({ status: 0, stderr: "" });
  });

  it("allows a push to main with ALLOW_PUSH_TO_MAIN=1, and only with 1", () => {
    const lines = [`refs/heads/x ${a} refs/heads/main ${b}`];
    expect(push(lines, "1")).toMatchObject({ status: 0, stderr: "" });
    expect(push(lines, "true").status).toBe(1);
  });
});
