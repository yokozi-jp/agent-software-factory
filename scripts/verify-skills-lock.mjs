#!/usr/bin/env node
// Verify that every agent skill under .kiro/skills is byte-identical to what skills-lock.json records.
// Hash algorithm mirrors `computeSkillFolderHash` in the `skills` CLI (npm: skills):
// sha256 over (relative path, file content) for every file, sorted by relative path.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const SKILLS_DIR = ".kiro/skills";
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

if (problems.length > 0) {
  console.error(problems.join("\n"));
  console.error(
    `\nSkills must match ${LOCK_FILE}. Restore them (git restore ${SKILLS_DIR}) or reinstall with the skills CLI.`,
  );
  process.exit(1);
}
console.log(`skills-lock: ${installed.length} skills match ${LOCK_FILE}`);
