import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";

function renderToggleGroup(orientation: "horizontal" | "vertical") {
  render(
    <ToggleGroup
      type="single"
      orientation={orientation}
      aria-label={`${orientation} choices`}
    >
      <ToggleGroupItem value="first">First</ToggleGroupItem>
      <ToggleGroupItem value="second">Second</ToggleGroupItem>
    </ToggleGroup>
  );

  return screen.getByRole("radio", { name: "First" });
}

describe("ToggleGroup orientation", () => {
  it("uses only horizontal arrow keys for a horizontal group", () => {
    const firstItem = renderToggleGroup("horizontal");

    expect(fireEvent.keyDown(firstItem, { key: "ArrowDown" })).toBe(true);
    expect(fireEvent.keyDown(firstItem, { key: "ArrowRight" })).toBe(false);
  });

  it("uses only vertical arrow keys for a vertical group", () => {
    const firstItem = renderToggleGroup("vertical");

    expect(fireEvent.keyDown(firstItem, { key: "ArrowRight" })).toBe(true);
    expect(fireEvent.keyDown(firstItem, { key: "ArrowDown" })).toBe(false);
  });
});
