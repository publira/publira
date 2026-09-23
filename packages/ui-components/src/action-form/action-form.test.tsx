// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  ActionForm,
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
