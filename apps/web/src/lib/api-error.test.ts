import { isNotFound } from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";

import { throwOnForbiddenOrNotFound } from "./api-error.ts";
import { ForbiddenError } from "./forbidden.ts";

function thrownBy(status: number): unknown {
  try {
    throwOnForbiddenOrNotFound(new Response(null, { status }));
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("API の 403 と 404 を画面の失敗に変える (throwOnForbiddenOrNotFound)", () => {
  it("403 は ForbiddenError を投げる", () => {
    expect(thrownBy(403)).toBeInstanceOf(ForbiddenError);
  });

  it("404 は notFound() を投げる", () => {
    expect(isNotFound(thrownBy(404))).toBe(true);
  });

  it.each([200, 401, 500])("%i は投げずに、応答をそのまま返す", (status) => {
    const response = new Response(null, { status });
    expect(throwOnForbiddenOrNotFound(response)).toBe(response);
  });
});
