import type { ErrorComponentProps } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { ForbiddenScreen } from "@/components/error-screens.tsx";
import { ForbiddenError } from "@/lib/forbidden.ts";

/** 経理専用の route の errorComponent。権限がなければ 403 (URL は変えない)。それ以外の失敗は、一般のエラーを出す。 */
export function RouteError({ error }: Pick<ErrorComponentProps, "error">) {
  const { t } = useTranslation();
  if (error instanceof ForbiddenError) return <ForbiddenScreen embedded />;
  return <p role="alert">{t("problem.generic")}</p>;
}
