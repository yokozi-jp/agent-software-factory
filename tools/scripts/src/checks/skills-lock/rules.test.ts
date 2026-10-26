import { describe, expect, it } from "vite-plus/test";
import { parseLock, problems, report, skillHash } from "./rules.ts";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("skillHash", () => {
  it("matches the hash the skills CLI records", () => {
    // Expected value: scripts/verify-skills-lock.mjs (removed in #165; its hashes matched skills-lock.json, written by
    // the skills CLI) on these files, 2026-10-26. localeCompare puts refs/ between B.md and SKILL.md.
    const files = [
      { relativePath: "SKILL.md", content: bytes("# demo\n") },
      { relativePath: "refs/a.txt", content: bytes("a\n") },
      { relativePath: "B.md", content: bytes("B") },
    ];
    expect(skillHash(files)).toBe(
      "d6d42a0d8cfe48e3c33d4f6613864fa97be53bf3c5e521d026c093f216bcb49b",
    );
  });

  it("changes when a file's content or name changes", () => {
    const base = skillHash([{ relativePath: "SKILL.md", content: bytes("a") }]);
    expect(skillHash([{ relativePath: "SKILL.md", content: bytes("b") }])).not.toBe(base);
    expect(skillHash([{ relativePath: "OTHER.md", content: bytes("a") }])).not.toBe(base);
  });
});

describe("parseLock", () => {
  it("reads the computed hash of each skill", () => {
    const lock = JSON.stringify({
      version: 1,
      skills: { tdd: { source: "x", computedHash: "aa" }, pr: { computedHash: "bb" } },
    });
    expect([...parseLock(lock)]).toEqual([
      ["tdd", "aa"],
      ["pr", "bb"],
    ]);
  });

  it("refuses a lock without skills or without a hash", () => {
    expect(() => parseLock("{}")).toThrow("skills-lock.json has no skills object");
    expect(() => parseLock('{"skills": []}')).toThrow("skills-lock.json has no skills object");
    expect(() => parseLock('{"skills": null}')).toThrow("skills-lock.json has no skills object");
    expect(() => parseLock("[]")).toThrow("skills-lock.json has no skills object");
    expect(() => parseLock('{"skills": {"tdd": {}}}')).toThrow(
      "skills-lock.json: tdd has no computedHash",
    );
    expect(() => parseLock('{"skills": {"tdd": "aa"}}')).toThrow(
      "skills-lock.json: tdd has no computedHash",
    );
  });
});

describe("problems", () => {
  const lock = new Map([
    ["tdd", "aa"],
    ["pr", "bb"],
  ]);
  const installed = new Map(lock);
  const kiro = new Map([
    ["tdd", "../../.agents/skills/tdd"],
    ["pr", "../../.agents/skills/pr"],
  ]);

  it("passes when every skill matches the lock and has its symlink", () => {
    expect(problems({ lock, installed, kiro })).toEqual([]);
  });

  it("refuses a skill whose content differs from the lock", () => {
    expect(problems({ lock, installed: new Map([...installed, ["pr", "cc"]]), kiro })).toEqual([
      ".agents/skills/pr: content differs from skills-lock.json",
    ]);
  });

  it("refuses a skill without its symlink in .kiro/skills", () => {
    expect(
      problems({ lock, installed, kiro: new Map([["tdd", "../../.agents/skills/tdd"]]) }),
    ).toEqual([".kiro/skills/pr: missing (must be a symlink to ../../.agents/skills/pr)"]);
  });

  it("refuses an entry in .kiro/skills that is not a symlink to the skill", () => {
    const wrong = new Map<string, string | undefined>([
      ["tdd", undefined],
      ["pr", "../../.agents/skills/tdd"],
    ]);
    expect(problems({ lock, installed, kiro: wrong })).toEqual([
      ".kiro/skills/tdd: must be a symlink to ../../.agents/skills/tdd",
      ".kiro/skills/pr: must be a symlink to ../../.agents/skills/pr",
    ]);
  });

  it("refuses skills and links that the lock does not record, and recorded skills that are missing", () => {
    expect(
      problems({
        lock,
        installed: new Map([
          ["tdd", "aa"],
          ["extra", "dd"],
        ]),
        kiro: new Map([...kiro, ["stray", "../../.agents/skills/stray"]]),
      }),
    ).toEqual([
      ".agents/skills/extra: not recorded in skills-lock.json",
      ".agents/skills/pr: missing (recorded in skills-lock.json)",
      ".kiro/skills/stray: not recorded in skills-lock.json",
    ]);
  });
});

describe("report", () => {
  it("says how many skills match", () => {
    expect(report([], 2)).toEqual({
      status: 0,
      stdout: "skills-lock: 2 skills match skills-lock.json\n",
      stderr: "",
    });
  });

  it("lists the problems and how to restore the skills", () => {
    expect(report(["a", "b"], 2)).toEqual({
      status: 1,
      stdout: "",
      stderr:
        "a\nb\n\nSkills must match skills-lock.json. Restore them (git restore .agents/skills .kiro/skills) or reinstall with the skills CLI.\n",
    });
  });
});
