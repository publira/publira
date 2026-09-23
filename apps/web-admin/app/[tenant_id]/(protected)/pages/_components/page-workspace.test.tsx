// @vitest-environment jsdom

import { sharedCatalog } from "@publira/i18n/catalog";
import {
  act,
  cleanup,
  fireEvent,
  render as renderBase,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleProvider } from "#components/admin-locale-context";

import type {
  PageFormState,
  PageListItem,
  PageVersionListItem,
} from "../page-types";
import { PageWorkspace } from "./page-workspace";

vi.mock("#lib/use-tenant-id", () => ({
  useTenantId: () => "TENANT001",
}));

const noopFormAction = () => Promise.resolve();
const noopSaveAction = () => Promise.resolve(null);

const page: PageListItem = {
  createdAt: "2030-01-01T00:00:00Z",
  displayInFooter: false,
  id: "PAGE001",
  publishedVersionId: "",
  slug: "/privacy",
  title: "Privacy policy",
  updatedAt: "2030-01-01T00:00:00Z",
};

const version: PageVersionListItem = {
  authorUserId: "USER001",
  contentMarkdown: "# Privacy policy\n\nSaved body.",
  createdAt: "2030-01-01T00:00:00Z",
  id: "VERSION001",
  pageId: page.id,
  publishAt: "",
  publishedAt: "",
  status: "draft",
  versionNumber: 1,
};

const renderWorkspace = async (
  saveAction: () => Promise<PageFormState> = noopSaveAction
) => {
  await act(() => {
    renderBase(
      <AdminLocaleProvider locale="en" messages={sharedCatalog("en")}>
        <PageWorkspace
          initialPage={page}
          initialVersions={[version]}
          publishAction={noopFormAction}
          rollbackAction={noopFormAction}
          saveAction={saveAction}
          timeZone="UTC"
          unpublishAction={noopFormAction}
        />
      </AdminLocaleProvider>
    );
  });
};

const editForm = (): HTMLFormElement => {
  const form = screen
    .getByRole("textbox", { name: /Title/u })
    .closest("form") as HTMLFormElement | null;
  if (!form) {
    throw new Error("The title field is not inside a form.");
  }

  return form;
};

afterEach(() => {
  cleanup();
});

const submittedControls = () => [
  screen.getByRole<HTMLInputElement>("textbox", { name: /Title/u }),
  screen.getByRole<HTMLTextAreaElement>("textbox", { name: /Content/u }),
  screen.getByRole<HTMLButtonElement>("button", { name: "Load content" }),
];

describe("PageWorkspace", () => {
  it("saves the title and the body through one control", async () => {
    await renderWorkspace();

    const form = editForm();

    expect(screen.getByRole("textbox", { name: /Content/u })).toBe(
      form.querySelector("textarea[name='content_markdown']")
    );
    expect(form.querySelectorAll("button[type='submit']")).toHaveLength(1);
    expect(
      await screen.findByRole("button", { name: "Save page" })
    ).toBeDefined();
  });

  it("keeps the editor submittable while the preview tab is showing", async () => {
    await renderWorkspace();

    const form = editForm();
    fireEvent.click(await screen.findByRole("tab", { name: "Preview" }));

    expect(new FormData(form).get("content_markdown")).toBe(
      version.contentMarkdown
    );
  });

  it("previews the body that has not been saved yet", async () => {
    await renderWorkspace();

    fireEvent.change(screen.getByRole("textbox", { name: /Content/u }), {
      target: { value: "# Privacy policy\n\nUnsaved body." },
    });
    fireEvent.click(await screen.findByRole("tab", { name: "Preview" }));

    expect(screen.getByText("Unsaved body.")).toBeDefined();
    expect(screen.queryByText("Saved body.")).toBeNull();
  });

  // The Action carries the title and the body the form held when it was
  // submitted, so an edit made while it is in flight — typed, or loaded from a
  // version — would sit in the editor unsaved.
  it("closes the title, the body, and loading a version while the save is in flight", async () => {
    // Never resolved: the assertions are about the window the save is open in.
    const save = Promise.withResolvers<PageFormState>();
    await renderWorkspace(() => save.promise);

    for (const control of submittedControls()) {
      expect(control.disabled).toBe(false);
    }

    fireEvent.click(screen.getByRole("button", { name: "Save page" }));

    await waitFor(() => {
      for (const control of submittedControls()) {
        expect(control.disabled).toBe(true);
      }
    });
  });
});
