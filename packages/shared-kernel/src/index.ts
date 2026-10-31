// The entry `.` of shared-kernel (docs/adr/0051): the contract that imports no library but zod. The rest is in the entries
// of package.json `exports`, one per feature. shared-kernel imports no module (docs/adr/0026).
export { defineEvent, eventFixtureProblems, type EventDefinition } from "./event.ts";
