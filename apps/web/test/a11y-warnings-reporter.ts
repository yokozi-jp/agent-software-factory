// a11y (axe) の違反を、テストの実行ログに警告として出す Vitest の reporter (vite.config.ts の `reporters`、docs/adr/0033)。
// Storybook の a11y addon は、`parameters.a11y.test` が "todo" の story の違反を Storybook の画面にだけ出し、CI のログには何も出さない
// (https://storybook.js.org/docs/writing-tests/accessibility-testing)。違反は addon 10.6.5 が `meta().reports` に入れるので、ここで読んで出す。
// "error" の story の違反はテストの失敗として出るので、この reporter は警告 (status が "warning") だけを出す。
import type { Reporter } from "vite-plus/test/node";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

// meta().reports のうち、警告の a11y の報告から、違反した規則の id を重複なく取り出す。
function warnedRules(reports: unknown): string[] {
  if (!Array.isArray(reports)) return [];
  const rules = new Set<string>();
  for (const report of reports) {
    if (!isRecord(report) || report["type"] !== "a11y" || report["status"] !== "warning") continue;
    const result = report["result"];
    const violations = isRecord(result) ? result["violations"] : undefined;
    for (const violation of Array.isArray(violations) ? violations : [])
      if (isRecord(violation) && typeof violation["id"] === "string") rules.add(violation["id"]);
  }
  return [...rules];
}

// 警告の行。違反がなければ undefined。
export function a11yWarning(storyName: string, reports: unknown): string | undefined {
  const rules = warnedRules(reports);
  return rules.length === 0 ? undefined : `a11y warning: ${storyName}: ${rules.join(", ")}`;
}

// Vitest の TestCase のうち、ここで読む部分。meta() の型は、addon が足す `reports` を知らない。
interface FinishedTest {
  readonly fullName: string;
  meta(): object;
}

export default class A11yWarningsReporter implements Reporter {
  onTestCaseResult(testCase: FinishedTest): void {
    const meta = testCase.meta();
    const line = a11yWarning(testCase.fullName, "reports" in meta ? meta.reports : undefined);
    if (line !== undefined) console.warn(line);
  }
}
