// Narrowing for JSON that a tool printed or a file holds (JSON.parse returns any; the typed lint rules of
// docs/adr/0020 forbid using it unchecked).

export type JsonObject = Record<string, unknown>;

// A JSON object: not null, not an array, not a primitive.
export const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// The objects in a JSON array; nothing when the value is not an array.
export const objects = (value: unknown): JsonObject[] =>
  Array.isArray(value) ? value.filter(isObject) : [];
