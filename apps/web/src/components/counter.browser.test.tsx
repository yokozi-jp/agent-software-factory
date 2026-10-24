import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";
import { Counter } from "./counter";

test("increments on click", async () => {
  const screen = await render(<Counter />);
  await screen.getByRole("button").click();
  await expect.element(screen.getByRole("button")).toHaveTextContent("count: 1");
});
