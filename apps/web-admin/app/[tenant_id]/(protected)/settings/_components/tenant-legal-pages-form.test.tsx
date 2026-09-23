// @vitest-environment jsdom

import { sharedCatalog } from "@publira/i18n/catalog";
import {
  cleanup,
  fireEvent,
  render as renderBase,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleProvider } from "#components/admin-locale-context";

import { TenantLegalPagesForm } from "./tenant-legal-pages-form";

vi.mock("next/navigation", () => ({
  useParams: () => ({ tenant_id: "TENANT001" }),
}));

const noopAction = vi.fn();

const render = (ui: ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleProvider locale="en" messages={sharedCatalog("en")}>
        {children}
      </AdminLocaleProvider>
    ),
  });

const termsPage = { pageId: "page-1", slug: "terms", title: "Terms" };
const privacyPage = { pageId: "page-2", slug: "privacy", title: "Privacy" };
const aboutPage = { pageId: "page-3", slug: "about", title: "About us" };

const termsInput = () =>
  screen.getByLabelText<HTMLInputElement>("Terms of service");
const privacyInput = () =>
  screen.getByLabelText<HTMLInputElement>("Privacy policy");
const hiddenValue = (container: HTMLElement, name: string) =>
  container.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value;
const submitButton = () =>
  screen.getByRole<HTMLButtonElement>("button", {
    name: "Save the terms and privacy policy",
  });

afterEach(() => {
  cleanup();
});

describe("TenantLegalPagesForm", () => {
  it("shows each saved nomination and submits its page id", () => {
    const { container } = render(
      <TenantLegalPagesForm
        action={noopAction}
        canEdit
        initialPages={{
          privacyPage: { ...privacyPage, published: true },
          termsPage: { ...termsPage, published: true },
        }}
        publishedPages={[aboutPage, privacyPage, termsPage]}
      />
    );

    expect(termsInput().value).toBe("Terms (terms)");
    expect(privacyInput().value).toBe("Privacy (privacy)");
    expect(hiddenValue(container, "terms_page_id")).toBe("page-1");
    expect(hiddenValue(container, "privacy_page_id")).toBe("page-2");
    expect(submitButton().disabled).toBe(false);
  });

  it("shows a tenant that has nominated nothing as None", () => {
    const { container } = render(
      <TenantLegalPagesForm
        action={noopAction}
        canEdit
        initialPages={{}}
        publishedPages={[termsPage]}
      />
    );

    expect(termsInput().value).toBe("None");
    expect(privacyInput().value).toBe("None");
    expect(hiddenValue(container, "terms_page_id")).toBe("");
    expect(hiddenValue(container, "privacy_page_id")).toBe("");
  });

  it("offers None and every published page to choose from", async () => {
    render(
      <TenantLegalPagesForm
        action={noopAction}
        canEdit
        initialPages={{}}
        publishedPages={[aboutPage, termsPage]}
      />
    );

    fireEvent.click(termsInput());
    fireEvent.keyDown(termsInput(), { key: "ArrowDown" });

    expect(await screen.findByRole("option", { name: "None" })).toBeDefined();
    expect(
      screen.getByRole("option", { name: "About us (about)" })
    ).toBeDefined();
    expect(screen.getByRole("option", { name: "Terms (terms)" })).toBeDefined();
  });

  // The storefront links to nothing for an unpublished page, so showing it
  // like any other selection would read as a working setting.
  it("reports a nominated page that has been unpublished", () => {
    render(
      <TenantLegalPagesForm
        action={noopAction}
        canEdit
        initialPages={{
          privacyPage: { ...privacyPage, published: false },
          termsPage: { ...termsPage, published: true },
        }}
        publishedPages={[termsPage]}
      />
    );

    expect(privacyInput().value).toBe("Privacy (privacy) — unpublished");
    expect(
      screen.getByText(
        "“Privacy” is no longer published, so nothing links to it. Publish it again or choose another page."
      )
    ).toBeDefined();
    expect(screen.queryAllByText(/is no longer published/u)).toHaveLength(1);
  });

  it("shows the saved page to a read-only member, who gets no page list", () => {
    render(
      <TenantLegalPagesForm
        action={noopAction}
        canEdit={false}
        initialPages={{ termsPage: { ...termsPage, published: true } }}
        publishedPages={[]}
      />
    );

    expect(termsInput().value).toBe("Terms (terms)");
    expect(termsInput().disabled).toBe(true);
    expect(submitButton().disabled).toBe(true);
    expect(
      screen.getByText(
        "Only a tenant administrator can change this setting. You have read-only access."
      )
    ).toBeDefined();
  });

  // Saving without the stored nominations would clear them, and without the
  // page list the pickers could offer nothing but None.
  it.each([
    {
      loadErrorMessage:
        "Could not load the terms and privacy policy. Please try again later.",
      read: "the nominations",
    },
    {
      pagesErrorMessage: "Could not load the page. Please try again later.",
      read: "the page list",
    },
  ])(
    "closes editing when $read could not be read",
    ({
      loadErrorMessage,
      pagesErrorMessage,
    }: {
      loadErrorMessage?: string;
      pagesErrorMessage?: string;
    }) => {
      render(
        <TenantLegalPagesForm
          action={noopAction}
          canEdit
          initialPages={loadErrorMessage ? undefined : {}}
          loadErrorMessage={loadErrorMessage}
          pagesErrorMessage={pagesErrorMessage}
          publishedPages={[]}
        />
      );

      expect(termsInput().disabled).toBe(true);
      expect(privacyInput().disabled).toBe(true);
      expect(submitButton().disabled).toBe(true);
      expect(
        screen.getByText(loadErrorMessage ?? pagesErrorMessage ?? "")
      ).toBeDefined();
    }
  );
});
