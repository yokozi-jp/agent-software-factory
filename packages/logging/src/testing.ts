// テスト用の道具 (docs/adr/0049)。本番の入口 (index.ts、node.ts) には置かず、テストだけが `./testing` から import する。

/**
 * テスト用のメモリ上の出力先。`write` された JSON Lines を `lines()` が 1 行ずつ object にして返す。
 * 本番のコードは使わない (出力先は入口が `stdoutDestination()` で作る)。
 */
export function memoryDestination() {
  const chunks: string[] = [];
  return {
    write: (chunk: string): void => {
      chunks.push(chunk);
    },
    chunks,
    lines: (): Record<string, unknown>[] =>
      chunks.flatMap((chunk) => chunk.split("\n").filter(Boolean)).map(parseLine),
  };
}

function parseLine(line: string): Record<string, unknown> {
  const value: unknown = JSON.parse(line);
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("a log line is not a JSON object");
  return Object.fromEntries(Object.entries(value));
}
