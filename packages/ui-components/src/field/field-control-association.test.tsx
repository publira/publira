// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { Checkbox } from "../checkbox/checkbox";
import { Combobox } from "../combobox/combobox";
import { MultiCombobox } from "../combobox/multi-combobox";
import { Input } from "../input/input";
import { RadioGroup } from "../radio-group/radio-group";
import { Select } from "../select/select";
import { Switch } from "../switch/switch";
import { Textarea } from "../textarea/textarea";
import { Field, FieldLabel } from "./field";

const comboItems = [{ label: "Apple", value: "apple" }] as const;
const selectItems = [{ label: "Option A", value: "a" }] as const;
const radioItems = [
  { label: "Public", value: "public" },
  { label: "Private", value: "private" },
] as const;

afterEach(cleanup);

const getAssociation = (container: HTMLElement, labelText: string) => {
  const label = [...container.querySelectorAll("label")].find((element) =>
    element.textContent?.includes(labelText)
  );
  expect(label).toBeTruthy();

  const htmlFor = label?.htmlFor ?? "";
  expect(htmlFor).not.toBe("");

  const control = container.ownerDocument.querySelector(
    `#${CSS.escape(htmlFor)}`
  );
  expect(control).toBeTruthy();

  return {
    control: control as HTMLElement,
    htmlFor,
    label: label as HTMLLabelElement,
  };
};

const StatefulCombobox = ({ id }: { id?: string }) => {
  const [value, setValue] = useState("");

  return (
    <Combobox
      emptyMessage="No matching items."
      id={id}
      items={comboItems}
      onValueChange={setValue}
      value={value}
    />
  );
};

const StatefulMultiCombobox = ({ id }: { id?: string }) => {
  const [value, setValue] = useState<string[]>([]);

  return (
    <MultiCombobox
      emptyMessage="No matching items."
      id={id}
      items={comboItems}
      onValueChange={setValue}
      removeLabel="Remove"
      value={value}
    />
  );
};

describe("for/id association between Field and the form parts", () => {
  it.each([
    {
      name: "Input",
      renderControl: () => <Input />,
    },
    {
      name: "Textarea",
      renderControl: () => <Textarea />,
    },
    {
      name: "Select",
      renderControl: () => <Select items={selectItems} />,
    },
    {
      name: "Checkbox",
      renderControl: () => <Checkbox />,
    },
    {
      name: "Switch",
      renderControl: () => <Switch />,
    },
    {
      name: "RadioGroup",
      renderControl: () => <RadioGroup items={radioItems} />,
    },
    {
      name: "Combobox",
      renderControl: () => <StatefulCombobox />,
    },
    {
      name: "MultiCombobox",
      renderControl: () => <StatefulMultiCombobox />,
    },
  ])(
    "a $name without an id gets a unique id, and FieldLabel's for points at it",
    ({ renderControl }) => {
      const { container } = render(
        <Field>
          <FieldLabel>Label</FieldLabel>
          {renderControl()}
        </Field>
      );

      const { control, htmlFor } = getAssociation(container, "Label");
      expect(control.id).toBe(htmlFor);
    }
  );

  it.each([
    {
      name: "Combobox",
      renderControl: () => <StatefulCombobox />,
    },
    {
      name: "MultiCombobox",
      renderControl: () => <StatefulMultiCombobox />,
    },
  ])("two $name mounted at once do not share an id", ({ renderControl }) => {
    const { container } = render(
      <>
        <Field>
          <FieldLabel>First</FieldLabel>
          {renderControl()}
        </Field>
        <Field>
          <FieldLabel>Second</FieldLabel>
          {renderControl()}
        </Field>
      </>
    );

    const first = getAssociation(container, "First");
    const second = getAssociation(container, "Second");

    expect(first.htmlFor).not.toBe(second.htmlFor);
    expect(first.control.id).not.toBe(second.control.id);
  });

  it.each([
    {
      name: "Input",
      renderControl: (id: string) => <Input id={id} />,
    },
    {
      name: "Textarea",
      renderControl: (id: string) => <Textarea id={id} />,
    },
    {
      name: "Select",
      renderControl: (id: string) => <Select id={id} items={selectItems} />,
    },
    {
      name: "Checkbox",
      renderControl: (id: string) => <Checkbox id={id} />,
    },
    {
      name: "Switch",
      renderControl: (id: string) => <Switch id={id} />,
    },
    {
      name: "Combobox",
      renderControl: (id: string) => <StatefulCombobox id={id} />,
    },
    {
      name: "MultiCombobox",
      renderControl: (id: string) => <StatefulMultiCombobox id={id} />,
    },
  ])(
    "an explicit id is used by both $name and FieldLabel",
    ({ name, renderControl }) => {
      const explicitId = `explicit-${name.toLowerCase()}`;

      const { container } = render(
        <Field>
          <FieldLabel>Label</FieldLabel>
          {renderControl(explicitId)}
        </Field>
      );

      const { control, htmlFor } = getAssociation(container, "Label");
      expect(htmlFor).toBe(explicitId);
      expect(control.id).toBe(explicitId);
    }
  );

  it.each([
    {
      name: "Input",
      renderControl: () => <Input />,
    },
    {
      name: "Textarea",
      renderControl: () => <Textarea />,
    },
    {
      name: "Select",
      renderControl: () => <Select items={selectItems} />,
    },
    {
      name: "Combobox",
      renderControl: () => <StatefulCombobox />,
    },
    {
      name: "MultiCombobox",
      renderControl: () => <StatefulMultiCombobox />,
    },
  ])("clicking the label activates $name", ({ renderControl }) => {
    const { container } = render(
      <Field>
        <FieldLabel>Label</FieldLabel>
        {renderControl()}
      </Field>
    );

    const { control, label } = getAssociation(container, "Label");
    // jsdom does not move focus when a label[for] is clicked. A browser moves
    // it on that same activation, so what is checked here is that the click
    // reaches the control.
    let activated = false;
    control.addEventListener("click", () => {
      activated = true;
    });
    label.click();
    expect(activated).toBe(true);
  });
});
