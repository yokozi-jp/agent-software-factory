#!/usr/bin/env sh
# Kiro PreToolUse hook: refuse `git push` with --force, --force-with-lease, -f or a `+refspec`.
# A force push rewrites a shared branch; the user runs it themselves after reviewing the history.
# Contract: hook event JSON on stdin; exit 2 refuses (stderr goes back to the agent), exit 0 allows.
# Fail-open: anything that cannot be parsed is allowed. Override with KIRO_ALLOW_FORCE_PUSH=1.
#
# What is looked at: a `git push` that is in command position, that is, at the start of a command (after
# ; & | a newline, `(`, `{`, `$(` or a backtick), after environment assignments (FOO=1), after a wrapper word
# (env, sudo, command, time, nohup, exec, xargs, eval, do, then, else), or as the string given to a shell
# (`sh -c "..."`). Words that only mention it are not looked at: a commit message or PR body (`git commit -m "...
# git push --force"`), an `echo`, and the body of a heredoc whose command is not a shell (`cat > f <<EOF`).
# A heredoc fed to a shell (`bash <<EOF`, `... <<EOF | sh`) is still looked at.
# Not looked at: a line break inside a quoted string is read as the start of a command, so a multi-line
# message whose line starts with `git push --force` is refused. Scripts that run the push (`sh x.sh`)
# and aliases are not seen.
# Without jq the whole event JSON is searched for `git push` anywhere, with no command position.
set -u

[ "${KIRO_ALLOW_FORCE_PUSH:-}" = "1" ] && exit 0

payload="$(cat 2>/dev/null || true)"
[ -n "$payload" ] || exit 0

command_str=""
if command -v jq >/dev/null 2>&1; then
  command_str="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
fi

# `git [-opt [arg]]... push`, then a `--force` form, `-f` (also inside a bundle such as -uf) or `+refspec`.
git_push='git([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*[[:space:]]+push([[:space:]]|$)'
force_flag='[[:space:]](--force(-with-lease|-if-includes)?(=[^[:space:]]*)?|-[[:alnum:]]*f[[:alnum:]]*|\+[^[:space:]]+)([[:space:]]|[)"'"'"'`}]|$)'
# Where `git` may start a command. The wrapper words may be followed by an opening quote or parenthesis.
wrapper='(env|sudo|command|time|nohup|exec|xargs|eval|do|then|else|-[[:alpha:]]*c)'
position="(^|[(\`{]|(^|[[:space:]])${wrapper}[[:space:]]+[\"'(]?)[[:space:]]*"
assignments='([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*'

# Drop the body of each heredoc whose command is not a shell. The line that starts the heredoc is kept, so a
# command after it on the same line (`cat <<EOF > f; git push -f`) is still looked at. The body is dropped only
# when the delimiter is not inside quotes (an even number of quotes before it) and the closing line exists, so
# `echo "<<X"` or `cat <<< x` cannot hide the lines after them. POSIX awk only.
strip_heredocs() {
  awk -v q="'" '
    stop != "" {
      buf = buf $0 "\n"
      line = $0
      sub(/^\t+/, "", line)
      if (line == stop) { stop = ""; buf = "" }
      next
    }
    {
      print
      pattern = "(^|[^<])<<-?[ \t]*[\"" q "]?[A-Za-z_][A-Za-z0-9_]*[\"" q "]?"
      if (!match($0, pattern)) next
      before = substr($0, 1, RSTART)
      if (gsub(q, "", before) % 2 == 1) next
      before = substr($0, 1, RSTART)
      if (gsub(/"/, "", before) % 2 == 1) next
      if ($0 ~ /(^|[ \t;&|(])(sh|bash|zsh|dash|ksh|eval|source|\.)([ \t]|$)/) next
      word = substr($0, RSTART, RLENGTH)
      sub(/^[^<]?<<-?[ \t]*/, "", word)
      gsub("[\"" q "]", "", word)
      stop = word
      buf = ""
    }
    END { if (stop != "") printf "%s", buf }
  '
}

if [ -n "$command_str" ]; then
  # tr maps each separator character (; & | newline) to a newline, so the repeated \n in the second set is intended.
  # shellcheck disable=SC2020
  segments="$(printf '%s\n' "$command_str" | strip_heredocs | tr ';&|\n' '\n\n\n\n')"
  pushes="$(printf '%s\n' "$segments" | grep -E "${position}${assignments}${git_push}" || true)"
else
  # shellcheck disable=SC2020
  segments="$(printf '%s' "$payload" | tr ';&|\n' '\n\n\n\n')"
  pushes="$(printf '%s\n' "$segments" | grep -E "(^|[[:space:]])${git_push}" || true)"
fi

if [ -n "$pushes" ] && printf '%s\n' "$pushes" | grep -Eq "$force_flag"; then
  echo "block-force-push: refused. Force push rewrites the remote branch. Ask the user to run it, or merge without rewriting history (PRs are squash merged, docs/adr/0004)." >&2
  exit 2
fi

exit 0
