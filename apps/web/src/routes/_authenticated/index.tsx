import { Button } from "@agent-software-factory/ui/components/button";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/")({
  staticData: { title: (t) => t("home.title") },
  component: Index,
});

function Index() {
  const { t } = useTranslation();
  return (
    // A part of packages/ui, to show that the app imports the shared parts (docs/adr/0034).
    <Button>{t("home.sampleButton")}</Button>
  );
}
