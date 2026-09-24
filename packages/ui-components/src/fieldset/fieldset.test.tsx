// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Checkbox } from "../checkbox/checkbox";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItems,
  ComboboxPopup,
} from "../combobox/combobox";
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogContent,
  ConfirmDialogTitle,
  ConfirmDialogTrigger,
} from "../dialog/confirm-dialog";
import { Field, FieldContent, FieldLabel } from "../field/field";
import { Input } from "../input/input";
import { RadioGroup } from "../radio-group/radio-group";
import { Select } from "../select/select";
import { Switch } from "../switch/switch";
import { Textarea } from "../textarea/textarea";
import { Fieldset } from "./fieldset";

afterEach(() => {
  cleanup();
});

const Controls = ({ disabled }: { disabled: boolean }) => (
  <Fieldset disabled={disabled}>
    <Field>
      <FieldLabel>Title</FieldLabel>
      <FieldContent>
        <Input />
      </FieldContent>
    </Field>
    <Field>
      <FieldLabel>Synopsis</FieldLabel>
      <FieldContent>
        <Textarea />
      </FieldContent>
    </Field>
    <Field>
      <FieldLabel>Label</FieldLabel>
      <FieldContent>
        <Combobox
          items={[{ label: "Apple", value: "apple" }]}
          onValueChange={() => null}
          value=""
        >
          <ComboboxInput />
          <ComboboxPopup>
            <ComboboxEmpty>None</ComboboxEmpty>
            <ComboboxItems />
          </ComboboxPopup>
        </Combobox>
      </FieldContent>
    </Field>
    <Field>
      <FieldLabel>Status</FieldLabel>
      <FieldContent>
        <Select items={[{ label: "Ongoing", value: "ongoing" }]} />
      </FieldContent>
    </Field>
    <Field>
      <FieldLabel>Visibility</FieldLabel>
      <FieldContent>
        <RadioGroup
          items={[
            { label: "Public", value: "public" },
            { label: "Private", value: "private" },
          ]}
        />
      </FieldContent>
    </Field>
    <Field>
      <FieldLabel>Published</FieldLabel>
      <FieldContent>
        <Checkbox />
      </FieldContent>
    </Field>
    <Field>
      <FieldLabel>Pinned</FieldLabel>
      <FieldContent>
        <Switch />
      </FieldContent>
    </Field>
    {/* Base UI renders these as a `<span>`, which neither the field context
        nor the native `<fieldset>` reaches outside a `Field`. */}
    <Checkbox aria-label="Monday" />
    <Switch aria-label="Featured" />
    <RadioGroup
      aria-label="Layout"
      items={[{ label: "Single page", value: "single" }]}
    />
    <button type="button">Add a credit</button>
  </Fieldset>
);

/**
 * Whether a control refuses input, whichever way it says so. A native control
 * closed by its `<fieldset>` keeps `disabled` false and matches `:disabled`.
 */
const isClosed = (element: HTMLElement) =>
  element.matches(":disabled") ||
  element.getAttribute("aria-disabled") === "true" ||
  Object.hasOwn(element.dataset, "disabled");

const controls = () => [
  screen.getByRole("textbox", { name: "Title" }),
  screen.getByRole("textbox", { name: "Synopsis" }),
  screen.getByRole("combobox", { name: "Label" }),
  screen.getByRole("combobox", { name: "Status" }),
  ...screen.getAllByRole("radio"),
  screen.getByRole("checkbox", { name: "Published" }),
  screen.getByRole("switch", { name: "Pinned" }),
  screen.getByRole("checkbox", { name: "Monday" }),
  screen.getByRole("switch", { name: "Featured" }),
  screen.getByRole("button", { name: "Add a credit" }),
];

const DateDialog = ({ disabled }: { disabled: boolean }) => (
  <Fieldset disabled={disabled}>
    <ConfirmDialog>
      <ConfirmDialogTrigger>Change</ConfirmDialogTrigger>
      <ConfirmDialogContent>
        <ConfirmDialogTitle>Change the date?</ConfirmDialogTitle>
        <ConfirmDialogAction form="date-form">Save</ConfirmDialogAction>
      </ConfirmDialogContent>
    </ConfirmDialog>
  </Fieldset>
);

describe("Fieldset", () => {
  it("leaves the controls inside it open", () => {
    render(<Controls disabled={false} />);

    for (const control of controls()) {
      expect(isClosed(control)).toBe(false);
    }
  });

  it("closes every control inside it when disabled", () => {
    render(<Controls disabled />);

    for (const control of controls()) {
      expect(isClosed(control)).toBe(true);
    }
  });

  it("stays closed inside a nested fieldset that is not disabled itself", () => {
    render(
      <Fieldset disabled>
        <Fieldset>
          <Checkbox aria-label="Monday" />
        </Fieldset>
      </Fieldset>
    );

    expect(isClosed(screen.getByRole("checkbox", { name: "Monday" }))).toBe(
      true
    );
  });

  // The popup is portaled out of the `<fieldset>`, and the dialog stays open
  // when the form it confirms is submitted some other way, such as by Enter.
  it("closes the confirm action of a dialog opened inside it", async () => {
    const { rerender } = render(<DateDialog disabled={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    const action = await screen.findByRole("button", { name: "Save" });
    expect(isClosed(action)).toBe(false);

    rerender(<DateDialog disabled />);

    expect(isClosed(action)).toBe(true);
  });
});
