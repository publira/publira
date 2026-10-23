// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Checkbox } from "../checkbox/checkbox";
import * as Combobox from "../combobox";
import * as ConfirmDialog from "../confirm-dialog";
import * as Field from "../field";
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
    <Field.Root>
      <Field.Label>Title</Field.Label>
      <Field.Content>
        <Input />
      </Field.Content>
    </Field.Root>
    <Field.Root>
      <Field.Label>Synopsis</Field.Label>
      <Field.Content>
        <Textarea />
      </Field.Content>
    </Field.Root>
    <Field.Root>
      <Field.Label>Label</Field.Label>
      <Field.Content>
        <Combobox.Root
          items={[{ label: "Apple", value: "apple" }]}
          onValueChange={() => null}
          value=""
        >
          <Combobox.Input />
          <Combobox.Popup>
            <Combobox.Empty>None</Combobox.Empty>
            <Combobox.Items />
          </Combobox.Popup>
        </Combobox.Root>
      </Field.Content>
    </Field.Root>
    <Field.Root>
      <Field.Label>Status</Field.Label>
      <Field.Content>
        <Select items={[{ label: "Ongoing", value: "ongoing" }]} />
      </Field.Content>
    </Field.Root>
    <Field.Root>
      <Field.Label>Visibility</Field.Label>
      <Field.Content>
        <RadioGroup
          items={[
            { label: "Public", value: "public" },
            { label: "Private", value: "private" },
          ]}
        />
      </Field.Content>
    </Field.Root>
    <Field.Root>
      <Field.Label>Published</Field.Label>
      <Field.Content>
        <Checkbox />
      </Field.Content>
    </Field.Root>
    <Field.Root>
      <Field.Label>Pinned</Field.Label>
      <Field.Content>
        <Switch />
      </Field.Content>
    </Field.Root>
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
    <ConfirmDialog.Root>
      <ConfirmDialog.Trigger>Change</ConfirmDialog.Trigger>
      <ConfirmDialog.Content>
        <ConfirmDialog.Title>Change the date?</ConfirmDialog.Title>
        <ConfirmDialog.Action form="date-form">Save</ConfirmDialog.Action>
      </ConfirmDialog.Content>
    </ConfirmDialog.Root>
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
