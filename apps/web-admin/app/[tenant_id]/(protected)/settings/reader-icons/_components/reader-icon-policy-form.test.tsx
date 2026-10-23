// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import type * as ActionForm from "@publira/ui-components/action-form";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReaderIconPolicyForm } from "./reader-icon-policy-form";

const { save } = vi.hoisted(() => ({
  save: {
    current: Promise.withResolvers<ActionForm.State>(),
    formData: undefined as FormData | undefined,
  },
}));

vi.mock("../_lib/actions", () => ({
  updateReaderIconPolicyAction: (_state: unknown, formData: FormData) => {
    save.formData = formData;
    return save.current.promise;
  },
}));

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

const SUBMIT = "Save the reader icon policy";

const renderCard = async (ui: ReactNode) => {
  render(ui);
  await screen.findByRole("button", { name: SUBMIT });
};

const submitButton = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: SUBMIT });

afterEach(() => {
  cleanup();
  // A submission left in flight would hold back the next test's transitions.
  save.current.resolve(null);
  save.current = Promise.withResolvers<ActionForm.State>();
  save.formData = undefined;
});

describe("ReaderIconPolicyForm", () => {
  it("offers the three policies and marks the saved one", async () => {
    await renderCard(
      <ReaderIconPolicyForm canEdit initialPolicy="preset" tenantId="T1" />
    );

    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(
      screen
        .getByRole("radio", { name: /Choose a preset icon/u })
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(
      screen
        .getByRole("radio", { name: /Upload their own image/u })
        .getAttribute("aria-checked")
    ).toBe("false");
  });

  // Upload allows every icon, so saving it takes none down.
  it("saves the upload policy straight away", async () => {
    await renderCard(
      <ReaderIconPolicyForm canEdit initialPolicy="preset" tenantId="T1" />
    );

    fireEvent.click(screen.getByRole("radio", { name: /Upload their own/u }));
    fireEvent.click(submitButton());

    await waitFor(() => {
      expect(save.formData?.get("reader_icon_policy")).toBe("upload");
    });
    expect(save.formData?.get("tenant_id")).toBe("T1");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks before a save that removes the uploaded icons", async () => {
    await renderCard(
      <ReaderIconPolicyForm canEdit initialPolicy="upload" tenantId="T1" />
    );

    fireEvent.click(screen.getByRole("radio", { name: /Choose a preset/u }));
    fireEvent.click(submitButton());

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain(
      "Saving removes any image readers uploaded as their icon"
    );
    expect(save.formData).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: "Save and remove" }));

    await waitFor(() => {
      expect(save.formData?.get("reader_icon_policy")).toBe("preset");
    });
  });

  it("warns that turning icons off removes every icon", async () => {
    await renderCard(
      <ReaderIconPolicyForm canEdit initialPolicy="preset" tenantId="T1" />
    );

    fireEvent.click(screen.getByRole("radio", { name: /No icons/u }));
    fireEvent.click(submitButton());

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain(
      "Saving removes any icon readers show"
    );
  });

  // The server clears against the policy stored when the save lands, which
  // another administrator may have widened since this card was drawn, so the
  // question does not depend on the policy the card shows as saved.
  it.each([
    ["disabled", /Choose a preset/u],
    ["preset", /Choose a preset/u],
    ["disabled", /No icons/u],
  ] as const)(
    "asks even when the card shows %s as saved",
    async (initialPolicy, option) => {
      await renderCard(
        <ReaderIconPolicyForm
          canEdit
          initialPolicy={initialPolicy}
          tenantId="T1"
        />
      );

      fireEvent.click(screen.getByRole("radio", { name: option }));
      fireEvent.click(submitButton());

      expect(await screen.findByRole("alertdialog")).toBeDefined();
      expect(save.formData).toBeUndefined();
    }
  );

  it("stays read-only for someone who is not a tenant admin", async () => {
    await renderCard(
      <ReaderIconPolicyForm
        canEdit={false}
        initialPolicy="upload"
        tenantId="T1"
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

  it("blocks editing and shows the reason when the read fails", async () => {
    await renderCard(
      <ReaderIconPolicyForm
        canEdit
        loadErrorMessage="Could not load the reader icon policy."
        tenantId="T1"
      />
    );

    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.getAttribute("aria-disabled")).toBe("true");
    }
    expect(submitButton().disabled).toBe(true);
    expect(
      screen.getByText(/Saving now would overwrite the stored policy/u)
    ).toBeDefined();
  });
});
