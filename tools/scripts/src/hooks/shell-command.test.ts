import { describe, expect, it } from "vite-plus/test";
import { commandLines } from "./shell-command.ts";

describe("commandLines", () => {
  it("heredoc のないコマンドのすべての行を残すこと", () => {
    expect(commandLines("a\nb; c")).toEqual(["a", "b; c"]);
  });

  it("heredoc の本体と閉じの行を捨て、始まりの行を残すこと", () => {
    expect(commandLines("cat > f <<EOF\nbody\nEOF\nnext")).toEqual(["cat > f <<EOF", "next"]);
  });

  it.each([
    ["a quoted delimiter", "cat > f <<'EOF'\nbody\nEOF"],
    ["a double-quoted delimiter", 'cat > f <<"EOF"\nbody\nEOF'],
    ["a space before the delimiter", "cat > f << EOF\nbody\nEOF"],
    ["a redirection first on the line", "<<EOF cat > f\nbody\nEOF"],
  ])("%s を読むこと", (_, command) => {
    expect(commandLines(command)).toEqual([command.split("\n")[0]]);
  });

  it("タブでインデントした行で <<- の heredoc を閉じること", () => {
    expect(commandLines("cat <<-EOF > f\n\t\tbody\n\t\tEOF\nnext")).toEqual([
      "cat <<-EOF > f",
      "next",
    ]);
  });

  it("区切りの後に続きのある行では、heredoc を閉じないこと", () => {
    expect(commandLines("cat > f <<EOF\nEOF\t\nbody\nEOF\nnext")).toEqual([
      "cat > f <<EOF",
      "next",
    ]);
  });

  it("連続する 2 つの heredoc の本体を捨てること", () => {
    expect(commandLines("cat > a <<A\nx\nA\ncat > b <<B\ny\nB")).toEqual([
      "cat > a <<A",
      "cat > b <<B",
    ]);
  });

  it("閉じない heredoc の後の行を残すこと", () => {
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
  ])("heredoc の印 %s の後の行を残すこと", (_, command) => {
    expect(commandLines(command)).toEqual(command.split("\n"));
  });

  it("印の前の引用符の組の後の本体を捨てること", () => {
    expect(commandLines("echo 'a' \"b\" > f <<EOF\nbody\nEOF")).toEqual([
      "echo 'a' \"b\" > f <<EOF",
    ]);
  });
});
