// Verify that every agent skill under .agents/skills matches skills-lock.json, and that .kiro/skills holds
// a symlink to each (docs/tooling/ci.md). Run from the repository root by CI and the pre-commit hook:
//   node tools/scripts/src/checks/skills-lock/cli.ts
// The rules are in rules.ts; this file reads the files and prints.
import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join, relative } from "node:path";
import { parseLock, problems, report, skillHash, SKILLS_DIR, type SkillFile } from "./rules.ts";

// Every file of a skill, as the skills CLI hashes it: .git and node_modules are skipped.
function skillFiles(base: string, dir: string = base): SkillFile[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry): SkillFile[] => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === ".git" || entry.name === "node_modules" ? [] : skillFiles(base, path);
    }
    if (!entry.isFile()) return [];
    const relativePath = relative(base, path).replaceAll("\\", "/");
    return [{ relativePath, content: readFileSync(path) }];
  });
}

const kiroDir = ".kiro/skills";
const installed = new Map(
  readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => [entry.name, skillHash(skillFiles(join(SKILLS_DIR, entry.name)))]),
);
let kiroEntries: string[] = [];
try {
  kiroEntries = readdirSync(kiroDir);
} catch {
  // No .kiro/skills: every skill's link is missing.
}
const kiro = new Map(
  kiroEntries.map((name): [string, string | undefined] => {
    try {
      return [name, readlinkSync(join(kiroDir, name))];
    } catch {
      return [name, undefined];
    }
  }),
);

const result = report(
  problems({ lock: parseLock(readFileSync("skills-lock.json", "utf8")), installed, kiro }),
  installed.size,
);
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exitCode = result.status;
