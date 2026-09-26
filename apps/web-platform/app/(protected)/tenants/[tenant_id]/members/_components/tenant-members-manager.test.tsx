// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MessageProps } from "#components/message";
import { getMessagesFor } from "#lib/messages";
import type { PlatformMessageAccessor } from "#lib/messages";
import type { PlatformTenantMemberSummary } from "#lib/tenants";

import { TenantMembersManager } from "./tenant-members-manager";

const state = vi.hoisted(() => ({
  t: undefined as PlatformMessageAccessor | undefined,
}));

// `<Message>` is an async Server Component that only the Next.js compiler can
// render. The catalog is the real one, resolved ahead so the tree renders
// without suspending.
vi.mock("#components/message", () => ({
  Message: ({ message, values }: MessageProps) => state.t?.(message, values),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const actions = vi.hoisted(() => ({
  addTenantMemberAction: vi.fn(),
  cancelTenantAdminInvitationAction: vi.fn(),
  createTenantAdminInvitationAction: vi.fn(),
  removeTenantMemberAction: vi.fn(),
  resendTenantAdminInvitationAction: vi.fn(),
  updateTenantMemberRoleAction: vi.fn(),
}));

vi.mock("../../_lib/actions", () => actions);

const tenantId = "SeedTNNTAAA1";

const member: PlatformTenantMemberSummary = {
  createdAt: "2026-06-01T00:00:00Z",
  email: "editor@tenant.example",
  name: "Avery Editor",
  role: "tenant_editor",
  status: "active",
  userPublicId: "SeedUSERAAA1",
};

const renderManager = async () =>
  render(
    await TenantMembersManager({
      invitations: [],
      locale: "en",
      members: [member],
      tenantId,
      timeZone: "UTC",
    })
  );

beforeEach(async () => {
  state.t = await getMessagesFor("en");
});

afterEach(() => {
  cleanup();
  for (const action of Object.values(actions)) {
    action.mockReset();
  }
});

const membersRow = () => screen.getByRole("row", { name: /Avery Editor/u });

describe("TenantMembersManager", () => {
  it("closes the role dialog once the role is saved", async () => {
    actions.updateTenantMemberRoleAction.mockResolvedValue({
      message: "Role updated.",
      ok: true,
    });
    await renderManager();

    fireEvent.click(
      within(membersRow()).getByRole("button", { name: "Change role" })
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("radio", { name: "Tenant admin" })
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Change role" })
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    const formData: FormData =
      actions.updateTenantMemberRoleAction.mock.calls[0]?.[1];
    expect(formData.get("member_role")).toBe("tenant_admin");
    expect(formData.get("member_user_public_id")).toBe(member.userPublicId);
    expect(formData.get("tenant_id")).toBe(tenantId);
  });

  it("keeps the role dialog open with the reason when the save is refused", async () => {
    actions.updateTenantMemberRoleAction.mockResolvedValue({
      message: "Could not update the role.",
      ok: false,
    });
    await renderManager();

    fireEvent.click(
      within(membersRow()).getByRole("button", { name: "Change role" })
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Change role" })
    );

    expect(
      await within(dialog).findByText("Could not update the role.")
    ).toBeTruthy();
    expect(screen.getByRole("dialog")).toBe(dialog);
  });

  it("reports a removal above the list rather than on the row it removes", async () => {
    actions.removeTenantMemberAction.mockResolvedValue({
      message: "Member removed.",
      ok: true,
    });
    await renderManager();

    fireEvent.click(
      within(membersRow()).getByRole("button", { name: "Remove" })
    );
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    const message = await screen.findByText("Member removed.");
    expect(membersRow().contains(message)).toBe(false);
    const formData: FormData =
      actions.removeTenantMemberAction.mock.calls[0]?.[1];
    expect(formData.get("member_user_public_id")).toBe(member.userPublicId);
    expect(formData.get("tenant_id")).toBe(tenantId);
  });

  it("keeps a refused removal on its own row", async () => {
    actions.removeTenantMemberAction.mockResolvedValue({
      message: "Could not remove the member.",
      ok: false,
    });
    await renderManager();

    fireEvent.click(
      within(membersRow()).getByRole("button", { name: "Remove" })
    );
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    expect(
      await within(membersRow()).findByText("Could not remove the member.")
    ).toBeTruthy();
  });
});
