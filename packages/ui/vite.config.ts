import { recordOnlyConfig } from "../../vitest-coverage.ts";

// 部品の確認は apps/web の storybook の project が流す (docs/adr/0033)。この project に下限はなく、記録だけを出す (vitest-coverage.ts)。
export default recordOnlyConfig("src/**/*.{ts,tsx}");
