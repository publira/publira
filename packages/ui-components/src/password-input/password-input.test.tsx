// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as PasswordInput from ".";
import * as Field from "../field";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const renderPasswordInput = () =>
  render(
    <form>
      <Field.Root>
        <Field.Label>Password</Field.Label>
        <Field.Content>
          <PasswordInput.Root>
            <PasswordInput.Control
              autoComplete="new-password"
              name="password"
              required
            />
            <PasswordInput.Toggle>Show password</PasswordInput.Toggle>
          </PasswordInput.Root>
        </Field.Content>
      </Field.Root>
    </form>
  );

const getInput = () => screen.getByLabelText<HTMLInputElement>("Password");
const getToggle = () => screen.getByRole("button", { name: "Show password" });

describe("PasswordInput", () => {
  it("starts masked, with the toggle not pressed", () => {
    renderPasswordInput();

    expect(getInput().type).toBe("password");
    expect(getToggle().getAttribute("aria-pressed")).toBe("false");
  });

  it("reveals the value and masks it again", () => {
    renderPasswordInput();
    fireEvent.change(getInput(), { target: { value: "correct horse" } });

    fireEvent.click(getToggle());

    expect(getInput().type).toBe("text");
    expect(getToggle().getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(getToggle());

    expect(getInput().type).toBe("password");
    expect(getToggle().getAttribute("aria-pressed")).toBe("false");
  });

  // `aria-pressed` is what says whether the password is shown; a name that
  // changed with it would announce the state twice.
  it("keeps the same accessible name in both states", () => {
    renderPasswordInput();

    fireEvent.click(getToggle());

    expect(getToggle().textContent).toBe("Show password");
  });

  // Chromium moves the caret to the start of the box after the click has been
  // handled, so the selection is put back on the next frame.
  it("keeps the typed value, the caret, and the autocomplete hint", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((frame) => {
      frames.push(frame);

      return frames.length;
    });
    renderPasswordInput();
    const input = getInput();
    fireEvent.change(input, { target: { value: "correct horse" } });
    input.setSelectionRange(3, 7);

    fireEvent.click(getToggle());
    input.setSelectionRange(0, 0);

    for (const frame of frames) {
      frame(0);
    }

    expect(getInput()).toBe(input);
    expect(input.value).toBe("correct horse");
    expect(input.selectionStart).toBe(3);
    expect(input.selectionEnd).toBe(7);
    expect(input.getAttribute("autocomplete")).toBe("new-password");
    expect(input.name).toBe("password");
  });

  // A pointer press that took focus would pull the caret out of the box the
  // person is typing in.
  it("does not take focus from the box on a pointer press", () => {
    renderPasswordInput();

    const pressed = fireEvent.mouseDown(getToggle());

    expect(pressed).toBe(false);
  });

  it("is a button that does not submit the form", () => {
    renderPasswordInput();

    expect(getToggle().getAttribute("type")).toBe("button");
  });

  it("masks the value again when the form is submitted", () => {
    const { container } = renderPasswordInput();
    fireEvent.click(getToggle());

    // SAFETY: `renderPasswordInput` renders the input inside a `<form>`.
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    expect(getInput().type).toBe("password");
    expect(getToggle().getAttribute("aria-pressed")).toBe("false");
  });

  // Screens that do not use `Field` point a plain `<label>` at the box by id.
  it("keeps the id a label outside a Field points at", () => {
    render(
      <>
        <label htmlFor="currentPassword">Current password</label>
        <PasswordInput.Root>
          <PasswordInput.Control id="currentPassword" />
          <PasswordInput.Toggle>Show password</PasswordInput.Toggle>
        </PasswordInput.Root>
      </>
    );

    expect(
      screen.getByLabelText<HTMLInputElement>("Current password").type
    ).toBe("password");
  });

  it("reveals each field on its own", () => {
    render(
      <>
        <PasswordInput.Root>
          <PasswordInput.Control aria-label="New password" />
          <PasswordInput.Toggle>Show new password</PasswordInput.Toggle>
        </PasswordInput.Root>
        <PasswordInput.Root>
          <PasswordInput.Control aria-label="Confirm password" />
          <PasswordInput.Toggle>Show confirmation</PasswordInput.Toggle>
        </PasswordInput.Root>
      </>
    );

    fireEvent.click(screen.getByRole("button", { name: "Show new password" }));

    expect(screen.getByLabelText<HTMLInputElement>("New password").type).toBe(
      "text"
    );
    expect(
      screen.getByLabelText<HTMLInputElement>("Confirm password").type
    ).toBe("password");
  });
});
