// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { Suspense, use, useState } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import type { MockInstance } from "vitest";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";

import { Checkbox } from "../checkbox/checkbox";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItems,
  ComboboxPopup,
} from "../combobox/combobox";
import {
  MultiCombobox,
  MultiComboboxChip,
  MultiComboboxChipRemove,
  MultiComboboxChips,
  MultiComboboxInput,
  MultiComboboxInputGroup,
} from "../combobox/multi-combobox";
import { Input } from "../input/input";
import { RadioGroup } from "../radio-group/radio-group";
import { Select } from "../select/select";
import { Switch } from "../switch/switch";
import { Textarea } from "../textarea/textarea";
import { Field, FieldDescription, FieldLabel } from "./field";

const comboItems = [{ label: "Apple", value: "apple" }] as const;
const selectItems = [{ label: "Option A", value: "a" }] as const;
const radioItems = [
  { label: "Public", value: "public" },
  { label: "Private", value: "private" },
] as const;

let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error");
});

afterEach(() => {
  cleanup();
  // Base UI logs a mismatch between `nativeLabel` and the rendered element
  // from its development build, and only once per message.
  const nativeLabelErrors = consoleError.mock.calls.filter((args) =>
    args.some((arg) => String(arg).includes("nativeLabel"))
  );
  consoleError.mockRestore();
  expect(nativeLabelErrors).toEqual([]);
});

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
    <Combobox id={id} items={comboItems} onValueChange={setValue} value={value}>
      <ComboboxInput />
      <ComboboxPopup>
        <ComboboxEmpty>No matching items.</ComboboxEmpty>
        <ComboboxItems />
      </ComboboxPopup>
    </Combobox>
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
    >
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
              <MultiComboboxInput />
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

const LateSelect = ({ ready }: { ready: PromiseLike<unknown> }) => {
  use(ready);
  return <Select items={selectItems} />;
};

// The Select streams in after the label and description have published their
// ids, which is the order that left the server's attributes on the trigger.
const LateSelectForm = ({ ready }: { ready: PromiseLike<unknown> }) => (
  <Field>
    <FieldLabel>Label</FieldLabel>
    <Suspense fallback={null}>
      <LateSelect ready={ready} />
    </Suspense>
    <FieldDescription>Help</FieldDescription>
  </Field>
);

describe("FieldLabel over a Select, whose trigger is a button that opens a popup", () => {
  it("renders a non-label element that names the trigger through aria-labelledby", () => {
    const { container } = render(
      <Field>
        <FieldLabel>Label</FieldLabel>
        <Select items={selectItems} />
      </Field>
    );

    expect(container.querySelector("label")).toBeNull();
    const trigger = screen.getByRole("combobox", { name: "Label" });
    expect(trigger.id).not.toBe("");
  });

  it("switches to the non-label element when the Select mounts after the Field", async () => {
    const { container, rerender } = render(
      <Field>
        <FieldLabel>Label</FieldLabel>
      </Field>
    );
    expect(container.querySelector("label")).not.toBeNull();

    rerender(
      <Field>
        <FieldLabel>Label</FieldLabel>
        <Select items={selectItems} />
      </Field>
    );

    await waitFor(() => expect(container.querySelector("label")).toBeNull());
    expect(screen.getByRole("combobox", { name: "Label" })).toBeTruthy();
  });

  it("references the label and description once a Select hydrated after them", async () => {
    const resolved = Object.assign(Promise.resolve(), {
      status: "fulfilled",
      value: null,
    });
    const markup = new DOMParser().parseFromString(
      renderToString(<LateSelectForm ready={resolved} />),
      "text/html"
    );
    const container = document.createElement("div");
    container.append(...markup.body.childNodes);
    document.body.append(container);
    onTestFinished(() => container.remove());

    let released = false;
    const pending = vi.waitFor(() => {
      expect(released).toBe(true);
    });
    const root = await act(() =>
      hydrateRoot(container, <LateSelectForm ready={pending} />)
    );
    onTestFinished(() => act(() => root.unmount()));
    await act(async () => {
      released = true;
      await pending;
    });

    const trigger = container.querySelector("[role=combobox]");
    const referenced = (attribute: string) =>
      container.querySelector(
        `#${CSS.escape(trigger?.getAttribute(attribute) ?? "")}`
      )?.textContent;
    expect(referenced("aria-labelledby")).toBe("Label");
    expect(referenced("aria-describedby")).toBe("Help");
  });

  it("gives two Selects mounted at once their own ids", () => {
    render(
      <>
        <Field>
          <FieldLabel>First</FieldLabel>
          <Select items={selectItems} />
        </Field>
        <Field>
          <FieldLabel>Second</FieldLabel>
          <Select items={selectItems} />
        </Field>
      </>
    );

    const first = screen.getByRole("combobox", { name: "First" });
    const second = screen.getByRole("combobox", { name: "Second" });
    expect(first.id).not.toBe(second.id);
  });

  it("puts an explicit id on the trigger", () => {
    render(
      <Field>
        <FieldLabel>Label</FieldLabel>
        <Select id="explicit-select" items={selectItems} />
      </Field>
    );

    expect(screen.getByRole("combobox", { name: "Label" }).id).toBe(
      "explicit-select"
    );
  });

  it("focuses the trigger without opening the popup when the label is clicked", () => {
    render(
      <Field>
        <FieldLabel>Label</FieldLabel>
        <Select items={selectItems} />
      </Field>
    );

    const trigger = screen.getByRole("combobox", { name: "Label" });
    screen.getByText("Label").click();

    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("FieldLabel over a Combobox, whose control is a text input", () => {
  it.each([
    {
      name: "Combobox",
      renderControl: () => <StatefulCombobox />,
    },
    {
      name: "MultiCombobox",
      renderControl: () => <StatefulMultiCombobox />,
    },
  ])(
    "clicking the label reaches the $name input without opening the popup",
    ({ renderControl }) => {
      const { container } = render(
        <Field>
          <FieldLabel>Label</FieldLabel>
          {renderControl()}
        </Field>
      );

      const { control, label } = getAssociation(container, "Label");
      let activated = false;
      control.addEventListener("click", () => {
        activated = true;
      });
      label.click();

      expect(activated).toBe(true);
      expect(control.getAttribute("aria-expanded")).toBe("false");
    }
  );
});
