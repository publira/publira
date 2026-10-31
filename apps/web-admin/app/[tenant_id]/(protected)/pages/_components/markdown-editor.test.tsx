// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import { MarkdownEditor } from "./markdown-editor";

const renderEditor = async (defaultValue: string) => {
  await act(() => {
    render(
      <AdminLocaleTestProvider locale="en">
        <form>
          <MarkdownEditor
            aria-label="Content"
            defaultValue={defaultValue}
            name="content_markdown"
          />
        </form>
      </AdminLocaleTestProvider>
    );
  });

  const textbox = await screen.findByRole("textbox", { name: "Content" });
  // SAFETY: Tiptap sets `editor` on the element it mounts the editor in, and
  // the check below refuses a textbox without one.
  const { editor } = textbox as HTMLElement & { editor?: Editor };

  if (!editor) {
    throw new Error("The textbox is not the editor's.");
  }

  return { editor, textbox };
};

const postedBody = (): FormDataEntryValue | null => {
  const form = document.querySelector("form");

  if (!form) {
    throw new Error("The editor is not inside a form.");
  }

  return new FormData(form).get("content_markdown");
};

// jsdom lays nothing out, and a range has no boxes to measure: ProseMirror
// measures the caret to scroll it into view after a command.
beforeAll(() => {
  Object.defineProperties(Range.prototype, {
    getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
    getClientRects: { configurable: true, value: () => [] },
  });
});

afterAll(() => {
  Reflect.deleteProperty(Range.prototype, "getClientRects");
  Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
});

afterEach(() => {
  cleanup();
});

describe("MarkdownEditor", () => {
  it("shows the Markdown it is given as formatted text", async () => {
    await renderEditor("## Contact\n\nWrite to **us**.");

    expect(
      screen.getByRole("heading", { level: 2, name: "Contact" })
    ).toBeDefined();
    expect(screen.getByText("us").tagName).toBe("STRONG");
  });

  // The editor would write this body back as `- one`, and the save would then
  // record a version nobody wrote.
  it("posts the body it was given untouched until it is edited", async () => {
    const body = "* one\n* two\n";
    await renderEditor(body);

    expect(postedBody()).toBe(body);
  });

  it("posts an edit as Markdown", async () => {
    const { editor } = await renderEditor("Saved body.");

    await act(() => {
      editor.commands.setContent("Edited body.", { contentType: "markdown" });
    });

    expect(postedBody()).toBe("Edited body.");
  });

  it("formats the paragraph the caret is in from the toolbar", async () => {
    const { editor } = await renderEditor("Contact");

    await act(() => {
      editor.commands.setTextSelection(1);
    });
    const heading = screen.getByRole("button", { name: "Heading" });
    expect(heading.getAttribute("aria-pressed")).toBe("false");

    await act(() => {
      fireEvent.click(heading);
    });

    expect(postedBody()).toBe("## Contact");
    expect(heading.getAttribute("aria-pressed")).toBe("true");
  });

  it("links the selected words to the address entered", async () => {
    const { editor } = await renderEditor("Read the terms.");

    // "terms", counted from the start of the paragraph.
    await act(() => {
      editor.commands.setTextSelection({ from: 10, to: 15 });
    });
    await act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Link" }));
    });
    fireEvent.change(await screen.findByRole("textbox", { name: "Link URL" }), {
      target: { value: "https://example.com/terms" },
    });
    await act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });

    expect(postedBody()).toBe("Read the [terms](https://example.com/terms).");
  });

  it("keeps a table and a task list it has no button for", async () => {
    const { editor } = await renderEditor(
      "| Name | Value |\n| --- | --- |\n| a | 1 |\n\n- [x] done\n"
    );

    await act(() => {
      editor.commands.setTextSelection(1);
      editor.commands.insertContent("Plan ");
    });

    const posted = String(postedBody());
    expect(posted).toMatch(/^\| Plan Name +\| Value +\|$/mu);
    expect(posted).toContain("- [x] done");
  });
});
