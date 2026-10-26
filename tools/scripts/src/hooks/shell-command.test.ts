import { describe, expect, it } from "vite-plus/test";
import { commandLines } from "./shell-command.ts";

describe("commandLines", () => {
  it("keeps every line of a command without a heredoc", () => {
    expect(commandLines("a\nb; c")).toEqual(["a", "b; c"]);
  });

  it("drops the body and the closing line of a heredoc, and keeps the line that starts it", () => {
    expect(commandLines("cat > f <<EOF\nbody\nEOF\nnext")).toEqual(["cat > f <<EOF", "next"]);
  });

  it.each([
    ["a quoted delimiter", "cat > f <<'EOF'\nbody\nEOF"],
    ["a double-quoted delimiter", 'cat > f <<"EOF"\nbody\nEOF'],
    ["a space before the delimiter", "cat > f << EOF\nbody\nEOF"],
    ["a redirection first on the line", "<<EOF cat > f\nbody\nEOF"],
  ])("reads %s", (_, command) => {
    expect(commandLines(command)).toEqual([command.split("\n")[0]]);
  });

  it("closes a <<- heredoc at a line indented with tabs", () => {
    expect(commandLines("cat <<-EOF > f\n\t\tbody\n\t\tEOF\nnext")).toEqual([
      "cat <<-EOF > f",
      "next",
    ]);
  });

  it("does not close a heredoc at a line with more after the delimiter", () => {
    expect(commandLines("cat > f <<EOF\nEOF\t\nbody\nEOF\nnext")).toEqual([
      "cat > f <<EOF",
      "next",
    ]);
  });

  it("drops the bodies of two heredocs in a row", () => {
    expect(commandLines("cat > a <<A\nx\nA\ncat > b <<B\ny\nB")).toEqual([
      "cat > a <<A",
      "cat > b <<B",
    ]);
  });

  it("keeps the lines after a heredoc that never closes", () => {
    expect(commandLines("cat > a <<A\nx\nA\ncat <<B\ny\nz")).toEqual([
      "cat > a <<A",
      "cat <<B",
      "y",
      "z",
    ]);
  });

  it.each([
    ["inside double quotes", 'echo "<<X"\nbody\nX'],
    ["inside single quotes", "echo '<<X'\nbody\nX"],
    ["a here-string", "cat <<< x\nbody"],
    ["read by a shell", "bash <<EOF\nbody\nEOF"],
    ["piped to a shell", "cat <<EOF | sh\nbody\nEOF"],
  ])("keeps the lines after a heredoc marker %s", (_, command) => {
    expect(commandLines(command)).toEqual(command.split("\n"));
  });

  it("drops the body after a pair of quotes before the marker", () => {
    expect(commandLines("echo 'a' \"b\" > f <<EOF\nbody\nEOF")).toEqual([
      "echo 'a' \"b\" > f <<EOF",
    ]);
  });
});
