// @vitest-environment jsdom

import { cleanup, render as renderBase, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleProvider } from "#components/admin-locale-context";

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
});
