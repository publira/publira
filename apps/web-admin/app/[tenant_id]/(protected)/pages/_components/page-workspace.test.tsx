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
import type { Editor } from "@tiptap/react";
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
  agreementRequiredAt: "",
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

const draft: PageVersionListItem = {
  ...version,
  contentMarkdown: "# Privacy policy\n\nRevised body.",
  id: "VERSION002",
  publishedAt: "",
  status: "draft",
  versionNumber: 2,
};

const workspace = (
  saveAction: () => Promise<PageFormState>,
  initialPage: PageListItem,
  {
    asksReadersToAgree = false,
    versions = [version],
  }: { asksReadersToAgree?: boolean; versions?: PageVersionListItem[] } = {}
) => (
  <AdminLocaleTestProvider locale="en">
    <PageWorkspace
      asksReadersToAgree={asksReadersToAgree}
      initialPage={initialPage}
      initialVersions={versions}
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

const renderWorkspace = async (
  saveAction: () => Promise<PageFormState> = noopSaveAction,
  initialPage: PageListItem = page,
  options?: Parameters<typeof workspace>[2]
) => {
  const rendered = await act(() =>
    renderBase(workspace(saveAction, initialPage, options))
  );

  // The editor is built once the screen has mounted.
  await screen.findByRole("textbox", { name: "Content" });

  return rendered;
};

/** The editor behind the body's textbox, to write into it as a writer would. */
const bodyEditor = (): Editor => {
  // SAFETY: Tiptap sets `editor` on the element it mounts the editor in, and
  // the check below refuses a textbox without one.
  const { editor } = screen.getByRole("textbox", {
    name: "Content",
  }) as HTMLElement & { editor?: Editor };

  if (!editor) {
    throw new Error("The body's textbox is not an editor.");
  }

  return editor;
};

const editForm = (): HTMLFormElement => {
  const form = screen.getByRole("textbox", { name: /Title/u }).closest("form");

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
  screen.getByRole<HTMLButtonElement>("button", { name: "Load content" }),
];

/** Whether the body's editor takes input; ProseMirror says so on the element. */
const bodyIsEditable = () =>
  screen
    .getByRole("textbox", { name: "Content" })
    .getAttribute("contenteditable") === "true";

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

    expect(
      form.contains(screen.getByRole("textbox", { name: "Content" }))
    ).toBe(true);
    expect(new FormData(form).get("content_markdown")).toBe(
      version.contentMarkdown
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

  // A save re-renders the screen with what the server stored, and the box has
  // to start from that rather than from the value it first mounted with.
  it("follows a stored Show in footer that changed under it", async () => {
    const { rerender } = await renderWorkspace(noopSaveAction, page);

    await act(() => {
      rerender(workspace(noopSaveAction, { ...page, displayInFooter: true }));
    });

    expect(
      screen
        .getByRole("checkbox", { name: "Show in footer" })
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(new FormData(editForm()).get("initial_display_in_footer")).toBe(
      "true"
    );
  });

  it("saves the body as it was edited, in Markdown", async () => {
    await renderWorkspace();

    await act(() => {
      bodyEditor().commands.setContent("# Privacy policy\n\nUnsaved body.", {
        contentType: "markdown",
      });
    });

    expect(new FormData(editForm()).get("content_markdown")).toBe(
      "# Privacy policy\n\nUnsaved body."
    );
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

    expect(bodyIsEditable()).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Save page" }));

    await waitFor(() => {
      for (const control of submittedControls()) {
        expect(control.matches(":disabled")).toBe(true);
      }

      expect(bodyIsEditable()).toBe(false);
    });

    // A submission left in flight would hold back the next test's transitions.
    await act(async () => {
      save.resolve(null);
      await save.promise;
    });
  });
  it("puts a version's body back in the editor", async () => {
    await renderWorkspace();

    await act(() => {
      bodyEditor().commands.setContent("Unsaved body.", {
        contentType: "markdown",
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Load content" }));

    // The editor starts over from the version, so it is a new one.
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Content" }).textContent).toBe(
        "Privacy policySaved body."
      );
    });
    expect(new FormData(editForm()).get("content_markdown")).toBe(
      version.contentMarkdown
    );
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

  it("publishes at once on a page readers do not agree to", async () => {
    await renderWorkspace(noopSaveAction, page, { versions: [draft, version] });

    const [publish] = screen.getAllByRole("button", { name: "Publish" });

    expect(publish).toHaveProperty("type", "submit");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks whether readers agree again before publishing the terms", async () => {
    await renderWorkspace(noopSaveAction, page, {
      asksReadersToAgree: true,
      versions: [draft, version],
    });

    const [publish] = screen.getAllByRole("button", { name: "Publish" });
    expect(publish).toHaveProperty("type", "button");
    await act(() => {
      fireEvent.click(publish);
    });

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Publish v2");

    const ask = screen.getByRole<HTMLButtonElement>("button", {
      name: "Publish and ask readers to agree",
    });

    const correction = screen.getByRole<HTMLButtonElement>("button", {
      name: "Publish without asking",
    });

    for (const [button, value] of [
      [ask, "true"],
      [correction, "false"],
    ] as const) {
      expect(button.type).toBe("submit");
      expect(button.getAttribute("form")).toBe(
        "publish-page-version-VERSION002"
      );
      expect(button.name).toBe("require_agreement");
      expect(button.value).toBe(value);
    }
  });

  it("marks a version whose publication asked readers to agree", async () => {
    await renderWorkspace(noopSaveAction, page, {
      versions: [{ ...version, agreementRequiredAt: "2030-01-02T00:00:00Z" }],
    });

    expect(screen.getByText("Readers asked to agree")).toBeTruthy();
  });
});
