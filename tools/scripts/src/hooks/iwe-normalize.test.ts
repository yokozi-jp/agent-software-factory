import { describe, expect, it } from "vite-plus/test";
import { refusesIweCommand, refusesIweTool } from "./iwe-normalize.ts";

describe("refusesIweCommand", () => {
  it.each([
    "iwe normalize",
    "cd docs && pnpm exec iwe normalize",
    "iwe -v 1 normalize --dry-run",
    "iwe --verbose normalize",
    "IWE NORMALIZE",
    "node_modules/.bin/iwe normalize",
    "npx iwe normalize",
    "pnpx iwe normalize",
    "bunx iwe normalize",
    "pnpm dlx iwe normalize",
    "mise exec -- iwe normalize",
    "pnpm iwe normalize",
    "cd docs && pnpm iwe normalize",
    "yarn iwe normalize",
    "mise x iwe normalize",
    "mise exec iwe normalize",
    "mise x -- iwe normalize",
    "RUST_LOG=debug iwe normalize",
    'sh -c "iwe normalize"',
    "(cd docs; iwe normalize)",
    "bash <<EOF\niwe normalize\nEOF",
  ])("refuses the normalize subcommand in command position: %j", (command) => {
    expect(refusesIweCommand(command)).toBe(true);
  });

  it.each([
    "pnpm exec iwe find normalize",
    "iwe stats",
    "iwe schema validate",
    "iwe normalized",
    "iwe normalize-x",
    "myiwe normalize",
    "iwec normalize",
    "pnpm iwe find normalize",
    "mise x iwe stats",
  ])("allows another subcommand or program: %j", (command) => {
    expect(refusesIweCommand(command)).toBe(false);
  });

  // The policy of force-push.ts: text that only mentions the command is not looked at.
  it.each([
    'git commit -m "docs: refuse iwe normalize"',
    'echo "iwe normalize"',
    "cat > notes.md <<'EOF'\niwe normalize\nEOF",
    'gh pr create --body "never run iwe normalize"',
    'git commit -m "fix: refuse pnpm iwe normalize"',
    "cat > notes.md <<'EOF'\nyarn iwe normalize\nmise x iwe normalize\nEOF",
  ])("allows text that only mentions it: %j", (command) => {
    expect(refusesIweCommand(command)).toBe(false);
  });
});

describe("refusesIweTool", () => {
  it.each([
    "@iwe/iwe_normalize",
    "iwe::iwe_normalize",
    "IWE_NORMALIZE",
    "iwe::normalize",
    "normalize_for_iwe",
  ])("refuses an iwe tool named for normalize: %j", (name) => {
    expect(refusesIweTool(name)).toBe(true);
  });

  it.each(["@iwe/iwe_find", "normalize", "iwe", "execute_bash"])("allows %j", (name) => {
    expect(refusesIweTool(name)).toBe(false);
  });
});
