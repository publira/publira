// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useActionState } from "react";
import { describe, expect, it } from "vitest";

import { FormMessage } from "./form-message";

const ActionForm = () => {
  const [count, formAction] = useActionState(
    (previous: number) => previous + 1,
    0
  );

  return (
    <form action={formAction}>
      <FormMessage variant={count % 2 === 0 ? "success" : "destructive"}>
        {`Message ${count}`}
      </FormMessage>
      <button type="submit">Submit</button>
    </form>
  );
};

describe("FormMessage", () => {
  it("shows the status role and the info icon by default", () => {
    render(<FormMessage>Saved</FormMessage>);

    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(screen.getByText("i")).toBeTruthy();
  });

  it("shows the icon for the success variant", () => {
    render(<FormMessage variant="success">Done</FormMessage>);

    expect(screen.getByText("✓")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
  });

  it("the body updates across consecutive Action submissions", async () => {
    // React resets the form once the Action settles. With <output>, a
    // resettable element, that reset collapses the body, so the second and
    // later updates never reach the DOM.
    render(<ActionForm />);

    const submit = screen.getByRole("button", { name: "Submit" });

    fireEvent.click(submit);
    await waitFor(() => {
      expect(screen.getByText("Message 1")).toBeTruthy();
    });

    fireEvent.click(submit);
    await waitFor(() => {
      expect(screen.getByText("Message 2")).toBeTruthy();
    });
  });
});
