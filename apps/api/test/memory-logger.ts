import { createNodeLogger } from "@agent-software-factory/logging/node";
import { memoryDestination } from "@agent-software-factory/logging/testing";

import { requestLogContext } from "../src/http/logging.ts";

/** メモリ上の出力先を持つ、本物の Logger (packages/logging の pino)。API の組み込みのテストが、出た行を読む。 */
export function memoryLogger() {
  const { lines, write } = memoryDestination();
  const logger = createNodeLogger({
    destination: { write },
    level: "debug",
    service: { name: "api", version: "0.0.0", environment: "test" },
    context: requestLogContext,
  });
  return { logger, lines };
}
