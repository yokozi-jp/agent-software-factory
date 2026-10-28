// The tree being checked, and how its files are read (parsed once, a file that does not parse reported once).
import { parse as parseToml } from "smol-toml";
import { parseDocument } from "yaml";

// The tree being checked.
export interface Repo {
  // Every path in the index (`git ls-files -s`), with its mode: 100644, 100755, 120000 ...
  readonly tracked: ReadonlyMap<string, string>;
  // Steering files that are untracked and not ignored. Kiro loads them too.
  readonly untrackedSteering: readonly string[];
  // Whether the working tree has a .vite-hooks directory (`vp` creates it without staging it).
  readonly viteHooks: boolean;
  // The text of a file of the tree, or undefined when the tree has no such file.
  read(path: string): string | undefined;
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const record = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

// The first line of an error, without the colon that introduces the code excerpt (yaml, smol-toml).
const firstLine = (error: unknown): string =>
  String(error)
    .replace(/\n[^]*/, "")
    .replace(/:$/, "");

// The parser for a file, by its extension. Each returns the value, or throws with the reason the text is
// not valid.
function parser(path: string): [string, (text: string) => unknown] {
  if (path.endsWith(".json"))
    return [
      "JSON",
      (text) => {
        // A tsconfig.json may have comments. Only a comment that fills its line is removed.
        const value: unknown = JSON.parse(
          path.split("/").pop() === "tsconfig.json" ? text.replace(/^[ \t]*\/\/.*/gm, "") : text,
        );
        return value;
      },
    ];
  if (path.endsWith(".toml")) return ["TOML", (text) => parseToml(text)];
  return [
    "YAML",
    (text) => {
      const document = parseDocument(text);
      const [error] = document.errors;
      if (error !== undefined) throw error;
      const value: unknown = document.toJS();
      return value;
    },
  ];
}

// The repository with the parsed files. A file that does not parse is reported once and read as empty.
export class Tree {
  readonly repo: Repo;
  readonly paths: readonly string[];
  readonly parseErrors: string[] = [];
  readonly #parsed = new Map<string, unknown>();

  constructor(repo: Repo) {
    this.repo = repo;
    this.paths = [...repo.tracked.keys()].sort();
  }

  // A file the tree does not have reads as empty. No rule matches an empty text or any other text
  // without the pattern, so the fallback text is not tested.
  read(path: string): string {
    // Stryker disable next-line StringLiteral: equivalent, see above.
    return this.repo.read(path) ?? "";
  }

  // The tracked files with this name, at the root or at any depth.
  named(name: string): string[] {
    return this.paths.filter((path) => path === name || path.endsWith(`/${name}`));
  }

  // The parsed JSON, TOML or YAML file; undefined when the tree has no such file or it does not parse.
  parsed(path: string): unknown {
    if (this.#parsed.has(path)) return this.#parsed.get(path);
    const text = this.repo.read(path);
    const [format, parse] = parser(path);
    let value: unknown;
    try {
      value = text === undefined ? undefined : parse(text);
    } catch (error) {
      this.parseErrors.push(`${path} is not valid ${format} (${firstLine(error)})`);
    }
    this.#parsed.set(path, value);
    return value;
  }
}

// Whether `key` is a key of the value or of anything in it, at any depth.
export const hasKey = (value: unknown, key: string): boolean =>
  Array.isArray(value)
    ? value.some((child) => hasKey(child, key))
    : isRecord(value) && (key in value || Object.values(value).some((child) => hasKey(child, key)));

export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;
