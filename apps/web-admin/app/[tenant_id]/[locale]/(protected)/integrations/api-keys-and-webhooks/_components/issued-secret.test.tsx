// @vitest-environment jsdom

import * as ActionForm from "@publira/ui-components/action-form";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { IssuedSecretFormState } from "../api-keys-and-webhooks-types";
import * as IssuedSecret from "./issued-secret";

afterEach(() => {
  cleanup();
});

/** A form whose Action answers each submission with the next of `states`. */
const renderForm = (states: IssuedSecretFormState[]) => {
  const pending = [...states];

  render(
    <ActionForm.Root<NonNullable<IssuedSecretFormState>>
      action={() => Promise.resolve(pending.shift() ?? null)}
    >
      <ActionForm.Submit>Create</ActionForm.Submit>
      <IssuedSecret.Root>
        <IssuedSecret.Title>Your new API key</IssuedSecret.Title>
        <IssuedSecret.Value aria-label="Copy the API key" />
      </IssuedSecret.Root>
    </ActionForm.Root>
  );

  const { form } = screen.getByRole<HTMLButtonElement>("button", {
    name: "Create",
  });

  if (!form) {
    throw new Error("the button belongs to no form");
  }

  return form;
};

describe("IssuedSecret", () => {
  it("shows nothing before the form succeeds", () => {
    renderForm([]);

    expect(screen.queryByText("Your new API key")).toBeNull();
  });

  it("shows the value the Action answered, and takes it away on the next submission", async () => {
    const form = renderForm([
      { message: "Created.", ok: true, secret: "pbk_abcdefghijkl_secret" },
      { message: "Could not create.", ok: false },
    ]);

    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText("pbk_abcdefghijkl_secret")).toBeTruthy();
    });
    expect(screen.getByText("Your new API key")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Copy the API key" })
    ).toBeTruthy();

    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.queryByText("pbk_abcdefghijkl_secret")).toBeNull();
    });
    expect(screen.queryByText("Your new API key")).toBeNull();
  });
});
