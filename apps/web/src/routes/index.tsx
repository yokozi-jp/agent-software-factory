import { Button } from "@agent-software-factory/ui/components/button";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <>
      <h1>agent-software-factory</h1>
      {/* A part of packages/ui, to show that the app imports the shared parts (docs/adr/0034). */}
      <Button>ボタン</Button>
    </>
  );
}
