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
  within,
} from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContactMessageFilterForm } from "./contact-message-filter-form";

vi.mock("#lib/messages", () => ({
  getMessagesFor: () => Promise.resolve(bindMessages(sharedCatalog("en"))),
}));

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"))(message, values),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: React.ComponentProps<"a">) => (
    <a href={href}>{children}</a>
  ),
}));

afterEach(() => {
  cleanup();
});

describe("ContactMessageFilterForm", () => {
  it("filters by each of the three states, with every state first", async () => {
    render(
      await ContactMessageFilterForm({
        filters: { status: "", token: "" },
        locale: "en",
      })
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Status" }));
    const labels = within(await screen.findByRole("listbox"))
      .getAllByRole("option")
      .map((option) => option.textContent);

    expect(labels).toEqual([
      "Every status",
      "Unhandled",
      "In progress",
      "Handled",
    ]);
  });

  it("submits the state the inbox is filtered by", async () => {
    const { container } = render(
      await ContactMessageFilterForm({
        filters: { status: "in_progress", token: "" },
        locale: "en",
      })
    );

    const form = container.querySelector("form");
    expect(form ? new FormData(form).get("status") : null).toBe("in_progress");
    expect(screen.getByRole("combobox", { name: "Status" }).textContent).toBe(
      "In progress"
    );
  });
});
