// The other half of the cycle that cycle-a.ts opens (import/no-cycle, docs/adr/0026).
// oxlint-disable-next-line import/no-cycle -- fixture: cycle-a.ts imports this file
import { fromA } from "./cycle-a.ts";

export const fromB: string = `b${fromA}`;
