/**
 * globalSetup の失敗を stderr に書いてから投げ直す。
 *
 * vitest 5.0.5 (Vite+ 1.4.0) は globalSetup が投げた失敗を表示できない。失敗の stack を読むと、source map で
 * 位置を直す処理が "TypeError: code.charCodeAt is not a function" を投げ、"No test files found" と一緒にそれだけが
 * 出て、元の失敗が消える。そこで、stack を読まずに String(error) (名前と message) を stderr に書いてから投げ直す。
 * コンテナの起動の待ちの時間切れ (別のセッションのテストでマシンが重いとき) などが、このメッセージで分かる。
 * `file` は globalSetup のファイルの名前で、メッセージに載せる。
 */
export async function reportSetupFailure<T>(file: string, start: () => Promise<T>): Promise<T> {
  try {
    return await start();
  } catch (error) {
    process.stderr.write(`globalSetup (${file}) が失敗した: ${String(error)}\n`);
    throw error;
  }
}
