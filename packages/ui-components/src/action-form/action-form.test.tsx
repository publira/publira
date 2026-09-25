// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useActionState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "./action-form";
import type { FormActionState } from "./action-form";

afterEach(cleanup);

const succeed = (): Promise<FormActionState> =>
  Promise.resolve({
    message: "Role updated.",
    ok: true,
  });

const fail = (): Promise<FormActionState> =>
  Promise.resolve({
    message: "Could not save.",
    ok: false,
  });

/** A save form with a connection test that sends the same field elsewhere. */
const TestedForm = ({
  save,
  test,
}: {
  save: () => Promise<FormActionState>;
  test: (previousState: null, formData: FormData) => Promise<null>;
}) => {
  const [, dispatchTest] = useActionState(test, null);

  return (
    <ActionForm action={save}>
      <input aria-label="Bucket" defaultValue="media" name="bucket" />
      <ActionFormSubmit formAction={dispatchTest}>
        <ActionFormIdle>Test</ActionFormIdle>
        <ActionFormPending>Testing...</ActionFormPending>
      </ActionFormSubmit>
      <ActionFormSubmit>
        <ActionFormIdle>Save</ActionFormIdle>
        <ActionFormPending>Saving...</ActionFormPending>
      </ActionFormSubmit>
    </ActionForm>
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
      <ActionFormSubmit formAction={testAction}>
        <ActionFormIdle>Test</ActionFormIdle>
        <ActionFormPending>Testing...</ActionFormPending>
      </ActionFormSubmit>
      <ActionFormSubmit formAction={saveAction}>
        <ActionFormIdle>Save</ActionFormIdle>
        <ActionFormPending>Saving...</ActionFormPending>
      </ActionFormSubmit>
    </form>
  );
};

describe("ActionForm", () => {
  it("runs the Action for a submit control outside the form that names its id", async () => {
    render(
      <>
        <ActionForm action={fail} id="outside-form">
          <input name="role" />
        </ActionForm>
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
      <ActionForm action={succeed}>
        <input name="role" />
        <ActionFormSubmit>Save</ActionFormSubmit>
      </ActionForm>
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("Role updated.")).toBeTruthy();
    });
  });

  it("the submit control shows its idle wording until the Action is in flight", () => {
    render(
      <ActionForm action={succeed}>
        <ActionFormSubmit>
          <ActionFormIdle>Save</ActionFormIdle>
          <ActionFormPending>Saving...</ActionFormPending>
        </ActionFormSubmit>
      </ActionForm>
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
    const save = Promise.withResolvers<FormActionState>();
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

  it("closes the fields in its fieldset while the Action is in flight", async () => {
    const save = Promise.withResolvers<FormActionState>();

    render(
      <ActionForm action={() => save.promise}>
        <ActionFormFieldset>
          <input aria-label="Name" name="name" />
        </ActionFormFieldset>
        <ActionFormSubmit>Save</ActionFormSubmit>
      </ActionForm>
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

  it("hides the success message when showSuccess is false", async () => {
    render(
      <ActionForm action={succeed} showSuccess={false}>
        <input name="role" />
        <ActionFormSubmit>Save</ActionFormSubmit>
      </ActionForm>
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
      <ActionForm action={fail} showSuccess={false}>
        <input name="role" />
        <ActionFormSubmit>Save</ActionFormSubmit>
      </ActionForm>
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("Could not save.")).toBeTruthy();
    });
  });

  it("keeps the typed values when the Action refuses the submission", async () => {
    render(
      <ActionForm action={fail}>
        <input aria-label="Name" name="name" />
        <ActionFormSubmit>Save</ActionFormSubmit>
      </ActionForm>
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
      <ActionForm action={succeed}>
        <input aria-label="Name" name="name" />
        <ActionFormSubmit>Save</ActionFormSubmit>
      </ActionForm>
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
      _prevState: FormActionState,
      formData: FormData
    ): Promise<FormActionState> => {
      received = formData;
      return fail();
    };

    render(
      <ActionForm action={record}>
        <input aria-label="Name" name="name" />
        <button name="intent" type="submit" value="publish">
          Publish
        </button>
      </ActionForm>
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
});
