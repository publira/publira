// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import {
  act,
  cleanup,
  fireEvent,
  render as renderBase,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import type {
  PageFormState,
  PageListItem,
  PageVersionListItem,
} from "../page-types";
import { PageWorkspace } from "./page-workspace";

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

const noopFormAction = () => Promise.resolve();
const noopSaveAction = () => Promise.resolve(null);

const page: PageListItem = {
  createdAt: "2030-01-01T00:00:00Z",
  displayInFooter: false,
  id: "PAGE001",
  locale: "en",
  publishedVersionId: "VERSION001",
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
  publishedAt: "2030-01-01T00:00:00Z",
  status: "published",
  versionNumber: 1,
};

const renderWorkspace = async (
  saveAction: () => Promise<PageFormState> = noopSaveAction,
  initialPage: PageListItem = page
) => {
  await act(() => {
    renderBase(
      <AdminLocaleTestProvider locale="en">
        <PageWorkspace
          initialPage={initialPage}
          initialVersions={[version]}
          locale="en"
          publishAction={noopFormAction}
          rollbackAction={noopFormAction}
          saveAction={saveAction}
          tenantId="TENANT001"
          timeZone="UTC"
          unpublishAction={noopFormAction}
        />
      </AdminLocaleTestProvider>
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
  it("keeps every form on the translation it shows", async () => {
    await renderWorkspace();

    const forms = [...document.querySelectorAll("form")];

    // Save, unpublish, and the version row's publish and roll back.
    expect(forms).toHaveLength(4);
    for (const form of forms) {
      expect(new FormData(form).get("translation_locale")).toBe("en");
    }
  });

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

  it.each([true, false])(
    "shows Show in footer as stored (%s) and saves it with the page",
    async (displayInFooter) => {
      await renderWorkspace(noopSaveAction, { ...page, displayInFooter });

      const form = editForm();
      const checkbox = screen.getByRole("checkbox", { name: "Show in footer" });

      expect(checkbox.getAttribute("aria-checked")).toBe(
        String(displayInFooter)
      );
      expect(new FormData(form).get("initial_display_in_footer")).toBe(
        String(displayInFooter)
      );

      fireEvent.click(checkbox);

      expect(new FormData(form).get("display_in_footer")).toBe(
        String(!displayInFooter)
      );
    }
  );

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
    const save = Promise.withResolvers<PageFormState>();
    await renderWorkspace(() => save.promise);

    for (const control of submittedControls()) {
      expect(control.matches(":disabled")).toBe(false);
    }

    fireEvent.click(screen.getByRole("button", { name: "Save page" }));

    await waitFor(() => {
      for (const control of submittedControls()) {
        expect(control.matches(":disabled")).toBe(true);
      }
    });

    // A submission left in flight would hold back the next test's transitions.
    await act(async () => {
      save.resolve(null);
      await save.promise;
    });
  });
  it("puts a version's body back in the editor", async () => {
    await renderWorkspace();

    const body = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: /Content/u,
    });
    fireEvent.change(body, { target: { value: "Unsaved body." } });
    fireEvent.click(screen.getByRole("button", { name: "Load content" }));

    expect(body.value).toBe(version.contentMarkdown);
  });

  it("opens loading a version again once a refused save returns", async () => {
    const save = Promise.withResolvers<PageFormState>();
    await renderWorkspace(() => save.promise);

    fireEvent.click(screen.getByRole("button", { name: "Save page" }));
    const load = screen.getByRole<HTMLButtonElement>("button", {
      name: "Load content",
    });
    await waitFor(() => {
      expect(load.disabled).toBe(true);
    });

    await act(async () => {
      save.resolve({ message: "Could not save.", ok: false });
      await save.promise;
    });

    expect(await screen.findByText("Could not save.")).toBeDefined();
    expect(load.disabled).toBe(false);
  });
});
