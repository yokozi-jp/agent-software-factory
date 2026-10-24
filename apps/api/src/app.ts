import { Hono } from "hono";

export const app = new Hono().get("/health", (c) => c.json({ status: "ok" }));

// The type a Hono RPC client (`hc<AppType>`) reads the routes from. No client uses it yet.
/** @public */
export type AppType = typeof app;
