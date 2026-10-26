// Test helpers that start processes. Test files may not import node:child_process themselves (the
// no-restricted-imports rule in the root vite.config.ts); they go through gitIn and runIn here, which
// refuse to act outside the sandbox. setup.ts has already cleared the git variables of a Git hook.
// The design follows git's own t/test-lib.sh: GIT_CEILING_DIRECTORIES, and HOME inside the sandbox.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative, isAbsolute, resolve } from "node:path";

export interface Sandbox {
  // The real path (no symlinks), as git prints it.
  readonly root: string;
  remove(): void;
}

let current: string | undefined;

// A fresh temporary directory that git repository discovery cannot climb out of.
export function sandbox(): Sandbox {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "scripts-test-")));
  current = root;
  // A directory in the sandbox without its own .git finds no repository, instead of this one.
  process.env.GIT_CEILING_DIRECTORIES = root;
  return {
    root,
    remove() {
      rmSync(root, { recursive: true, force: true });
      if (current === root) current = undefined;
    },
  };
}

function activeSandbox(): string {
  if (current === undefined) throw new Error("sandbox.ts: call sandbox() before running a command");
  return current;
}

const inside = (root: string, path: string): boolean => {
  const rel = relative(root, resolve(path));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

const environment = (root: string, env: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  ...process.env,
  HOME: root,
  ...env,
});

export interface GitOptions {
  readonly input?: string;
}

// git <args> in <dir>, only if <dir>'s repository lives in the sandbox. Returns stdout; throws on failure.
// `init` and `clone` create the repository, so for them <dir> itself must be in the sandbox, and they must
// create the repository in <dir> (`git init`, `git clone <source> .`).
export function gitIn(dir: string, args: readonly string[], options: GitOptions = {}): string {
  const root = activeSandbox();
  const env = environment(root);
  const run = (): string =>
    execFileSync("git", args, {
      cwd: dir,
      env,
      encoding: "utf8",
      stdio: "pipe",
      input: options.input ?? "",
    });
  if (args[0] === "init" || args[0] === "clone") {
    if (!inside(root, dir))
      throw new Error(
        `sandbox.ts: refusing to create a repository in ${dir}, outside the sandbox ${root}`,
      );
    mkdirSync(dir, { recursive: true });
    return run();
  }
  let gitDir: string;
  try {
    gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
      cwd: dir,
      env,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  } catch {
    throw new Error(`sandbox.ts: ${dir} is not a git repository`);
  }
  if (!inside(root, gitDir)) {
    throw new Error(
      `sandbox.ts: refusing to run git in ${dir}: its repository is ${gitDir}, outside the sandbox ${root}`,
    );
  }
  return run();
}

export interface Background {
  readonly pid: number;
  // Kills the process and waits until it has exited.
  stop(): Promise<void>;
}

// <command> <args> in <dir> in the background, only if <dir> is in the sandbox. For a test that needs a
// live process (another Kiro session, say). Call stop() when done.
export function startIn(dir: string, command: string, args: readonly string[]): Background {
  const root = activeSandbox();
  if (!inside(root, dir))
    throw new Error(`sandbox.ts: refusing to run in ${dir}, outside the sandbox ${root}`);
  const child = spawn(command, args, { cwd: dir, env: environment(root), stdio: "ignore" });
  // A command that cannot start reports it as an error event, and leaves pid undefined.
  child.once("error", () => {});
  const exited = new Promise<void>((done) => child.once("exit", () => done()));
  if (child.pid === undefined) throw new Error(`sandbox.ts: could not start ${command}`);
  return {
    pid: child.pid,
    async stop() {
      child.kill();
      await exited;
    },
  };
}

export interface RunOptions {
  readonly input?: string;
  readonly env?: Record<string, string>;
  // Milliseconds before the command is killed (status null). 100 s by default.
  readonly timeout?: number;
}

export interface RunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

// <command> <args> in <dir>, only if <dir> is in the sandbox. For the process tests of an entry point.
export function runIn(
  dir: string,
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): RunResult {
  const root = activeSandbox();
  if (!inside(root, dir))
    throw new Error(`sandbox.ts: refusing to run in ${dir}, outside the sandbox ${root}`);
  const result = spawnSync(command, args, {
    cwd: dir,
    env: environment(root, options.env),
    encoding: "utf8",
    input: options.input ?? "",
    // A command that hangs (a test that starts itself again, say) is killed instead of hanging the run.
    timeout: options.timeout ?? 100_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// mise finds its config, installed tools and state under HOME, unless MISE_*_DIR or XDG_* say otherwise
// (https://mise.jdx.dev/directories.html). runIn moves HOME into the sandbox, so a tool test passes these
// to runIn: `mise exec` then uses the tools that `mise install --locked` installed, instead of installing
// them all again into the sandbox. The global config (MISE_CONFIG_DIR) stays in the sandbox, unread.
export function miseDirs(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): Record<string, string> {
  const dir = (own: string, xdg: string, fallback: string): string =>
    env[own] ?? join(env[xdg] ?? join(home, fallback), "mise");
  return {
    MISE_DATA_DIR: dir("MISE_DATA_DIR", "XDG_DATA_HOME", ".local/share"),
    MISE_CACHE_DIR: dir("MISE_CACHE_DIR", "XDG_CACHE_HOME", ".cache"),
    MISE_STATE_DIR: dir("MISE_STATE_DIR", "XDG_STATE_HOME", ".local/state"),
  };
}
