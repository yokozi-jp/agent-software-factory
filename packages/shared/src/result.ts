// The result of a business rule that can fail in a way the caller tells apart (docs/domain-model/failures.md,
// docs/adr/0027). domain imports this type with `import type`, and builds a value as an object literal:
// `{ _tag: "Ok", value }` or `{ _tag: "Err", error: { _tag: "NoLines" } }`. There is no `ok()` or `err()`,
// because domain may import nothing from shared but types (docs/adr/0026). `E` is a union of failures, each with
// a `_tag`.
export type Result<T, E> =
  | { readonly _tag: "Ok"; readonly value: T }
  | { readonly _tag: "Err"; readonly error: E };
