// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CreateAnnouncementActionState } from "../announcement-types";
import { AnnouncementForm } from "./announcement-form";

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"))(message, values),
}));

vi.mock("#lib/get-messages", () => ({
  getMessages: () => Promise.resolve(bindMessages(sharedCatalog("en"))),
}));

/**
 * Whether a control refuses input, whichever way it says so. A native control
 * its `<fieldset>` closes keeps `disabled` false and matches `:disabled`, and
 * the banner checkbox is a Base UI one that says so with `aria-disabled`.
 */
const isClosed = (element: HTMLElement) =>
  element.matches(":disabled") ||
  element.getAttribute("aria-disabled") === "true";

afterEach(() => {
  cleanup();
});

const submittedControls = () => [
  screen.getByRole("textbox", { name: /Title/u }),
  screen.getByRole("textbox", { name: /Body/u }),
  screen.getByRole("textbox", { name: "Link" }),
  screen.getByRole("checkbox", { name: "Show as a site banner" }),
];

const fillIn = () => {
  fireEvent.change(screen.getByRole("textbox", { name: /Title/u }), {
    target: { value: "Maintenance tonight" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: /Body/u }), {
    target: { value: "The site is down from 22:00 to 23:00 UTC." },
  });
};

describe("AnnouncementForm", () => {
  // The Action carries what the form held when it was submitted, so a change
  // made while it is in flight would not be the announcement that goes out.
  it("closes every field while the delivery is in flight", async () => {
    // Never resolved: the assertions are about the window the save is open in.
    const delivery = Promise.withResolvers<CreateAnnouncementActionState>();
    const pendingAction = vi.fn(() => delivery.promise);

    render(
      await AnnouncementForm({
        action: pendingAction,
        tenantId: "TENANT001",
        timeZone: "UTC",
      })
    );
    fillIn();

    for (const control of submittedControls()) {
      expect(isClosed(control)).toBe(false);
    }

    fireEvent.click(
      screen.getByRole("button", { name: "Deliver the announcement" })
    );

    await waitFor(() => {
      for (const control of submittedControls()) {
        expect(isClosed(control)).toBe(true);
      }
    });
  });

  it("posts the banner's stop time as an instant in the tenant's zone", async () => {
    const action = vi.fn(() =>
      Promise.resolve<CreateAnnouncementActionState>(null)
    );

    const { container } = render(
      await AnnouncementForm({
        action,
        tenantId: "TENANT001",
        timeZone: "Asia/Tokyo",
      })
    );
    fillIn();

    expect(container.querySelector("input[name='pinned_until']")).toBeNull();

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Show as a site banner" })
    );
    fireEvent.change(
      container.querySelector("input[name='pinned_until_local']") as Element,
      { target: { value: "2099-06-01T09:00" } }
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Deliver the announcement" })
    );

    await waitFor(() => {
      expect(action).toHaveBeenCalledOnce();
    });
    const [, formData] = action.mock.calls[0] as unknown as [
      CreateAnnouncementActionState,
      FormData,
    ];
    expect(formData.get("tenant_id")).toBe("TENANT001");
    expect(formData.get("pinned")).toBe("on");
    expect(formData.get("pinned_until")).toBe("2099-06-01T00:00:00Z");
  });
});
