import { Button } from "@agent-software-factory/ui/components/button";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <>
      <h1>agent-software-factory</h1>
      <Button>OK</Button>
    </>
  );
}
