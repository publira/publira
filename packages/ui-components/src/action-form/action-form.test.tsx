// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ActionForm, ActionFormSubmit } from "./action-form";
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
  it("shows the success message a Server Action returns", async () => {
    render(
      <ActionForm action={succeed} submitLabel="Save">
        <input name="role" />
      </ActionForm>
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("Role updated.")).toBeTruthy();
    });
  });

  it("shows the success message when the submit control is ActionFormSubmit", async () => {
    render(
      <ActionForm action={succeed}>
        <ActionFormSubmit>Save</ActionFormSubmit>
      </ActionForm>
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("Role updated.")).toBeTruthy();
    });
  });

  it("hides the success message when showSuccess is false", async () => {
    render(
      <ActionForm action={succeed} showSuccess={false} submitLabel="Save">
        <input name="role" />
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
      <ActionForm action={fail} showSuccess={false} submitLabel="Save">
        <input name="role" />
      </ActionForm>
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("Could not save.")).toBeTruthy();
    });
  });
});
