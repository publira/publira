// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render as renderBase,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleProvider } from "#components/admin-locale-context";

import type { TenantCommentModeActionState } from "../settings-types";
import { TenantCommentModeForm } from "./tenant-comment-mode-form";

vi.mock("next/navigation", () => ({
  useParams: () => ({ tenant_id: "TENANT001" }),
}));

const noopAction = vi.fn();

const render = (ui: ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleProvider locale="en">{children}</AdminLocaleProvider>
    ),
  });

const submitButton = () =>
  screen.getByRole<HTMLButtonElement>("button", {
    name: "Save how comments are published",
  });

afterEach(() => {
  cleanup();
});

describe("TenantCommentModeForm", () => {
  it("offers the three modes and marks the saved one", () => {
    render(
      <TenantCommentModeForm
        action={noopAction}
        canEdit
        initialCommentMode="approval_required"
      />
    );

    const radios = screen.getAllByRole("radio");

    expect(radios).toHaveLength(3);
    expect(
      screen
        .getByRole("radio", { name: /Publish after approval/u })
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(
      screen
        .getByRole("radio", { name: /Publish straight away/u })
        .getAttribute("aria-checked")
    ).toBe("false");
  });

  // Each mode says what a reader ends up experiencing, so the choice is not a
  // guess about what "approval" does to the storefront.
  it("explains what each mode means for readers", () => {
    render(
      <TenantCommentModeForm
        action={noopAction}
        canEdit
        initialCommentMode="disabled"
      />
    );

    expect(
      screen.getByText(
        "Episode pages show no comment section, and a comment cannot be posted."
      )
    ).toBeDefined();
    expect(
      screen.getByText(
        "A comment is readable by everyone from the moment it is posted."
      )
    ).toBeDefined();
    expect(
      screen.getByText(
        "Only its author sees a comment until a moderator approves it."
      )
    ).toBeDefined();
  });

  it("stays read-only for someone who is not a tenant admin", () => {
    render(
      <TenantCommentModeForm
        action={noopAction}
        canEdit={false}
        initialCommentMode="immediate"
      />
    );

    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.getAttribute("aria-disabled")).toBe("true");
    }
    expect(submitButton().disabled).toBe(true);
    expect(
      screen.getByText(
        "Only a tenant administrator can change this setting. You have read-only access."
      )
    ).toBeDefined();
  });

  it("blocks editing and shows the reason when the fetch fails", () => {
    render(
      <TenantCommentModeForm
        action={noopAction}
        canEdit
        loadErrorMessage="Could not load how comments are published."
      />
    );

    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.getAttribute("aria-disabled")).toBe("true");
    }
    expect(submitButton().disabled).toBe(true);
    expect(
      screen.getByText(/Could not load how comments are published./u)
    ).toBeDefined();
    expect(
      screen.getByText(/Saving now would overwrite the stored setting/u)
    ).toBeDefined();
  });

  // The Action carries the mode the form held when it was submitted, so an
  // option picked while it is in flight would sit selected under the success
  // message while the tenant is still on the other one.
  it("closes the options while the save is in flight", async () => {
    // Never resolved: the assertions are about the window the save is open in.
    const save = Promise.withResolvers<TenantCommentModeActionState>();
    const pendingAction = vi.fn(() => save.promise);

    render(
      <TenantCommentModeForm
        action={pendingAction}
        canEdit
        initialCommentMode="disabled"
      />
    );

    // An enabled radio carries no `aria-disabled` at all rather than "false".
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.getAttribute("aria-disabled")).toBeNull();
    }

    fireEvent.click(submitButton());

    await waitFor(() => {
      for (const radio of screen.getAllByRole("radio")) {
        expect(radio.getAttribute("aria-disabled")).toBe("true");
      }
    });
  });
});
