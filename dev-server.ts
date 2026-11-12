// What apps/web and apps/api read from their environment to start the dev server (Issue #184,
// docs/tooling/worktrees.md ("開発サーバーを動かす")). A worktree gets its own ports in the .env.local files of
// apps/web and apps/api, written by tools/scripts/src/dev-ports. Each setting is its own variable, and another app is
// reached by its URL (twelve-factor: III. Config, VII. Port binding). The defaults are the ports of the main checkout,
// and src/configs/dev-ports.tools.test.ts keeps them equal to slot 0 of tools/scripts/src/dev-ports/rules.ts.

type Env = Readonly<Record<string, string | undefined>>;

// A set value that is not valid is an error, not the default: an empty or mistyped value would otherwise start
// the server on a port nobody asked for. The message names the variable and never prints the value.
export function port(env: Env, name: string, fallback: number): number {
  const value = env[name];
  if (value === undefined) return fallback;
  const number = /^\d+$/.test(value) ? Number(value) : 0;
  if (number < 1 || number > 65535)
    throw new Error(`${name} は 1〜65535 の整数にする (apps/*/.env.local か環境変数)`);
  return number;
}

export function origin(env: Env, name: string, fallback: string): string {
  const value = env[name];
  if (value === undefined) return fallback;
  try {
    const url = new URL(value);
    // `new URL("localhost:3000")` reads "localhost:" as a scheme, so the protocol is checked too.
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin === value)
      return value;
  } catch {
    // The error below says what is wrong.
  }
  throw new Error(`${name} は http か https の origin (パスなし) にする: http://localhost:3000`);
}

// `server` of apps/web/vite.config.ts. strictPort fails the start when the port is taken, instead of Vite's
// default of trying the next port, which can be another session's server (https://vite.dev/config/server-options).
export function devServer(env: Env) {
  return {
    port: port(env, "WEB_PORT", 5173),
    strictPort: true,
    // The browser sees one origin: the dev server forwards /api to the API (docs/web-api/security.md ("CORS")).
    proxy: { "/api": origin(env, "API_ORIGIN", "http://localhost:3000") },
  };
}
