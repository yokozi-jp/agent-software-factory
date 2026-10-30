import { z } from "zod";

/**
 * An event that crosses modules (docs/adr/0046). The sending module defines it in its events package and exports it
 * from `index.ts`; the receiving module parses the message with `schema` before it acts on it.
 *
 * Every event has the same items: an `id` (the key of `processed_message`), the `tenantId`, the `kind`, the
 * `version` and the moment it happened (`occurredAt`, RFC 3339 in UTC with three digits of fraction, as the Outbox
 * stores it). The `shape` adds the items of the kind.
 *
 * A change to a kind adds an optional item and raises its `version`. It never removes an item, renames one or
 * changes a type: an Outbox row written by the old code is read by the new code, so the new schema must accept every
 * past version. Unknown items are dropped, so an old receiver reads a message of a newer version. If a change
 * cannot be made by adding an item, add a new kind. `eventFixtureProblems` checks it against the messages of the
 * past versions (docs/async/event-contract.md).
 */
export const defineEvent = <const Kind extends string, Shape extends z.ZodRawShape>(
  kind: Kind,
  version: number,
  shape: Shape,
) => ({
  kind,
  version,
  schema: z.object({
    id: z.uuid(),
    tenantId: z.uuid(),
    kind: z.literal(kind),
    version: z.int().min(1),
    occurredAt: z.iso.datetime({ precision: 3 }),
    ...shape,
  }),
});

/** What `eventFixtureProblems` reads of an event: the kind, its current version and the schema of its messages. */
export interface EventDefinition {
  readonly kind: string;
  readonly version: number;
  readonly schema: z.ZodType;
}

const versionOf = z.object({ version: z.number() });
const fixtureName = /^(?<kind>.+)\.v(?<version>\d+)\.json$/;

/**
 * Checks the messages of the past versions of the events of a package. `fixtures` maps the path of each file of
 * `fixtures/` (`<kind>.v<version>.json`) to its parsed JSON. Every file must parse with the current schema of its
 * kind and say the version its name says, and every event must have a file for its current version. Returns the
 * problems; an empty list means the package still reads every message it ever wrote.
 */
export function eventFixtureProblems(
  events: readonly EventDefinition[],
  fixtures: Readonly<Record<string, unknown>>,
): string[] {
  const problems: string[] = [];
  const present = new Set<string>();
  for (const [path, message] of Object.entries(fixtures)) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const groups = fixtureName.exec(name)?.groups;
    if (groups === undefined) {
      problems.push(`${name}: the name must be <kind>.v<version>.json`);
      continue;
    }
    const event = events.find((candidate) => candidate.kind === groups["kind"]);
    if (event === undefined) {
      problems.push(`${name}: no event of this kind is exported`);
      continue;
    }
    const named = Number(groups["version"]);
    present.add(`${event.kind}@${named}`);
    const parsed = event.schema.safeParse(message);
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        problems.push(`${name}: ${issue.path.join(".")}: ${issue.message}`);
      continue;
    }
    const actual = versionOf.parse(parsed.data).version;
    if (actual !== named)
      problems.push(
        `${name}: the name says version ${named} but the message has version ${actual}`,
      );
  }
  for (const event of events)
    if (!present.has(`${event.kind}@${event.version}`))
      problems.push(
        `${event.kind} has no fixture for its current version ${event.version}: add ${event.kind}.v${event.version}.json`,
      );
  return problems;
}
