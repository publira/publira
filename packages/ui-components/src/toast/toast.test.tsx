// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import * as Toast from ".";

const RaiseButton = () => {
  const { add } = Toast.useManager();

  return (
    <button onClick={() => add({ title: "Saved" })} type="button">
      Save
    </button>
  );
};

describe("Toast", () => {
  it("draws the close control the provider is given, named by its label once the stack is expanded, and closes the toast with it", async () => {
    render(
      <Toast.Provider close={<Toast.Close aria-label="Close" />}>
        <RaiseButton />
      </Toast.Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // Base UI hides the close control from assistive technology until the
    // stack is expanded, which a pointer over it or focus inside it does.
    fireEvent.mouseEnter(
      await screen.findByRole("region", { name: "Notifications" })
    );

    const close = await screen.findByRole("button", { name: "Close" });
    expect(close.textContent).toBe("");
    expect(close.querySelector("svg")).not.toBeNull();
    expect(screen.getByText("Saved")).toBeTruthy();

    fireEvent.click(close);

    await waitFor(() => {
      expect(screen.queryByText("Saved")).toBeNull();
    });
  });
});
