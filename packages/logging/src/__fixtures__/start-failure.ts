// src/start-or-fail.test.ts が子プロセスで実行する小さな入口。起動が失敗する入口を、実際の標準出力と終了コードで確かめる。
import { createNodeLogger, startOrFail, stdoutDestination } from "../node.ts";

const logger = createNodeLogger({
  destination: stdoutDestination(),
  level: "info",
  service: { name: "api", version: "0.0.0", environment: "test" },
});

await startOrFail(logger, () => {
  throw new Error("環境変数が正しくない:\nPORT: Invalid input");
});
