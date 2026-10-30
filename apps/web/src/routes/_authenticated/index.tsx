import { Button } from "@agent-software-factory/ui/components/button";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/")({
  component: Index,
});

function Index() {
  const { t } = useTranslation();
  return (
    <>
      <header className="border-b p-4">
        <h1 className="text-lg font-semibold">{t("home.title")}</h1>
      </header>
      {/* A part of packages/ui, to show that the app imports the shared parts (docs/adr/0034). */}
      <Button>{t("home.sampleButton")}</Button>
    </>
  );
}
