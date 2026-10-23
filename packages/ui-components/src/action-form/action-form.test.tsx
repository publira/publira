// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useActionState } from "react";
import { createPortal } from "react-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as ActionForm from ".";

afterEach(cleanup);

const succeed = (): Promise<ActionForm.State> =>
  Promise.resolve({
    message: "Role updated.",
    ok: true,
  });

const fail = (): Promise<ActionForm.State> =>
  Promise.resolve({
    message: "Could not save.",
    ok: false,
  });

type NameFormState =
  | { ok: true; message: string; name: string }
  | {
      ok: false;
      message: string;
      fieldErrors?: Partial<Record<"name" | "slug", string>>;
    }
  | null;

const refuseName = (): Promise<NameFormState> =>
  Promise.resolve({
    fieldErrors: { name: "Enter a shorter name." },
    message: "Could not save.",
    ok: false,
  });

const saveName = (
  _prevState: NameFormState,
  formData: FormData
): Promise<NameFormState> =>
  Promise.resolve({
    message: "Saved.",
    name: String(formData.get("name")).trim(),
    ok: true,
  });

/** Reads the name the Action saved, the way a control seeded from it would. */
const SavedName = () => {
  const state = ActionForm.useState<NonNullable<NameFormState>>();

  return <p>{state?.ok ? `Saved as ${state.name}` : "Not saved yet"}</p>;
};

/** Hands each settled state to `onSettled`, the way a toast would be raised. */
const SettledSpy = ({
  onSettled,
}: {
  onSettled: ActionForm.SettledListener<NonNullable<NameFormState>>;
}) => {
  ActionForm.useSettled(onSettled);

  return null;
};

/** Refuses a row's rename, naming the row it was sent from. */
const renameRow = (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> =>
  Promise.resolve({
    message: `Could not rename ${String(formData.get("public_id"))}.`,
    ok: false,
  });

/** A save form with a connection test that sends the same field elsewhere. */
const TestedForm = ({
  save,
  test,
}: {
  save: () => Promise<ActionForm.State>;
  test: (previousState: null, formData: FormData) => Promise<null>;
}) => {
  const [, dispatchTest] = useActionState(test, null);

  return (
    <ActionForm.Root action={save}>
      <input aria-label="Bucket" defaultValue="media" name="bucket" />
      <ActionForm.Submit formAction={dispatchTest}>
        <ActionForm.Idle>Test</ActionForm.Idle>
        <ActionForm.Pending>Testing...</ActionForm.Pending>
      </ActionForm.Submit>
      <ActionForm.Submit>
        <ActionForm.Idle>Save</ActionForm.Idle>
        <ActionForm.Pending>Saving...</ActionForm.Pending>
      </ActionForm.Submit>
    </ActionForm.Root>
  );
};

/** The same pair of controls in a plain `<form>`, each naming its own Action. */
const PlainTestedForm = ({
  save,
  test,
}: {
  save: () => Promise<null>;
  test: () => Promise<null>;
}) => {
  const [, saveAction] = useActionState(save, null);
  const [, testAction] = useActionState(test, null);

  return (
    <form action={saveAction}>
      <ActionForm.Submit formAction={testAction}>
        <ActionForm.Idle>Test</ActionForm.Idle>
        <ActionForm.Pending>Testing...</ActionForm.Pending>
      </ActionForm.Submit>
      <ActionForm.Submit formAction={saveAction}>
        <ActionForm.Idle>Save</ActionForm.Idle>
        <ActionForm.Pending>Saving...</ActionForm.Pending>
      </ActionForm.Submit>
    </form>
  );
};

describe("ActionForm", () => {
  it("runs the Action for a submit control outside the form that names its id", async () => {
    render(
      <>
        <ActionForm.Root action={fail} id="outside-form">
          <input name="role" />
        </ActionForm.Root>
        <button form="outside-form" type="submit">
          Confirm
        </button>
      </>
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(screen.getByText("Could not save.")).toBeTruthy();
    });
  });

  it("shows the success message a Server Action returns", async () => {
    render(
      <ActionForm.Root action={succeed}>
        <input name="role" />
        <ActionForm.Submit>Save</ActionForm.Submit>
      </ActionForm.Root>
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("Role updated.")).toBeTruthy();
    });
  });

  it("the submit control shows its idle wording until the Action is in flight", () => {
    render(
      <ActionForm.Root action={succeed}>
        <ActionForm.Submit>
          <ActionForm.Idle>Save</ActionForm.Idle>
          <ActionForm.Pending>Saving...</ActionForm.Pending>
        </ActionForm.Submit>
      </ActionForm.Root>
    );

    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.queryByText("Saving...")).toBeNull();
  });

  it("sends the fields to a control's own formAction and keeps them", async () => {
    const save = vi.fn(succeed);
    const test = vi.fn((_previousState: null, _formData: FormData) =>
      Promise.resolve(null)
    );

    render(<TestedForm save={save} test={test} />);

    fireEvent.change(screen.getByLabelText("Bucket"), {
      target: { value: "archive" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test" }));

    await waitFor(() => {
      expect(test).toHaveBeenCalledOnce();
    });
    expect(test.mock.calls[0]?.[1].get("bucket")).toBe("archive");
    expect(save).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Test" })).toHaveProperty(
        "disabled",
        false
      );
    });
    expect(screen.getByLabelText("Bucket")).toHaveProperty("value", "archive");
  });

  it("sends a control's name and value to its own formAction", async () => {
    const test = vi.fn((_previousState: null, _formData: FormData) =>
      Promise.resolve(null)
    );

    const Form = () => {
      const [, dispatchTest] = useActionState(test, null);

      return (
        <ActionForm.Root action={succeed}>
          <input aria-label="Bucket" defaultValue="media" name="bucket" />
          <ActionForm.Submit
            formAction={dispatchTest}
            name="intent"
            value="test"
          >
            Test
          </ActionForm.Submit>
        </ActionForm.Root>
      );
    };

    render(<Form />);

    fireEvent.click(screen.getByRole("button", { name: "Test" }));

    await waitFor(() => {
      expect(test).toHaveBeenCalledOnce();
    });
    expect(test.mock.calls[0]?.[1].get("intent")).toBe("test");
    expect(test.mock.calls[0]?.[1].get("bucket")).toBe("media");
  });

  it("sends a submit control's name and value to the form's Action", async () => {
    const save = vi.fn((_previousState: unknown, _formData: FormData) =>
      Promise.resolve<ActionForm.State>({ message: "Deleted.", ok: true })
    );

    render(
      <ActionForm.Root action={save}>
        <ActionForm.Submit name="intent" value="delete">
          Delete
        </ActionForm.Submit>
      </ActionForm.Root>
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(save).toHaveBeenCalledOnce();
    });
    expect(save.mock.calls[0]?.[1].get("intent")).toBe("delete");
  });

  it("shows the pending wording of the control whose submission is in flight", async () => {
    const run = Promise.withResolvers<null>();

    render(<TestedForm save={succeed} test={() => run.promise} />);

    fireEvent.click(screen.getByRole("button", { name: "Test" }));

    await waitFor(() => {
      expect(screen.getByText("Testing...")).toBeTruthy();
    });
    expect(screen.getByText("Save")).toBeTruthy();
    expect(screen.queryByText("Saving...")).toBeNull();

    // A transition left open would hold back every later test's Action.
    run.resolve(null);
    await waitFor(() => {
      expect(screen.getByText("Test")).toBeTruthy();
    });
  });

  it("sends a submission no control started to the form's own Action", async () => {
    const save = Promise.withResolvers<ActionForm.State>();
    const test = vi.fn(() => Promise.resolve(null));

    render(<TestedForm save={() => save.promise} test={test} />);

    const form = screen.getByLabelText("Bucket").closest("form");
    if (!form) {
      throw new Error("The field is outside a form.");
    }
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText("Saving...")).toBeTruthy();
    });
    expect(screen.getByText("Test")).toBeTruthy();
    expect(test).not.toHaveBeenCalled();

    save.resolve(null);
    await waitFor(() => {
      expect(screen.getByText("Save")).toBeTruthy();
    });
  });

  it("follows each control's own Action in a plain form", async () => {
    const run = Promise.withResolvers<null>();

    render(
      <PlainTestedForm
        save={() => Promise.resolve(null)}
        test={() => run.promise}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Test" }));

    await waitFor(() => {
      expect(screen.getByText("Testing...")).toBeTruthy();
    });
    expect(screen.getByText("Save")).toBeTruthy();

    run.resolve(null);
    await waitFor(() => {
      expect(screen.getByText("Test")).toBeTruthy();
    });
  });

  it("reports the submission to a control a portal renders outside the form's DOM", async () => {
    const save = Promise.withResolvers<ActionForm.State>();

    render(
      <ActionForm.Root action={() => save.promise} id="portal-form">
        <input aria-label="Name" name="name" />
        {createPortal(
          <ActionForm.Submit form="portal-form">
            <ActionForm.Idle>Save</ActionForm.Idle>
            <ActionForm.Pending>Saving...</ActionForm.Pending>
          </ActionForm.Submit>,
          document.body
        )}
      </ActionForm.Root>
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Saving..." })).toHaveProperty(
        "disabled",
        true
      );
    });

    save.resolve(null);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    });
  });

  it("closes the fields in its fieldset while the Action is in flight", async () => {
    const save = Promise.withResolvers<ActionForm.State>();

    render(
      <ActionForm.Root action={() => save.promise}>
        <ActionForm.Fieldset>
          <input aria-label="Name" name="name" />
        </ActionForm.Fieldset>
        <ActionForm.Submit>Save</ActionForm.Submit>
      </ActionForm.Root>
    );

    expect(screen.getByLabelText("Name").matches(":disabled")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Name").matches(":disabled")).toBe(true);
    });

    // A transition left open would hold back every later test's Action.
    save.resolve(null);
    await waitFor(() => {
      expect(screen.getByLabelText("Name").matches(":disabled")).toBe(false);
    });
  });

  it("names the control and states its toggle", () => {
    render(
      <ActionForm.Root action={succeed}>
        <ActionForm.Submit aria-label="Unfollow Night Train" aria-pressed>
          Unfollow
        </ActionForm.Submit>
      </ActionForm.Root>
    );

    const button = screen.getByRole("button", {
      name: "Unfollow Night Train",
    });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.hasAttribute("aria-busy")).toBe(false);
  });

  it("marks only the control whose submission is in flight as busy", async () => {
    const run = Promise.withResolvers<null>();

    render(<TestedForm save={succeed} test={() => run.promise} />);

    fireEvent.click(screen.getByRole("button", { name: "Test" }));

    await waitFor(() => {
      expect(
        screen
          .getByRole("button", { name: "Testing..." })
          .getAttribute("aria-busy")
      ).toBe("true");
    });
    expect(
      screen.getByRole("button", { name: "Save" }).hasAttribute("aria-busy")
    ).toBe(false);

    // A transition left open would hold back every later test's Action.
    run.resolve(null);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Test" }).hasAttribute("aria-busy")
      ).toBe(false);
    });
  });

  it("hides the success message when showSuccess is false", async () => {
    render(
      <ActionForm.Root action={succeed} showSuccess={false}>
        <input name="role" />
        <ActionForm.Submit>Save</ActionForm.Submit>
      </ActionForm.Root>
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save" })).toHaveProperty(
        "disabled",
        false
      );
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows a failure message when showSuccess is false", async () => {
    render(
      <ActionForm.Root action={fail} showSuccess={false}>
        <input name="role" />
        <ActionForm.Submit>Save</ActionForm.Submit>
      </ActionForm.Root>
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("Could not save.")).toBeTruthy();
    });
  });

  it("keeps the typed values when the Action refuses the submission", async () => {
    render(
      <ActionForm.Root action={fail}>
        <input aria-label="Name" name="name" />
        <ActionForm.Submit>Save</ActionForm.Submit>
      </ActionForm.Root>
    );

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Ada Lovelace" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("Could not save.")).toBeTruthy();
    });
    expect(screen.getByLabelText("Name")).toHaveProperty(
      "value",
      "Ada Lovelace"
    );
  });

  it("resets the fields when the Action succeeds", async () => {
    render(
      <ActionForm.Root action={succeed}>
        <input aria-label="Name" name="name" />
        <ActionForm.Submit>Save</ActionForm.Submit>
      </ActionForm.Root>
    );

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Ada Lovelace" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("Role updated.")).toBeTruthy();
    });
    expect(screen.getByLabelText("Name")).toHaveProperty("value", "");
  });

  it("sends the Action the fields and the submitter's name and value", async () => {
    let received: FormData | undefined;
    const record = (
      _prevState: ActionForm.State,
      formData: FormData
    ): Promise<ActionForm.State> => {
      received = formData;
      return fail();
    };

    render(
      <ActionForm.Root action={record}>
        <input aria-label="Name" name="name" />
        <button name="intent" type="submit" value="publish">
          Publish
        </button>
      </ActionForm.Root>
    );

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Ada Lovelace" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => {
      expect(screen.getByText("Could not save.")).toBeTruthy();
    });
    expect(received?.get("name")).toBe("Ada Lovelace");
    expect(received?.get("intent")).toBe("publish");
  });

  it("places a refused field's error next to that field only", async () => {
    render(
      <ActionForm.Root action={refuseName}>
        <label>
          Name
          <input name="name" />
        </label>
        <div data-testid="name-field">
          <ActionForm.FieldError name="name" />
        </div>
        <div data-testid="slug-field">
          <ActionForm.FieldError name="slug" />
        </div>
        <ActionForm.Submit>Save</ActionForm.Submit>
      </ActionForm.Root>
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByTestId("name-field").textContent).toContain(
        "Enter a shorter name."
      );
    });
    expect(screen.getByTestId("slug-field").textContent).toBe("");
    expect(screen.getByText("Could not save.")).toBeTruthy();
  });

  it("clears a field's error once a submission succeeds", async () => {
    let answer: typeof saveName = refuseName;
    const answerName = (prevState: NameFormState, formData: FormData) =>
      answer(prevState, formData);
    render(
      <ActionForm.Root action={answerName}>
        <input aria-label="Name" name="name" />
        <ActionForm.FieldError name="name" />
        <ActionForm.Submit>Save</ActionForm.Submit>
      </ActionForm.Root>
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByText("Enter a shorter name.")).toBeTruthy();
    });

    answer = saveName;
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByText("Saved.")).toBeTruthy();
    });
    expect(screen.queryByText("Enter a shorter name.")).toBeNull();
  });

  it("lets a component inside the form read the data the Action returned", async () => {
    render(
      <ActionForm.Root action={saveName}>
        <input aria-label="Name" name="name" />
        <SavedName />
        <ActionForm.Submit>Save</ActionForm.Submit>
      </ActionForm.Root>
    );

    expect(screen.getByText("Not saved yet")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "  Ada  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("Saved as Ada")).toBeTruthy();
    });
  });

  it("calls a settled listener once with what each submission returned", async () => {
    const onSettled = vi.fn();
    render(
      <ActionForm.Root action={saveName}>
        <input aria-label="Name" defaultValue="Ada" name="name" />
        <SettledSpy onSettled={onSettled} />
        <ActionForm.Submit>Save</ActionForm.Submit>
      </ActionForm.Root>
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSettled).toHaveBeenCalledOnce();
    });
    expect(onSettled).toHaveBeenCalledWith({
      message: "Saved.",
      name: "Ada",
      ok: true,
    });
  });

  it("does not call a settled listener for a control's own formAction", async () => {
    const onSettled = vi.fn();
    const test = vi.fn(() => Promise.resolve(null));
    const Form = () => {
      const [, dispatchTest] = useActionState(test, null);

      return (
        <ActionForm.Root action={saveName}>
          <input aria-label="Name" defaultValue="Ada" name="name" />
          <SettledSpy onSettled={onSettled} />
          <ActionForm.Submit formAction={dispatchTest}>Test</ActionForm.Submit>
        </ActionForm.Root>
      );
    };

    render(<Form />);

    fireEvent.click(screen.getByRole("button", { name: "Test" }));

    await waitFor(() => {
      expect(test).toHaveBeenCalledOnce();
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Test" })).toHaveProperty(
        "disabled",
        false
      );
    });
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("keeps each row's answer on the row whose form was submitted", async () => {
    render(
      <ul>
        {["first", "second"].map((publicId) => (
          <li data-testid={publicId} key={publicId}>
            <ActionForm.Root action={renameRow}>
              <input name="public_id" type="hidden" value={publicId} />
              <ActionForm.Submit>{`Rename ${publicId}`}</ActionForm.Submit>
            </ActionForm.Root>
          </li>
        ))}
      </ul>
    );

    fireEvent.click(screen.getByRole("button", { name: "Rename second" }));

    await waitFor(() => {
      expect(screen.getByTestId("second").textContent).toContain(
        "Could not rename second."
      );
    });
    expect(screen.getByTestId("first").textContent).toBe("Rename first");
  });

  it("refuses to read the state outside an ActionForm", () => {
    // React reports the thrown render error on the console before rethrowing it.
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => null);

    expect(() => render(<SavedName />)).toThrow(
      "useActionFormState must be rendered inside an ActionForm."
    );
    consoleError.mockRestore();
  });
});
