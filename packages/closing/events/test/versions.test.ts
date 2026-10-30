import { eventFixtureProblems } from "@agent-software-factory/shared";
import { expect, it } from "vite-plus/test";
import { closingEvents } from "../src/index.ts";

// The messages of every version this package has written: the current schemas must still read them all, and the
// current version of each event must have one (docs/async/event-contract.md).
const fixtures = import.meta.glob("./fixtures/*.json", { eager: true, import: "default" });

it("過去の版のメッセージを、今のスキーマがすべて読める", () => {
  expect(eventFixtureProblems(closingEvents, fixtures)).toEqual([]);
});
