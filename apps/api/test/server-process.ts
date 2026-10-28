import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const serverEntry = fileURLToPath(new URL("../src/server.ts", import.meta.url));

/** OS が選んだ空いているポート。閉じてから返すので、ほかのプロセスが先に取ることはまれにある。 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export interface ServerProcess {
  /** このプロセスの API に要求する。path は `/api/...` の形。 */
  request(path: string, init?: RequestInit): Promise<Response>;
  stop(): Promise<void>;
}

/**
 * 本番の入口 (src/server.ts) を別のプロセスで起動する。プロセスの中の状態 (Better Auth のメモリの
 * rate limit など) を共有しない、もう 1 つの API のインスタンスとして使う。
 * 環境変数は env だけを渡し、テストの環境変数 (NODE_ENV=test など) を引き継がない。
 */
export async function startServerProcess(env: Record<string, string>): Promise<ServerProcess> {
  // src/env.ts は PORT に 1 以上を求めるので、OS に空いているポートを選ばせてから渡す。
  const port = await freePort();
  const child = spawn(process.execPath, [serverEntry], {
    env: { PATH: process.env.PATH ?? "", PORT: String(port), ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));

  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const origin = await new Promise<string>((resolve, reject) => {
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      const port = /listening on http:\/\/localhost:(\d+)/.exec(stdout)?.[1];
      if (port !== undefined) resolve(`http://127.0.0.1:${port}`);
    });
    child.once("exit", (code) =>
      reject(new Error(`API が起動しなかった (exit ${code}): ${stderr}`)),
    );
  });

  return {
    request: (path, init) => fetch(new URL(path, origin), { ...init, redirect: "manual" }),
    async stop() {
      child.kill();
      await exited;
    },
  };
}
