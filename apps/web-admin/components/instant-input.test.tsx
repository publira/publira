// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { InstantInput } from "./instant-input";

const posted = (form: HTMLFormElement, name: string) =>
  new FormData(form).get(name);

afterEach(() => {
  cleanup();
});

describe("InstantInput", () => {
  it("posts the wall clock as an instant in the time zone on screen", () => {
    const { container } = render(
      <form>
        <InstantInput name="publish_at" timeZone="America/Los_Angeles" />
      </form>
    );
    const form = container.querySelector("form") as HTMLFormElement;

    fireEvent.change(
      form.querySelector("input[name='publish_at_local']") as Element,
      { target: { value: "2099-06-01T10:00" } }
    );

    // PDT (UTC-7) in June — 10:00 in Los Angeles is 17:00Z.
    expect(posted(form, "publish_at")).toBe("2099-06-01T17:00:00Z");
  });

  it("opens on the stored instant as a wall clock in that zone", () => {
    const { container } = render(
      <form>
        <InstantInput
          initialValue="2099-06-01T17:00:00Z"
          name="publish_at"
          timeZone="America/Los_Angeles"
        />
      </form>
    );
    const form = container.querySelector("form") as HTMLFormElement;

    expect(posted(form, "publish_at_local")).toBe("2099-06-01T10:00");
    expect(posted(form, "publish_at")).toBe("2099-06-01T17:00:00Z");
  });

  it("posts an empty instant for an empty wall clock", () => {
    const { container } = render(
      <form>
        <InstantInput
          initialValue="2099-06-01T17:00:00Z"
          name="publish_at"
          timeZone="UTC"
        />
      </form>
    );
    const form = container.querySelector("form") as HTMLFormElement;

    fireEvent.change(
      form.querySelector("input[name='publish_at_local']") as Element,
      { target: { value: "" } }
    );

    expect(posted(form, "publish_at")).toBe("");
  });
});
