import { describe, expect, it, vi } from "vite-plus/test";
import A11yWarningsReporter, { a11yWarning } from "./a11y-warnings-reporter.ts";

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
