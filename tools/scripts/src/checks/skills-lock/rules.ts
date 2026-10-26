// The rules of the skills-lock check (docs/tooling/ci.md): every agent skill under .agents/skills is
// byte-identical to what skills-lock.json records, and .kiro/skills holds a symlink to each of them
// (Kiro reads skills from .kiro/skills). Pure functions; cli.ts reads the files and prints.
import { createHash } from "node:crypto";
import { isObject } from "../json.ts";

export const SKILLS_DIR = ".agents/skills";
const KIRO_SKILLS_DIR = ".kiro/skills";
const LOCK_FILE = "skills-lock.json";

export interface SkillFile {
  // Relative to the skill's folder, with "/" separators.
  readonly relativePath: string;
  readonly content: Uint8Array;
}

// Mirrors `computeSkillFolderHash` in the skills CLI (npm: skills), which writes skills-lock.json:
// sha256 over (relative path, content) of every file, sorted by relative path with localeCompare.
export function skillHash(files: readonly SkillFile[]): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
    hash.update(file.relativePath);
    hash.update(file.content);
  }
  return hash.digest("hex");
}

// Skill name to the computedHash recorded in skills-lock.json, in the order of the file.
export function parseLock(text: string): Map<string, string> {
  const lock: unknown = JSON.parse(text);
  const skills = isObject(lock) ? lock.skills : undefined;
  if (!isObject(skills)) throw new Error(`${LOCK_FILE} has no skills object`);
  return new Map(
    Object.entries(skills).map(([name, entry]) => {
      const hash = isObject(entry) ? entry.computedHash : undefined;
      if (typeof hash !== "string") throw new Error(`${LOCK_FILE}: ${name} has no computedHash`);
      return [name, hash];
    }),
  );
}

export interface SkillsState {
  // Skill name to the hash recorded in skills-lock.json.
  readonly lock: ReadonlyMap<string, string>;
  // Each folder under .agents/skills to the hash of its files.
  readonly installed: ReadonlyMap<string, string>;
  // Each entry of .kiro/skills to its symlink target; undefined when it is not a symlink.
  readonly kiro: ReadonlyMap<string, string | undefined>;
}

export function problems({ lock, installed, kiro }: SkillsState): string[] {
  const out: string[] = [];
  for (const name of installed.keys()) {
    if (!lock.has(name)) out.push(`${SKILLS_DIR}/${name}: not recorded in ${LOCK_FILE}`);
  }
  for (const [name, hash] of lock) {
    const actual = installed.get(name);
    if (actual === undefined) out.push(`${SKILLS_DIR}/${name}: missing (recorded in ${LOCK_FILE})`);
    else if (actual !== hash) out.push(`${SKILLS_DIR}/${name}: content differs from ${LOCK_FILE}`);
  }
  for (const name of lock.keys()) {
    const expected = `../../${SKILLS_DIR}/${name}`;
    if (!kiro.has(name)) {
      out.push(`${KIRO_SKILLS_DIR}/${name}: missing (must be a symlink to ${expected})`);
    } else if (kiro.get(name) !== expected) {
      out.push(`${KIRO_SKILLS_DIR}/${name}: must be a symlink to ${expected}`);
    }
  }
  for (const name of kiro.keys()) {
    if (!lock.has(name)) out.push(`${KIRO_SKILLS_DIR}/${name}: not recorded in ${LOCK_FILE}`);
  }
  return out;
}

export interface Result {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export function report(found: readonly string[], installedCount: number): Result {
  if (found.length === 0) {
    return {
      status: 0,
      stdout: `skills-lock: ${installedCount} skills match ${LOCK_FILE}\n`,
      stderr: "",
    };
  }
  const restore = `Skills must match ${LOCK_FILE}. Restore them (git restore ${SKILLS_DIR} ${KIRO_SKILLS_DIR}) or reinstall with the skills CLI.`;
  return { status: 1, stdout: "", stderr: `${found.join("\n")}\n\n${restore}\n` };
}
