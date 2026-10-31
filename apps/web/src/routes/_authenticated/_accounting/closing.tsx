import { createFileRoute } from "@tanstack/react-router";

// 画面の中身は、申請・承認・確認・締めの画面の Issue で作る。ここは、メニューの行き先とガードの置き場所だけ。
export const Route = createFileRoute("/_authenticated/_accounting/closing")({
  staticData: { title: (t) => t("closing.title") },
  component: () => null,
});
