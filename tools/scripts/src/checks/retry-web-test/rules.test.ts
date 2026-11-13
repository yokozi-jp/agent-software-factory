// The rules of retry-web-test: which failed runs are run again, and the notices. The entry point that runs the
// command is in cli.test.ts.
import { describe, expect, it } from "vite-plus/test";
import {
  failedTasks,
  loadFailure,
  retriedTask,
  retryNotice,
  retryReason,
  secondFailureNotice,
  unreadableFailedTasksNotice,
} from "./rules.ts";

const esc = String.fromCharCode(27);
const iframe =
  'Error: The iframe "/work/apps/web/src/lib/use-idempotent-mutation.test.tsx" did not become ready within 60000ms. The tester likely failed to initialize.';
const dynamicImport =
  "TypeError: Failed to fetch dynamically imported module: http://localhost:23317/src/app.stories.tsx";

// What Nx prints when targets fail, as in the log of run 43266400536 (colored when the runner asks for color).
const nxFailure = (tasks: readonly string[], colored = false): string => {
  const dim = (text: string): string => (colored ? `${esc}[2m${text}${esc}[22m` : text);
  return [
    ` NX   Running targets check, test, build for 19 projects failed`,
    "",
    dim("Failed tasks:"),
    "",
    ...tasks.map((task) => `${dim("-")} ${task}`),
    "",
    dim("Output of 39 successful tasks were not shown."),
    "",
  ].join("\n");
};

describe("failedTasks", () => {
  it("「Failed tasks:」の下の task を順に読むこと", () => {
    expect(failedTasks(nxFailure(["web:test", "api:check"]))).toEqual(["web:test", "api:check"]);
  });

  it("色付きの出力を読むこと", () => {
    expect(failedTasks(nxFailure(["web:test"], true))).toEqual(["web:test"]);
  });

  it("task ではない行で読むのをやめること", () => {
    const output = `${nxFailure(["web:test"])}\n- not-a-task-after-text`;
    expect(failedTasks(output)).toEqual(["web:test"]);
  });

  it("見出しより前の task の行を読まないこと", () => {
    expect(failedTasks(`- api:test\n${nxFailure(["web:test"])}`)).toEqual(["web:test"]);
  });

  it("行の前後の空白と、空白だけの行を無視すること", () => {
    expect(
      failedTasks("  Failed tasks:  \r\n   \r\n  - web:test  \r\n \r\n\t- api:test\t\r\n"),
    ).toEqual(["web:test", "api:test"]);
  });

  it("ハイフンの前に文字がある行を task と読まないこと", () => {
    expect(failedTasks("Failed tasks:\n\nsee - web:test\n")).toEqual([]);
  });

  it("見出しがなければ空にすること", () => {
    expect(failedTasks("- web:test\nsomething else")).toEqual([]);
  });

  it("見出しが最後の行なら空にすること", () => {
    expect(failedTasks("Failed tasks:")).toEqual([]);
  });

  it("task 名の後に文字が続く行を task と読まないこと", () => {
    expect(failedTasks("Failed tasks:\n\n- web:test failed\n")).toEqual([]);
  });

  it("ハイフンの後に空白がない行を task と読まないこと", () => {
    expect(failedTasks("Failed tasks:\n\n-web:test\n")).toEqual([]);
  });
});

describe("loadFailure", () => {
  it("iframe が用意できなかった失敗の名前を返すこと", () => {
    expect(loadFailure(iframe)).toBe("iframe did not become ready");
  });

  it("動的 import の失敗の名前を返すこと", () => {
    expect(loadFailure(dynamicImport)).toBe("dynamic import failed");
  });

  it("色付きの出力を読むこと", () => {
    expect(loadFailure(`${esc}[31m${iframe}${esc}[39m`)).toBe("iframe did not become ready");
  });

  it("待ち時間がミリ秒の数でない iframe のエラーを読まないこと", () => {
    expect(loadFailure('The iframe "x" did not become ready within soon')).toBeUndefined();
  });

  it("ふつうのテストの失敗を読み込みの失敗と読まないこと", () => {
    expect(loadFailure("AssertionError: expected 1 to be 2")).toBeUndefined();
  });

  it("2 つの失敗があれば、表の順で先のものの名前を返すこと", () => {
    expect(loadFailure(`${dynamicImport}\n${iframe}`)).toBe("iframe did not become ready");
  });
});

describe("retryReason", () => {
  it("web:test だけがファイルを読み込めなかったとき、その失敗の名前を返すこと", () => {
    expect(retryReason(`${iframe}\n${nxFailure([retriedTask])}`)).toBe(
      "iframe did not become ready",
    );
    expect(retryReason(`${dynamicImport}\n${nxFailure([retriedTask], true)}`)).toBe(
      "dynamic import failed",
    );
  });

  it("web:test が別の理由で落ちたとき、undefined を返すこと", () => {
    expect(retryReason(`AssertionError\n${nxFailure([retriedTask])}`)).toBeUndefined();
  });

  it("別の task も落ちたとき、undefined を返すこと", () => {
    expect(retryReason(`${iframe}\n${nxFailure([retriedTask, "api:test"])}`)).toBeUndefined();
  });

  it("別の task だけが落ちたとき、undefined を返すこと", () => {
    expect(retryReason(`${iframe}\n${nxFailure(["api:test"])}`)).toBeUndefined();
  });

  it("同じ task が 2 回挙がったとき、undefined を返すこと", () => {
    expect(retryReason(`${iframe}\n${nxFailure([retriedTask, retriedTask])}`)).toBeUndefined();
  });

  it("task が挙がっていないとき、undefined を返すこと", () => {
    expect(retryReason(iframe)).toBeUndefined();
  });
});

describe("retryNotice", () => {
  it("GitHub Actions では annotation にすること", () => {
    expect(retryNotice("iframe did not become ready", { GITHUB_ACTIONS: "true" })).toBe(
      "::warning title=web-test-flaky::web:test failed to load a test file (iframe did not become ready). " +
        "Running the failed tasks once more; the tasks that passed come from the Nx cache. " +
        "This is the flaky failure of #523.\n",
    );
  });

  it("GitHub Actions の外では、ふつうの行にすること", () => {
    expect(retryNotice("dynamic import failed", {})).toBe(
      "warning: web:test failed to load a test file (dynamic import failed). " +
        "Running the failed tasks once more; the tasks that passed come from the Nx cache. " +
        "This is the flaky failure of #523.\n",
    );
    expect(retryNotice("x", { GITHUB_ACTIONS: "false" })).toMatch(/^warning: /);
  });

  it("annotation の中の理由のパーセント記号と改行を逃がすこと", () => {
    const notice = retryNotice("100%\nsure", { GITHUB_ACTIONS: "true" });
    expect(notice).toContain("(100%25%0Asure)");
    expect(notice.trimEnd().split("\n")).toHaveLength(1);
  });
});

describe("secondFailureNotice", () => {
  it("終了コードと、3 回目を流さないことを述べること", () => {
    expect(secondFailureNotice(1)).toBe(
      "The second run failed too (exit 1). It is not run a third time.\n",
    );
  });
});

describe("unreadableFailedTasksNotice", () => {
  it("見出しがあるのに task を読めないとき、annotation を返すこと", () => {
    const notice = unreadableFailedTasksNotice("Failed tasks:\n\n* web:test\n", {
      GITHUB_ACTIONS: "true",
    });
    expect(notice).toMatch(/^::warning title=web-test-flaky::.*Failed tasks:/);
    expect(notice?.endsWith("\n")).toBe(true);
  });

  it("GitHub Actions の外では warning: の行にすること", () => {
    expect(unreadableFailedTasksNotice("Failed tasks:\n", {})).toMatch(/^warning: /);
  });

  it("task を読めたときと、見出しがないときは何も返さないこと", () => {
    expect(unreadableFailedTasksNotice(nxFailure(["web:test"]), {})).toBeUndefined();
    expect(unreadableFailedTasksNotice("some other failure\n", {})).toBeUndefined();
  });
});
