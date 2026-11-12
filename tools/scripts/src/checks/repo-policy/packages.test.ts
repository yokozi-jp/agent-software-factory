// The packages under packages/ (./packages.ts), called on a small repository held in memory.
import { describe, expect, it } from "vite-plus/test";
import { repo } from "./fixtures/repo.ts";
import { manifest, packageNames } from "./packages.ts";
import { Tree } from "./tree.ts";

describe("ADR 0026: the packages under packages/", () => {
  it("names the package.json of a package by its directory", () => {
    expect(manifest("claim")).toBe("packages/claim/package.json");
  });

  it("takes the names from packages/<name>/package.json only, and by that exact name", () => {
    const stray = {
      "packages/other/events/package.json": "{}",
      "vendor/packages/stray/package.json": "{}",
      "packages/stray/package.json.bak": "{}",
      "packages/stray/nested/package.json": "{}",
      "packages/new/package.json": "{}",
    };
    const names = packageNames(new Tree(repo(stray)));
    expect(names).toContain("new");
    expect(names).not.toContain("other");
    expect(names).not.toContain("stray");
    expect(names).toEqual(expect.arrayContaining(["claim", "approval", "closing"]));
    expect(packageNames(new Tree(repo())).sort()).toEqual(
      names.filter((name) => name !== "new").sort(),
    );
  });
});
