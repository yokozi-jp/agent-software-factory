import { describe, expect, it, vi } from "vite-plus/test";
import A11yWarningsReporter, {
  a11yWarning,
  hasA11yReport,
  silentA11y,
} from "./a11y-warnings-reporter.ts";

const report = (status: string, ...rules: string[]) => ({
  type: "a11y",
  status,
  result: { violations: rules.map((id) => ({ id })) },
});

describe("a11y の警告の行", () => {
  it("警告の違反の規則を、重複なく story の名前とともに並べる", () => {
    expect(
      a11yWarning("ui/Axe > NoAlt", [
        report("warning", "image-alt", "label"),
        report("warning", "image-alt"),
      ]),
    ).toBe("a11y warning: ui/Axe > NoAlt: image-alt, label");
  });

  it("違反がなければ行を作らない", () => {
    expect(a11yWarning("s", [report("warning")])).toBeUndefined();
    expect(a11yWarning("s", undefined)).toBeUndefined();
    expect(a11yWarning("s", [])).toBeUndefined();
  });

  it("警告でない報告と、a11y でない報告は数えない", () => {
    expect(a11yWarning("s", [report("failed", "image-alt")])).toBeUndefined();
    expect(
      a11yWarning("s", [{ ...report("warning", "image-alt"), type: "other" }]),
    ).toBeUndefined();
  });

  it("形の違う報告を読み飛ばす", () => {
    expect(
      a11yWarning("s", [
        null,
        "x",
        { type: "a11y", status: "warning" },
        { type: "a11y", status: "warning", result: { violations: [null, { id: 1 }] } },
      ]),
    ).toBeUndefined();
  });
});

describe("a11y の警告の reporter", () => {
  const caseOf = (reports: unknown) => ({ fullName: "ui/Axe > NoAlt", meta: () => ({ reports }) });

  it("警告のある story を実行ログに出す", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    new A11yWarningsReporter().onTestCaseResult(caseOf([report("warning", "image-alt")]));
    expect(warn).toHaveBeenCalledWith("a11y warning: ui/Axe > NoAlt: image-alt");
    warn.mockRestore();
  });

  it("警告のない story は何も出さない", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    new A11yWarningsReporter().onTestCaseResult(caseOf([]));
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("a11y の報告がない実行", () => {
  it("story を実行したのに a11y の報告が 1 件もなければ、行を作る", () => {
    expect(silentA11y(3, 0)).toContain("3 件の story");
  });

  it("報告が 1 件でもあるか、story を実行していなければ、行を作らない", () => {
    expect(silentA11y(3, 1)).toBeUndefined();
    expect(silentA11y(0, 0)).toBeUndefined();
  });

  it("違反のない a11y の報告も、報告として数える", () => {
    expect(hasA11yReport([report("passed")])).toBe(true);
    expect(hasA11yReport([{ type: "other" }, null])).toBe(false);
    expect(hasA11yReport(undefined)).toBe(false);
  });

  it("story のテストを数えて、報告が 1 件もない実行の終わりに警告する", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const reporter = new A11yWarningsReporter();
    reporter.onTestCaseResult({ fullName: "unit", meta: () => ({}) });
    reporter.onTestRunEnd();
    expect(warn).not.toHaveBeenCalled();
    reporter.onTestCaseResult({
      fullName: "ui/Button > Default",
      meta: () => ({ storyId: "ui-button--default", reports: [] }),
    });
    reporter.onTestRunEnd();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("報告のある story があれば、終わりに警告しない", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const reporter = new A11yWarningsReporter();
    reporter.onTestCaseResult({
      fullName: "s",
      meta: () => ({ storyId: "s", reports: [report("passed")] }),
    });
    reporter.onTestRunEnd();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
