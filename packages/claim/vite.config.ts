import { recordOnlyConfig } from "../../vitest-coverage.ts";

// このモジュールのコードは apps/api と apps/worker のテストが通す。この project に下限はなく、記録だけを出す (vitest-coverage.ts)。
export default recordOnlyConfig();
