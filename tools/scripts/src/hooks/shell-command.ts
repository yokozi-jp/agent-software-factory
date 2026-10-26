// Where a word in a shell command string runs as a command, for the hooks that refuse a command
// (force-push.ts, iwe-normalize.ts). Text that only mentions the command is not looked at: a commit
// message or PR body (`git commit -m "... git push --force"`), an `echo` argument, and the body of a
// heredoc whose command is not a shell (`cat > f <<EOF`). A heredoc fed to a shell (`bash <<EOF`,
// `... <<EOF | sh`) is still looked at.
// Not seen: a line break inside a quoted string reads as the start of a command, so a multi-line message
// whose line starts with the command is refused. Scripts that run the command (`sh x.sh`) and aliases.

// Where a command may start: the start of a segment (after ; & | or a newline), `(`, `{`, `$(` or a
// backtick, after a wrapper word (env, sudo, command, time, nohup, exec, xargs, eval, do, then, else), or
// as the string given to a shell (`sh -c "..."`). The wrapper word may be followed by an opening quote or
// parenthesis.
const wrappers = "env|sudo|command|time|nohup|exec|xargs|eval|do|then|else|-[A-Za-z]*c";
const position = (extra: readonly string[]): string =>
  String.raw`(^|[(\`{]|(^|\s)(${[wrappers, ...extra].join("|")})\s+["'(]?)\s*`;
// Environment assignments before the command (FOO=1 git push).
const assignments = String.raw`([A-Za-z_][A-Za-z0-9_]*=\S*\s+)*`;

// A line that starts a heredoc: `<<` or `<<-`, then the delimiter word (group 2), quoted or not. `<<<` is
// not one.
const heredocStart = /(^|[^<])<<-?[ \t]*["']?([A-Za-z_][A-Za-z0-9_]*)/;
// A heredoc read by a shell: its body is commands.
const shellReader = /(^|[ \t;&|(])(sh|bash|zsh|dash|ksh|eval|source|\.)([ \t]|$)/;

// Whether <text> holds an odd number of <char>, so that what follows is inside quotes.
const odd = (text: string, char: string): boolean => text.split(char).length % 2 === 0;

// The lines of <command> without the body of each heredoc whose command is not a shell. The line that
// starts the heredoc is kept, so a command after it on the same line (`cat <<EOF > f; git push -f`) is
// still looked at. The body is dropped only when the delimiter is outside quotes (an even number of each
// quote before it) and the closing line exists, so `echo "<<X"` or `cat <<< x` cannot hide the lines
// after them.
export function commandLines(command: string): string[] {
  const kept: string[] = [];
  let delimiter: string | undefined;
  let body: string[] = [];
  for (const line of command.split("\n")) {
    if (delimiter !== undefined) {
      body.push(line);
      // <<- strips leading tabs from the closing line; a plain << closing line has none to strip.
      if (line.replace(/^\t+/, "") === delimiter) {
        delimiter = undefined;
        body = [];
      }
      continue;
    }
    kept.push(line);
    const match = heredocStart.exec(line);
    if (match === null) continue;
    const before = line.slice(0, match.index + 1);
    if (odd(before, "'") || odd(before, '"') || shellReader.test(line)) continue;
    delimiter = match[2];
  }
  // No closing line: the body was not a heredoc body after all.
  return [...kept, ...body];
}

// The segments of <command> (split at ; & | and line breaks) in which <pattern> is in command position.
// <wrappers> are more words after which a command starts (package runners such as npx).
export function inCommandPosition(
  command: string,
  pattern: string,
  wrappers: readonly string[],
  flags: "" | "i",
): string[] {
  const found = new RegExp(`${position(wrappers)}${assignments}${pattern}`, flags);
  return commandLines(command)
    .flatMap((line) => line.split(/[;&|]/))
    .filter((segment) => found.test(segment));
}
