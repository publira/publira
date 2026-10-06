// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import {
  cleanup,
  fireEvent,
  render as renderBase,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";
import { listReaderOptionsAction } from "#lib/reader-options-action";

import { ReaderPicker } from "./reader-picker";

vi.mock("#components/client-message", () => ({
  ClientMessage: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
  useClientMessages: () => bindMessages(sharedCatalog("en"), "en"),
}));

vi.mock("#lib/use-tenant-id", () => ({
  useTenantId: () => "TENANT001",
}));

vi.mock("#lib/reader-options-action", () => ({
  listReaderOptionsAction: vi.fn(),
}));

vi.mock("@publira/ui-components/combobox", async () => {
  const { Input } = await import("@publira/ui-components/input");

  return {
    // Typing both searches, where the picker searches, and picks the typed
    // value, so one field stands in for the text box and the list.
    Combobox: ({
      items,
      onSearch,
      onValueChange,
      value,
    }: {
      items: { label: string; value: string }[];
      onSearch?: (query: string) => void;
      onValueChange: (next: string) => void;
      value: string;
    }) => (
      <>
        <Input
          aria-label="Reader"
          onChange={(event) => {
            onSearch?.(event.target.value);
            onValueChange(event.target.value);
          }}
          value={value}
        />
        {items.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </>
    ),
    // The mocked root stands in for the whole control, so its slots render
    // nothing.
    ComboboxEmpty: () => null,
    ComboboxInput: () => null,
    ComboboxItems: () => null,
    ComboboxPopup: () => null,
  };
});

const mockListReaderOptionsAction = vi.mocked(listReaderOptionsAction);

const readerOne = {
  email: "one@example.com",
  id: "018f0e6a-5000-7000-8000-000000000001",
  name: "Reader One",
};

const render = (ui: ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleTestProvider locale="en">{children}</AdminLocaleTestProvider>
    ),
  });

const readerCombobox = () => screen.getByLabelText("Reader");

afterEach(() => {
  cleanup();
});

describe("ReaderPicker", () => {
  beforeEach(() => {
    mockListReaderOptionsAction.mockReset();
    mockListReaderOptionsAction.mockResolvedValue({ ok: true, readers: [] });
  });

  it("searches the tenant's readers with what the operator types", async () => {
    mockListReaderOptionsAction.mockResolvedValue({
      ok: true,
      readers: [readerOne],
    });

    render(<ReaderPicker name="reader_id" />);

    fireEvent.change(readerCombobox(), { target: { value: "one" } });

    await waitFor(() => {
      expect(mockListReaderOptionsAction).toHaveBeenCalledWith(
        "TENANT001",
        "one",
        "en"
      );
    });
    expect(
      await screen.findByRole("option", {
        name: "Reader One (one@example.com)",
      })
    ).toBeDefined();
  });

  it("searches once typing pauses rather than on every keystroke", async () => {
    vi.useFakeTimers();
    try {
      render(<ReaderPicker name="reader_id" />);

      fireEvent.change(readerCombobox(), { target: { value: "o" } });
      await vi.advanceTimersByTimeAsync(100);
      fireEvent.change(readerCombobox(), { target: { value: "on" } });
      await vi.advanceTimersByTimeAsync(100);
      fireEvent.change(readerCombobox(), { target: { value: "one" } });
      await vi.advanceTimersByTimeAsync(100);
      expect(mockListReaderOptionsAction).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(300);

      expect(mockListReaderOptionsAction).toHaveBeenCalledOnce();
      expect(mockListReaderOptionsAction).toHaveBeenCalledWith(
        "TENANT001",
        "one",
        "en"
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows why a search failed", async () => {
    mockListReaderOptionsAction.mockResolvedValue({
      message: "Could not load the readers.",
      ok: false,
      readers: [],
    });

    render(<ReaderPicker name="reader_id" />);

    fireEvent.change(readerCombobox(), { target: { value: "one" } });

    expect(
      await screen.findByText("Could not load the readers.")
    ).toBeDefined();
  });

  it("submits the chosen reader's internal ID under its name and reports it", () => {
    const onValueChange = vi.fn();

    const { container } = render(
      <form>
        <ReaderPicker name="reader_id" onValueChange={onValueChange} />
      </form>
    );

    fireEvent.change(readerCombobox(), { target: { value: readerOne.id } });

    const form = container.querySelector("form");
    expect(form && new FormData(form).get("reader_id")).toBe(readerOne.id);
    expect(onValueChange).toHaveBeenCalledWith(readerOne.id);
  });
});
