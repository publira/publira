// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItems,
  ComboboxPopup,
} from "./combobox";
import {
  MultiCombobox,
  MultiComboboxChip,
  MultiComboboxChipRemove,
  MultiComboboxChips,
  MultiComboboxInput,
  MultiComboboxInputGroup,
} from "./multi-combobox";

const items = [{ label: "Apple", value: "apple" }] as const;

afterEach(cleanup);

const SingleCombobox = () => {
  const [value, setValue] = useState("");

  return (
    <Combobox items={items} onValueChange={setValue} value={value}>
      <ComboboxInput aria-label="Label" />
      <ComboboxPopup>
        <ComboboxEmpty>No matching items.</ComboboxEmpty>
        <ComboboxItems />
      </ComboboxPopup>
    </Combobox>
  );
};

const Multi = () => {
  const [value, setValue] = useState<string[]>([]);

  return (
    <MultiCombobox items={items} onValueChange={setValue} value={value}>
      <MultiComboboxInputGroup>
        <MultiComboboxChips>
          {(selected) => (
            <>
              {selected.map((item) => (
                <MultiComboboxChip item={item} key={item.value}>
                  {item.label}
                  <MultiComboboxChipRemove aria-label="Remove" />
                </MultiComboboxChip>
              ))}
              <MultiComboboxInput aria-label="Creators" />
            </>
          )}
        </MultiComboboxChips>
      </MultiComboboxInputGroup>
      <ComboboxPopup>
        <ComboboxEmpty>No matching items.</ComboboxEmpty>
        <ComboboxItems />
      </ComboboxPopup>
    </MultiCombobox>
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
