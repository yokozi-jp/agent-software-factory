#!/usr/bin/env node
// Verify that every agent skill under .agents/skills is byte-identical to what skills-lock.json records,
// and that .kiro/skills holds a symlink to each of them (Kiro reads skills from .kiro/skills).
// Hash algorithm mirrors `computeSkillFolderHash` in the `skills` CLI (npm: skills):
// sha256 over (relative path, file content) for every file, sorted by relative path.
import { createHash } from "node:crypto";
import { readdir, readFile, readlink } from "node:fs/promises";
import { join, relative } from "node:path";

const SKILLS_DIR = ".agents/skills";
const KIRO_SKILLS_DIR = ".kiro/skills";
const LOCK_FILE = "skills-lock.json";

async function collectFiles(baseDir, currentDir, results) {
  for (const entry of await readdir(currentDir, { withFileTypes: true })) {
    const fullPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      await collectFiles(baseDir, fullPath, results);
    } else if (entry.isFile()) {
      results.push({
        relativePath: relative(baseDir, fullPath).split("\\").join("/"),
        content: await readFile(fullPath),
      });
    }
  }
}

async function hashSkill(dir) {
  const files = [];
  await collectFiles(dir, dir, files);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.relativePath);
    hash.update(file.content);
  }
  return hash.digest("hex");
}

const lock = JSON.parse(await readFile(LOCK_FILE, "utf8")).skills;
const installed = (await readdir(SKILLS_DIR, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const problems = [];
for (const name of installed) {
  if (!(name in lock)) problems.push(`${SKILLS_DIR}/${name}: not recorded in ${LOCK_FILE}`);
}
for (const [name, { computedHash }] of Object.entries(lock)) {
  if (!installed.includes(name)) {
    problems.push(`${SKILLS_DIR}/${name}: missing (recorded in ${LOCK_FILE})`);
  } else if ((await hashSkill(join(SKILLS_DIR, name))) !== computedHash) {
    problems.push(`${SKILLS_DIR}/${name}: content differs from ${LOCK_FILE}`);
  }
}

const kiroEntries = await readdir(KIRO_SKILLS_DIR, { withFileTypes: true }).catch(() => []);
for (const name of Object.keys(lock)) {
  const entry = kiroEntries.find((e) => e.name === name);
  const expected = `../../${SKILLS_DIR}/${name}`;
  if (!entry) {
    problems.push(`${KIRO_SKILLS_DIR}/${name}: missing (must be a symlink to ${expected})`);
  } else if (
    !entry.isSymbolicLink() ||
    (await readlink(join(KIRO_SKILLS_DIR, name))) !== expected
  ) {
    problems.push(`${KIRO_SKILLS_DIR}/${name}: must be a symlink to ${expected}`);
  }
}
for (const entry of kiroEntries) {
  if (!(entry.name in lock))
    problems.push(`${KIRO_SKILLS_DIR}/${entry.name}: not recorded in ${LOCK_FILE}`);
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  console.error(
    `\nSkills must match ${LOCK_FILE}. Restore them (git restore ${SKILLS_DIR} ${KIRO_SKILLS_DIR}) or reinstall with the skills CLI.`,
  );
  process.exit(1);
}
console.log(`skills-lock: ${installed.length} skills match ${LOCK_FILE}`);
