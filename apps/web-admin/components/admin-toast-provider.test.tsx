// @vitest-environment jsdom

import * as Toast from "@publira/ui-components/toast";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import { AdminToastProvider } from "./admin-toast-provider";

const RaiseButton = () => {
  const { add } = Toast.useManager();

  return (
    <button onClick={() => add({ title: "Saved" })} type="button">
      Save
    </button>
  );
};

describe("AdminToastProvider", () => {
  it("names each toast's close control with the console's label", async () => {
    render(
      <AdminLocaleTestProvider locale="en">
        <AdminToastProvider>
          <RaiseButton />
        </AdminToastProvider>
      </AdminLocaleTestProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    // Base UI hides the close control until the stack is expanded.
    fireEvent.mouseEnter(
      await screen.findByRole("region", { name: "Notifications" })
    );

    expect(await screen.findByRole("button", { name: "Close" })).toBeInstanceOf(
      HTMLButtonElement
    );
  });
});
