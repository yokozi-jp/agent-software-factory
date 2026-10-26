// Process tests for the skills-lock entry point: a tree of skills, symlinks and skills-lock.json in the
// sandbox, to exit code and output. Which differences are problems is in rules.test.ts.
import { appendFileSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runIn, sandbox, type Sandbox } from "../../test/sandbox.ts";

const cli = join(import.meta.dirname, "cli.ts");
// The hash of a skill folder that holds only SKILL.md with "# demo\n", computed by
// scripts/verify-skills-lock.mjs (which matched the skills CLI; removed in #165) on 2026-10-26.
const demoHash = "c5df3cdf05822395de45bb9c89dbaf6ed5a2e84490a4cec9a4d619f0c3f917cf";

let box: Sandbox;
let repo: string;
const run = () => runIn(repo, process.execPath, [cli]);

beforeEach(() => {
  box = sandbox();
  repo = join(box.root, "repo");
  mkdirSync(join(repo, ".agents/skills/demo"), { recursive: true });
  mkdirSync(join(repo, ".kiro/skills"), { recursive: true });
  writeFileSync(join(repo, ".agents/skills/demo/SKILL.md"), "# demo\n");
  symlinkSync("../../.agents/skills/demo", join(repo, ".kiro/skills/demo"));
  writeFileSync(
    join(repo, "skills-lock.json"),
    JSON.stringify({ version: 1, skills: { demo: { computedHash: demoHash } } }),
  );
});
afterEach(() => {
  box.remove();
});

describe("skills-lock", () => {
  it("passes when the skills match the lock", () => {
    expect(run()).toEqual({
      status: 0,
      stdout: "skills-lock: 1 skills match skills-lock.json\n",
      stderr: "",
    });
  });

  it("does not hash .git and node_modules inside a skill", () => {
    mkdirSync(join(repo, ".agents/skills/demo/node_modules"));
    mkdirSync(join(repo, ".agents/skills/demo/.git"));
    writeFileSync(join(repo, ".agents/skills/demo/node_modules/x.js"), "x");
    writeFileSync(join(repo, ".agents/skills/demo/.git/HEAD"), "x");
    expect(run().status).toBe(0);
  });

  it("fails when a file of a skill changed", () => {
    appendFileSync(join(repo, ".agents/skills/demo/SKILL.md"), "edited\n");
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(".agents/skills/demo: content differs from skills-lock.json\n");
  });

  it("fails when a file in a subfolder of a skill is added", () => {
    mkdirSync(join(repo, ".agents/skills/demo/refs"));
    writeFileSync(join(repo, ".agents/skills/demo/refs/a.md"), "a\n");
    expect(run().stderr).toContain(".agents/skills/demo: content differs");
  });

  it("fails when the symlink in .kiro/skills is missing or is a copy", () => {
    rmSync(join(repo, ".kiro/skills/demo"));
    expect(run().stderr).toContain(
      ".kiro/skills/demo: missing (must be a symlink to ../../.agents/skills/demo)",
    );
    mkdirSync(join(repo, ".kiro/skills/demo"));
    const copy = run();
    expect(copy.status).toBe(1);
    expect(copy.stderr).toContain(
      ".kiro/skills/demo: must be a symlink to ../../.agents/skills/demo",
    );
  });

  it("fails when .kiro/skills does not exist", () => {
    rmSync(join(repo, ".kiro/skills"), { recursive: true });
    expect(run().stderr).toContain(".kiro/skills/demo: missing");
  });

  it("does not count a file in .agents/skills as a skill", () => {
    writeFileSync(join(repo, ".agents/skills/README.md"), "x");
    expect(run().status).toBe(0);
  });
});
