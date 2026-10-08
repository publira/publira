// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { Checkbox } from "@publira/ui-components/checkbox";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getAdminCurrentUser } from "#lib/admin-auth";

import {
  TenantAdminFieldset,
  TenantAdminOnly,
  TenantAdminRoute,
  TenantEditorFieldset,
  TenantEditorOnly,
  TenantEditorRoute,
} from "./tenant-role-gate";

const { mockNotFound } = vi.hoisted(() => ({
  mockNotFound: vi.fn(() => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: mockNotFound,
  redirect: vi.fn(),
}));

vi.mock("#components/message", () => ({
  Message: ({ message }: { message: MessageKey<SharedMessages> }) =>
    bindMessages(sharedCatalog("en"), "en")(message),
}));

vi.mock("#lib/tenant-id", () => ({
  getTenantId: () => Promise.resolve("TENANT001"),
}));

vi.mock("#lib/admin-auth", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAdminCurrentUser: vi.fn(),
}));

const signedInAs = (role: string) => {
  vi.mocked(getAdminCurrentUser).mockResolvedValue({
    ok: true,
    user: { name: "Operator", publicId: "USER001", role },
  });
};

const EDITOR_ONLY_NOTICE =
  "Only an editor or a tenant admin can change this. You have read-only access.";
const ADMIN_ONLY_NOTICE =
  "Only a tenant administrator can change this setting. You have read-only access.";

const form = <button type="submit">Save</button>;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TenantAdminRoute", () => {
  it("renders the screen for a tenant admin", async () => {
    signedInAs("tenant_admin");

    render(await TenantAdminRoute({ children: <h1>Readers</h1> }));

    expect(screen.getByRole("heading", { name: "Readers" })).toBeTruthy();
  });

  it.each(["tenant_editor", "tenant_auditor"])(
    "answers not found to a %s",
    async (role) => {
      signedInAs(role);

      await expect(
        TenantAdminRoute({ children: <h1>Readers</h1> })
      ).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
      expect(mockNotFound).toHaveBeenCalledOnce();
    }
  );
});

describe("TenantEditorRoute", () => {
  it.each(["tenant_admin", "tenant_editor"])(
    "renders the screen for a %s",
    async (role) => {
      signedInAs(role);

      render(await TenantEditorRoute({ children: <h1>New series</h1> }));

      expect(screen.getByRole("heading", { name: "New series" })).toBeTruthy();
    }
  );

  it("answers not found to a tenant auditor", async () => {
    signedInAs("tenant_auditor");

    await expect(
      TenantEditorRoute({ children: <h1>New series</h1> })
    ).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });
});

describe("TenantAdminOnly", () => {
  it("shows a tenant admin what it wraps", async () => {
    signedInAs("tenant_admin");

    render(await TenantAdminOnly({ children: <span>Members entry</span> }));

    expect(screen.getByText("Members entry")).toBeTruthy();
  });

  it.each(["tenant_editor", "tenant_auditor"])(
    "shows a %s nothing",
    async (role) => {
      signedInAs(role);

      expect(
        await TenantAdminOnly({ children: <span>Members entry</span> })
      ).toBeNull();
    }
  );

  it("shows nothing when the operator could not be read", async () => {
    vi.mocked(getAdminCurrentUser).mockResolvedValue({
      ok: false,
      requiresSignIn: false,
    });

    expect(
      await TenantAdminOnly({ children: <span>Members entry</span> })
    ).toBeNull();
  });
});

describe("TenantEditorOnly", () => {
  it.each(["tenant_admin", "tenant_editor"])(
    "shows a %s what it wraps",
    async (role) => {
      signedInAs(role);

      render(
        await TenantEditorOnly({
          children: <span>New series button</span>,
        })
      );

      expect(screen.getByText("New series button")).toBeTruthy();
    }
  );

  it("shows a tenant auditor nothing", async () => {
    signedInAs("tenant_auditor");

    expect(
      await TenantEditorOnly({
        children: <span>New series button</span>,
      })
    ).toBeNull();
  });
});

describe("TenantEditorFieldset", () => {
  it.each(["tenant_admin", "tenant_editor"])(
    "leaves the form as it is for a %s",
    async (role) => {
      signedInAs(role);

      render(await TenantEditorFieldset({ children: form }));

      expect(
        (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
          .disabled
      ).toBe(false);
      expect(screen.queryByText(EDITOR_ONLY_NOTICE)).toBeNull();
    }
  );

  it("disables the form for a tenant auditor under a notice", async () => {
    signedInAs("tenant_auditor");

    render(await TenantEditorFieldset({ children: form }));

    expect(
      (
        screen.getByRole("button", { name: "Save" }) as HTMLButtonElement
      ).matches(":disabled")
    ).toBe(true);
    expect(screen.getByRole("status").textContent).toContain(
      EDITOR_ONLY_NOTICE
    );
  });

  // Base UI renders a checkbox as a `<span>`, which a disabled `<fieldset>`
  // alone does not reach: it would still toggle under the auditor's click.
  it("keeps a tenant auditor from ticking a checkbox", async () => {
    signedInAs("tenant_auditor");

    render(
      await TenantEditorFieldset({
        children: <Checkbox aria-label="Show in footer" defaultChecked />,
      })
    );

    const checkbox = screen.getByRole("checkbox", { name: "Show in footer" });
    fireEvent.click(checkbox);

    expect(checkbox.getAttribute("aria-checked")).toBe("true");
    expect(checkbox.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("TenantAdminFieldset", () => {
  it("leaves the form as it is for a tenant admin", async () => {
    signedInAs("tenant_admin");

    render(await TenantAdminFieldset({ children: form }));

    expect(
      (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
    expect(screen.queryByText(ADMIN_ONLY_NOTICE)).toBeNull();
  });

  it.each(["tenant_editor", "tenant_auditor"])(
    "disables the form for a %s under a notice",
    async (role) => {
      signedInAs(role);

      render(await TenantAdminFieldset({ children: form }));

      expect(
        (
          screen.getByRole("button", { name: "Save" }) as HTMLButtonElement
        ).matches(":disabled")
      ).toBe(true);
      expect(screen.getByRole("status").textContent).toContain(
        ADMIN_ONLY_NOTICE
      );
    }
  );
});
