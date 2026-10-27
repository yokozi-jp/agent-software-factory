// The result of a business rule that can fail in a way the caller tells apart (docs/adr/0027, docs/domain-model/failures.md).
// domain returns it, and imports only this type from shared. Values are object literals: there is no ok() or err().
export type Result<T, E> =
  | { readonly _tag: "Ok"; readonly value: T }
  | { readonly _tag: "Err"; readonly error: E };
