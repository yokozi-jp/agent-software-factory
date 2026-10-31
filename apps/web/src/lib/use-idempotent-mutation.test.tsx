import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vite-plus/test";

import {
  IDEMPOTENCY_KEY_HEADER,
  useIdempotentMutation,
  type IdempotencyHeaders,
  type IdempotentMutation,
} from "./use-idempotent-mutation.ts";

// 冪等キーの hook (docs/adr/0040)。キーは利用者の 1 回の操作ごとに採り、TanStack Query が再試行で mutationFn を
// 呼び直しても同じ値を送る。別の操作は別のキーを送る。
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const uuid = /^"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"$/;

function renderMutation(
  mutationFn: (variables: string, headers: IdempotencyHeaders) => Promise<string>,
  retry: number,
) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retryDelay: 0 } } });
  const container = document.createElement("div");
  const root = createRoot(container);
  const latest: { current?: IdempotentMutation<string, string> } = {};
  function Probe() {
    const mutation = useIdempotentMutation<string, string>({ mutationFn, retry });
    useEffect(() => {
      latest.current = mutation;
    });
    return null;
  }
  const wrapper = (children: ReactNode) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  act(() => {
    root.render(wrapper(<Probe />));
  });
  return {
    mutate: async (variables: string) => {
      await act(async () => {
        latest.current?.mutate(variables);
        // 再試行の待ちも含めて、操作が終わるまで待つ。
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    },
    mutateAsync: async (variables: string) => {
      let result: string | undefined;
      await act(async () => {
        result = await latest.current?.mutateAsync(variables);
      });
      return result;
    },
    unmount: () => {
      act(() => root.unmount());
    },
  };
}

describe("冪等キーの hook (useIdempotentMutation)", () => {
  it("Structured Field の String (引用符付きの UUID) を Idempotency-Key の header として渡すこと", async () => {
    const sent: IdempotencyHeaders[] = [];
    const view = renderMutation((_variables, headers) => {
      sent.push(headers);
      return Promise.resolve("ok");
    }, 0);

    await view.mutate("a");

    expect(Object.keys(sent[0] ?? {})).toEqual([IDEMPOTENCY_KEY_HEADER]);
    expect(sent[0]?.[IDEMPOTENCY_KEY_HEADER]).toMatch(uuid);
    view.unmount();
  });

  it("再試行のあいだ、同じ操作は同じキーを送ること", async () => {
    const sent: string[] = [];
    const view = renderMutation((_variables, headers) => {
      sent.push(headers[IDEMPOTENCY_KEY_HEADER]);
      return sent.length < 3 ? Promise.reject(new Error("network")) : Promise.resolve("ok");
    }, 2);

    await view.mutate("a");

    expect(sent).toHaveLength(3);
    expect(new Set(sent).size).toBe(1);
    view.unmount();
  });

  it("別の操作は別のキーを送ること", async () => {
    const sent: string[] = [];
    const view = renderMutation((_variables, headers) => {
      sent.push(headers[IDEMPOTENCY_KEY_HEADER]);
      return Promise.resolve("ok");
    }, 0);

    await view.mutate("a");
    await view.mutate("a");

    expect(sent).toHaveLength(2);
    expect(sent[0]).not.toBe(sent[1]);
    view.unmount();
  });

  it("mutateAsync も呼ぶたびに新しいキーを送り、応答を返すこと", async () => {
    const sent: string[] = [];
    const view = renderMutation((variables, headers) => {
      sent.push(headers[IDEMPOTENCY_KEY_HEADER]);
      return Promise.resolve(`done ${variables}`);
    }, 0);

    expect(await view.mutateAsync("a")).toBe("done a");
    expect(await view.mutateAsync("a")).toBe("done a");

    expect(new Set(sent).size).toBe(2);
    view.unmount();
  });
});
