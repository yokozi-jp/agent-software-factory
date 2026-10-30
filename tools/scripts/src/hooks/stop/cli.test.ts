// Process tests for the Stop entry point: the event JSON on stdin and a real git repository in the
// sandbox, to stderr (the reason the agent continues with) and exit 1, or exit 0. What the warning says
// is in ../unfinished-work.test.ts.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { gitIn, runIn, sandbox, type Sandbox } from "../../test/sandbox.ts";

const cli = join(import.meta.dirname, "cli.ts");
const processTimeout = 30_000;

let box: Sandbox;
let clone: string;

const stop = (sessionId: string) =>
  runIn(clone, process.execPath, [cli], {
    input: JSON.stringify({ session_id: sessionId, hook_event_name: "Stop", cwd: clone }),
    env: {},
  });

beforeAll(() => {
  box = sandbox();
  const origin = join(box.root, "origin.git");
  const seed = join(box.root, "seed");
  clone = join(box.root, "clone");
  gitIn(origin, ["init", "-q", "--bare", "-b", "main"]);
  gitIn(seed, ["clone", "-q", origin, "."]);
  gitIn(seed, ["checkout", "-q", "-b", "main"]);
  gitIn(seed, ["commit", "-q", "--allow-empty", "-m", "one"]);
  gitIn(seed, ["push", "-q", "origin", "main"]);
  gitIn(clone, ["clone", "-q", origin, "."]);
});
afterAll(() => {
  box.remove();
});

describe("stop", { timeout: processTimeout }, () => {
  it("exits 0 and says nothing when the tree is clean and pushed", () => {
    expect(stop("s1")).toEqual({ status: 0, stdout: "", stderr: "" });
  });

  it("sends the agent back once for a state, and lets it stop the second time", () => {
    writeFileSync(join(clone, "a.txt"), "a\n");
    const first = stop("s2");
    expect(first.status).toBe(1);
    expect(first.stderr).toContain("?? a.txt");
    expect(stop("s2")).toEqual({ status: 0, stdout: "", stderr: "" });
  });

  it("reports the same state again to another session, and a changed state again to the same one", () => {
    expect(stop("s3").status).toBe(1);
    writeFileSync(join(clone, "b.txt"), "b\n");
    expect(stop("s3").status).toBe(1);
  });
});
