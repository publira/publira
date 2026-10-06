// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import type { LabelActionState, LabelListItem } from "../label-types";
import { LabelForm } from "./label-form";

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

vi.mock("#lib/get-messages", () => ({
  getMessages: () => Promise.resolve(bindMessages(sharedCatalog("en"), "en")),
}));

const action = () => Promise.resolve(null);

const label: LabelListItem = {
  eyeCatchImageUpdatedAt: "",
  eyeCatchImageVariants: [],
  id: "label-1",
  name: "Existing Label",
  publicId: "LABEL001",
};

/**
 * Next.js keeps recently visited pages mounted inside a hidden `<Activity>`
 * for its router bfcache, so the create form and the edit form are in the
 * document at the same time.
 */
const renderBothForms = async () => {
  const [createForm, updateForm] = await Promise.all([
    LabelForm({ action, mode: "create", tenantId: "TENANT001" }),
    LabelForm({
      action,
      initialLabel: label,
      mode: "update",
      tenantId: "TENANT001",
    }),
  ]);

  render(
    <>
      {createForm}
      {updateForm}
    </>
  );
};

afterEach(() => {
  cleanup();
});

it("keeps the ids unique when it is mounted twice", async () => {
  await renderBothForms();

  const ids = [...document.querySelectorAll("[id]")].map(
    (element) => element.id
  );

  expect(ids.length).toBeGreaterThan(0);
  expect(ids).toHaveLength(new Set(ids).size);
});

it("points each label at its own input when it is mounted twice", async () => {
  await renderBothForms();

  const names = screen.getAllByLabelText<HTMLInputElement>(/Label name/u);

  expect(names).toHaveLength(2);
  expect(names.map((input) => input.value)).toEqual(["", label.name]);
});

// The Action carries the name and the image the form held when it was
// submitted, so a change made while it is in flight would not be the label
// that gets created.
it("closes the fields while the save is in flight", async () => {
  // Never resolved: the assertions are about the window the save is open in.
  const save = Promise.withResolvers<LabelActionState>();
  const pendingAction = vi.fn(() => save.promise);

  render(
    await LabelForm({
      action: pendingAction,
      mode: "create",
      tenantId: "TENANT001",
    })
  );

  const name = screen.getByLabelText<HTMLInputElement>(/Label name/u);
  const image = screen.getByLabelText<HTMLInputElement>("Label cover image");
  fireEvent.change(name, { target: { value: "Monthly Novels" } });

  expect(name.matches(":disabled")).toBe(false);
  expect(image.matches(":disabled")).toBe(false);

  fireEvent.click(screen.getByRole("button", { name: "Create label" }));

  await waitFor(() => {
    expect(name.matches(":disabled")).toBe(true);
    expect(image.matches(":disabled")).toBe(true);
  });
  expect(pendingAction).toHaveBeenCalledOnce();
  const [, formData] = pendingAction.mock.calls[0] as unknown as [
    LabelActionState,
    FormData,
  ];
  expect(formData.get("tenant_id")).toBe("TENANT001");
  expect(formData.get("name")).toBe("Monthly Novels");
});
