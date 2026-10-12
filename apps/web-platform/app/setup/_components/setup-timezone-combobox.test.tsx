// @vitest-environment jsdom

import { ComboboxItems, ComboboxPopup } from "@publira/ui-components/combobox";
import { cleanup, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SetupTimezoneCombobox } from "./setup-timezone-combobox";

vi.mock("#components/client-message", () => ({
  useClientMessages: () => (message: string) => message,
}));

const field = (
  <SetupTimezoneCombobox>
    <ComboboxPopup>
      <ComboboxItems />
    </ComboboxPopup>
  </SetupTimezoneCombobox>
);

const postedTimezone = (container: ParentNode) =>
  container.querySelector<HTMLInputElement>('input[name="default_timezone"]')
    ?.value;

/** `timeZone` left out is a browser that reports no zone at all. */
const reportBrowserTimeZone = (timeZone?: string) => {
  const resolvedOptions = Intl.DateTimeFormat().resolvedOptions();
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    ...resolvedOptions,
    timeZone: timeZone as string,
  });
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SetupTimezoneCombobox", () => {
  it("posts the zone the browser runs in", () => {
    reportBrowserTimeZone("Asia/Tokyo");

    const { container } = render(field);

    expect(postedTimezone(container)).toBe("Asia/Tokyo");
  });

  it("posts UTC when the browser reports no zone", () => {
    reportBrowserTimeZone();

    const { container } = render(field);

    expect(postedTimezone(container)).toBe("UTC");
  });

  it("posts UTC when the browser reports a zone the API would refuse", () => {
    reportBrowserTimeZone("Local");

    const { container } = render(field);

    expect(postedTimezone(container)).toBe("UTC");
  });

  it("renders UTC on the server, which is what a form without JavaScript posts", () => {
    reportBrowserTimeZone("Asia/Tokyo");

    const rendered = new DOMParser().parseFromString(
      renderToString(field),
      "text/html"
    );

    expect(postedTimezone(rendered)).toBe("UTC");
  });
});
