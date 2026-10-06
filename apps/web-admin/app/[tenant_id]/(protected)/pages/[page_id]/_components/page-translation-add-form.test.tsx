// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PageFormState } from "../../page-types";
import { PageTranslationAddForm } from "./page-translation-add-form";

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

afterEach(() => {
  cleanup();
});

const renderForm = async (
  action: (state: PageFormState, formData: FormData) => Promise<PageFormState>
) => {
  await act(() => {
    render(
      <PageTranslationAddForm
        action={action}
        pageId="PAGE001"
        tenantId="TENANT001"
        translationLocale="en"
      />
    );
  });
};

describe("PageTranslationAddForm", () => {
  it("names the language the page has no translation in", async () => {
    await renderForm(() => Promise.resolve(null));

    expect(
      screen.getByRole("heading", { name: "No English translation yet" })
    ).toBeDefined();
  });

  it("submits the title for the translation in that locale", async () => {
    const action = vi.fn<
      (state: PageFormState, formData: FormData) => Promise<PageFormState>
    >(() => Promise.resolve(null));
    await renderForm(action);

    fireEvent.change(screen.getByRole("textbox", { name: /Title/u }), {
      target: { value: "Privacy policy" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add translation" }));
      await Promise.resolve();
    });

    const formData = action.mock.calls[0]?.[1];
    expect(formData?.get("page_id")).toBe("PAGE001");
    expect(formData?.get("translation_locale")).toBe("en");
    expect(formData?.get("title")).toBe("Privacy policy");
  });

  it("shows why the translation could not be added", async () => {
    await renderForm(() =>
      Promise.resolve({
        message:
          "This page already has a translation in that language. Reload the page.",
        ok: false,
      })
    );

    fireEvent.change(screen.getByRole("textbox", { name: /Title/u }), {
      target: { value: "Privacy policy" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add translation" }));
      await Promise.resolve();
    });

    expect(
      await screen.findByText(
        "This page already has a translation in that language. Reload the page."
      )
    ).toBeDefined();
  });
});
