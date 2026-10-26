// Test helpers for the tests of the shell wrappers (src/sh/): stand-ins for the commands a wrapper calls
// (mise, pnpm, gh), and a PATH that lacks some command. They only write files into the directory they are
// given, which is the sandbox (sandbox.ts); they start no process.
import { chmodSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

// A directory <root>/<id> with one executable per entry of `commands`: the name is the command, the value the
// body of its sh script. Returns the directory, to put first on PATH (see withPath).
export function stubDir(root: string, id: string, commands: Record<string, string>): string {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(commands)) {
    const file = join(dir, name);
    writeFileSync(file, `#!/bin/sh\n${body}\n`);
    chmodSync(file, 0o755);
  }
  return dir;
}

// A directory <root>/<id> that links only the commands in `names`, from the PATH the tests run with. A PATH
// that holds only this directory has none of the other commands, mise for one.
export function onlyCommands(root: string, id: string, names: readonly string[]): string {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  // Absolute entries only: a relative one such as "." would find a file of the working directory.
  const path = String(process.env.PATH)
    .split(":")
    .filter((entry) => isAbsolute(entry));
  for (const name of names) {
    const found = path.map((entry) => join(entry, name)).find((file) => existsSync(file));
    symlinkSync(String(found), join(dir, name));
  }
  return dir;
}

// The PATH in which the commands of `dir` come before the ones of the machine.
export const withPath = (dir: string): string => `${dir}:${process.env.PATH}`;
