import { describe, expect, it } from "vite-plus/test";
import { refusesForcePush } from "./force-push.ts";

describe("refusesForcePush", () => {
  it.each([
    "git push --force",
    "git push -f origin main",
    "git push --force-with-lease origin HEAD",
    "git push --force-with-lease=main:abc origin main",
    "git push --force-if-includes origin main",
    "git push origin +main",
    "git -C repo push -uf origin x",
    "git push -fu origin x",
    "git -c a=b push --force",
    "pnpm test && git push --force",
    "git push -f\n",
  ])("refuses a rewriting push: %j", (command) => {
    expect(refusesForcePush(command)).toBe(true);
  });

  it.each([
    "git push",
    "git push -u origin feature",
    "git push origin --delete old",
    "git status && echo --force",
    "git log --format=%f",
    "git push origin main-f",
    "git pushx -f",
    "git fetch -f; git push",
    // git's subcommands are lower case.
    "git PUSH --force",
  ])("allows an ordinary push or another command: %j", (command) => {
    expect(refusesForcePush(command)).toBe(false);
  });

  // Every shape a command can take: wrapped, a string given to a shell, a subshell, a heredoc a shell reads.
  it.each([
    'bash -c "git push --force"',
    "sh -c 'git push -f origin x'",
    'eval "git push --force"',
    "FOO=1 git push -f",
    "FOO=1 BAR=2 git push -f",
    "(git push -f)",
    "{ git push -f; }",
    "echo $(git push -f)",
    "echo `git push -f`",
    "sudo git push -f",
    "env git push --force",
    "echo x | xargs git push -f",
    "time git push -f",
    "nohup git push -f",
    "exec git push -f",
    "command git push -f",
    "if true; then git push -f; fi",
    "if false; then :; else git push -f; fi",
    "for i in 1; do git push -f; done",
    "bash <<EOF\ngit push --force\nEOF",
    "cat <<EOF | sh\ngit push -f\nEOF",
    "cat <<EOF > f; git push -f\nbody\nEOF",
    'echo "<<X"\ngit push --force\nX',
    "echo '<<X'\ngit push --force\nX",
    "cat <<< x\ngit push --force",
    "cat <<EOF\ngit push --force",
    "cat <<EOF > f\nbody\nEOF\ngit push -f",
  ])("refuses a push in command position: %j", (command) => {
    expect(refusesForcePush(command)).toBe(true);
  });

  // Text that only mentions a force push.
  it.each([
    'git commit -m "docs: block git push --force"',
    'gh pr create --body "git push --force is refused"',
    'echo "git push -f"',
    "cat > f <<'EOF'\ngit push --force\nEOF",
    'cat > f <<"EOF"\ngit push --force\nEOF',
    "cat <<-EOF > f\n\tgit push -f\n\tEOF",
    "cat > a <<A\ngit push -f\nA\ncat > b <<B\ngit push -f\nB",
  ])("allows text that only mentions it: %j", (command) => {
    expect(refusesForcePush(command)).toBe(false);
  });
});
