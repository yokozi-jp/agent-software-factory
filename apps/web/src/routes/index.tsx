import { Button } from "@agent-software-factory/ui/components/button";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { t } = useTranslation();
  return (
    <>
      <h1>{t("app.name")}</h1>
      {/* A part of packages/ui, to show that the app imports the shared parts (docs/adr/0034). */}
      <Button>{t("home.sampleButton")}</Button>
    </>
  );
}
