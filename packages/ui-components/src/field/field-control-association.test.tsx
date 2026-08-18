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

const comboItems = [{ label: "りんご", value: "apple" }] as const;
const selectItems = [{ label: "選択肢A", value: "a" }] as const;
const radioItems = [
  { label: "公開", value: "public" },
  { label: "非公開", value: "private" },
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
      id={id}
      items={comboItems}
      onValueChange={setValue}
      value={value}
    />
  );
};

describe("Field とフォームパーツの for/id 関連付け", () => {
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
    "id 未指定の $name は一意な id を持ち、FieldLabel の for がそれを指す",
    ({ renderControl }) => {
      const { container } = render(
        <Field>
          <FieldLabel>ラベル</FieldLabel>
          {renderControl()}
        </Field>
      );

      const { control, htmlFor } = getAssociation(container, "ラベル");
      expect(control.id).toBe(htmlFor);
    }
  );

  it("同じフォームを 2 つ同時にマウントしても id が重複しない", () => {
    const { container } = render(
      <>
        <Field>
          <FieldLabel>一つ目</FieldLabel>
          <StatefulCombobox />
        </Field>
        <Field>
          <FieldLabel>二つ目</FieldLabel>
          <StatefulCombobox />
        </Field>
      </>
    );

    const first = getAssociation(container, "一つ目");
    const second = getAssociation(container, "二つ目");

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
    "明示した id を $name と FieldLabel の両方で使う",
    ({ name, renderControl }) => {
      const explicitId = `explicit-${name.toLowerCase()}`;

      const { container } = render(
        <Field>
          <FieldLabel>ラベル</FieldLabel>
          {renderControl(explicitId)}
        </Field>
      );

      const { control, htmlFor } = getAssociation(container, "ラベル");
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
  ])("ラベルをクリックすると $name が活性化する", ({ renderControl }) => {
    const { container } = render(
      <Field>
        <FieldLabel>ラベル</FieldLabel>
        {renderControl()}
      </Field>
    );

    const { control, label } = getAssociation(container, "ラベル");
    // jsdom は label[for] のクリックで focus を移さない。ブラウザでは同じ活性化が
    // フォーカスを動かすので、ここではコントロールへ click が届くことを見る。
    let activated = false;
    control.addEventListener("click", () => {
      activated = true;
    });
    label.click();
    expect(activated).toBe(true);
  });
});
