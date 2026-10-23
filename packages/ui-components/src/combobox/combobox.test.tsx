// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as Combobox from ".";
import * as MultiCombobox from "../multi-combobox";

const items = [{ label: "Apple", value: "apple" }] as const;

afterEach(cleanup);

const SingleCombobox = () => {
  const [value, setValue] = useState("");

  return (
    <Combobox.Root items={items} onValueChange={setValue} value={value}>
      <Combobox.Input aria-label="Label" />
      <Combobox.Popup>
        <Combobox.Empty>No matching items.</Combobox.Empty>
        <Combobox.Items />
      </Combobox.Popup>
    </Combobox.Root>
  );
};

const Multi = () => {
  const [value, setValue] = useState<string[]>([]);

  return (
    <MultiCombobox.Root items={items} onValueChange={setValue} value={value}>
      <MultiCombobox.InputGroup>
        <MultiCombobox.Chips>
          {(selected) => (
            <>
              {selected.map((item) => (
                <MultiCombobox.Chip item={item} key={item.value}>
                  {item.label}
                  <MultiCombobox.ChipRemove aria-label="Remove" />
                </MultiCombobox.Chip>
              ))}
              <MultiCombobox.Input aria-label="Creators" />
            </>
          )}
        </MultiCombobox.Chips>
      </MultiCombobox.InputGroup>
      <MultiCombobox.Popup>
        <MultiCombobox.Empty>No matching items.</MultiCombobox.Empty>
        <MultiCombobox.Items />
      </MultiCombobox.Popup>
    </MultiCombobox.Root>
  );
};

describe("Combobox input slots", () => {
  it("names the single-select input from the aria-label written on the slot", () => {
    render(<SingleCombobox />);

    expect(screen.getByRole("combobox", { name: "Label" })).toBeTruthy();
  });

  it("names the multi-select input from the aria-label written on the slot", () => {
    render(<Multi />);

    expect(screen.getByRole("combobox", { name: "Creators" })).toBeTruthy();
  });
});

describe("Combobox onSearch", () => {
  it("passes the typed text to onSearch", () => {
    const onSearch = vi.fn();
    render(
      <Combobox.Root
        items={items}
        onSearch={onSearch}
        onValueChange={vi.fn()}
        value=""
      >
        <Combobox.Input aria-label="Label" />
        <Combobox.Popup>
          <Combobox.Empty>No matching items.</Combobox.Empty>
          <Combobox.Items />
        </Combobox.Popup>
      </Combobox.Root>
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Label" }), {
      target: { value: "app" },
    });

    expect(onSearch).toHaveBeenCalledWith("app");
  });
});
