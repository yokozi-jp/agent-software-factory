// API の書き込み (POST と PATCH) の mutation を包む共通の hook (docs/adr/0040、Issue #324)。
// API はすべての POST と PATCH に `Idempotency-Key` を必須にする。呼び忘れは Hono の側から見えないので、
// mutation は useMutation を直接使わず、この hook を通す。
//
// - キーは利用者の 1 回の操作 (`mutate` の呼び出し 1 回) ごとに `crypto.randomUUID()` で採る。`mutationFn` の外で
//   採って変数に入れるので、TanStack Query が再試行で `mutationFn` を呼び直しても同じ値を送る。
// - 値は Structured Field の String (RFC 9651) で、UUID を引用符で囲む (`"<UUID>"`)。
// - `crypto.randomUUID()` は secure context (HTTPS と `http://localhost`) でしか使えない。それ以外の HTTP では動かない。
import {
  useMutation,
  type UseMutationOptions,
  type UseMutationResult,
} from "@tanstack/react-query";

/** apps/api の `IDEMPOTENCY_KEY_HEADER` と同じ値 (apps/web は shared-kernel を import しない)。 */
export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

/** `hc` の第 2 引数の `headers` にそのまま渡せる、冪等キーの header。 */
export type IdempotencyHeaders = { readonly [IDEMPOTENCY_KEY_HEADER]: string };

// `onMutate`、`onSuccess`、`onError`、`onSettled` は受け取らない。TanStack Query はこれらに useMutation の変数を渡すが、
// ここでの変数は操作 (変数とキー) なので、呼び出し側が受け取る値と食い違う。結果は `mutateAsync` の戻り値か、
// `data`、`error`、`isSuccess` などの状態で読む。
type Options<TData, TVariables, TError, TContext> = Omit<
  UseMutationOptions<TData, TError, TVariables, TContext>,
  "mutationFn" | "onMutate" | "onSuccess" | "onError" | "onSettled"
> & {
  /** `headers` を API の呼び出しに付ける。再試行のあいだ、同じ操作の `headers` は同じ値。 */
  readonly mutationFn: (variables: TVariables, headers: IdempotencyHeaders) => Promise<TData>;
};

/** `useMutation` の結果。`mutate` と `mutateAsync` は、呼ぶたびに新しいキーを採る。 */
export type IdempotentMutation<TData, TVariables, TError = Error, TContext = unknown> = Omit<
  UseMutationResult<TData, TError, TVariables, TContext>,
  "mutate" | "mutateAsync" | "variables"
> & {
  readonly mutate: (variables: TVariables) => void;
  readonly mutateAsync: (variables: TVariables) => Promise<TData>;
  readonly variables: TVariables | undefined;
};

interface Operation<TVariables> {
  readonly variables: TVariables;
  readonly headers: IdempotencyHeaders;
}

const newOperation = <TVariables>(variables: TVariables): Operation<TVariables> => ({
  variables,
  headers: { [IDEMPOTENCY_KEY_HEADER]: `"${crypto.randomUUID()}"` },
});

export function useIdempotentMutation<TData, TVariables, TError = Error, TContext = unknown>(
  options: Options<TData, TVariables, TError, TContext>,
): IdempotentMutation<TData, TVariables, TError, TContext> {
  const { mutationFn, ...rest } = options;
  // useMutation には、操作 (変数とキー) を 1 つの変数として渡す。再試行は同じ変数で mutationFn を呼び直す。
  const mutation = useMutation<TData, TError, Operation<TVariables>, TContext>({
    ...rest,
    mutationFn: (operation) => mutationFn(operation.variables, operation.headers),
  });
  return {
    ...mutation,
    mutate: (variables) => {
      mutation.mutate(newOperation(variables));
    },
    mutateAsync: (variables) => mutation.mutateAsync(newOperation(variables)),
    variables: mutation.variables?.variables,
  };
}
