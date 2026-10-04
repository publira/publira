// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import {
  cleanup,
  fireEvent,
  render as renderBase,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import type { BulkEditEpisodeCreditsActionState } from "../episode-types";
import { EpisodeCreditsRangeForm } from "./episode-credits-range-form";
import { EpisodeSelectionProvider } from "./episode-selection";

vi.mock("#lib/use-tenant-id", () => ({
  useTenantId: () => "TENANT001",
}));

// Rendered through `Input`, the stand-in is the control its Field names.
vi.mock("@publira/ui-components/combobox", async () => {
  const { Input } = await import("@publira/ui-components/input");

  return {
    Combobox: ({
      disabled,
      items,
      onValueChange,
      value,
    }: {
      disabled?: boolean;
      items: { label: string; value: string }[];
      onValueChange: (next: string) => void;
      value: string;
    }) => (
      <Input
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.value)}
        render={
          <select>
            <option value="">-</option>
            {items.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        }
        value={value}
      />
    ),
    ComboboxEmpty: () => null,
    ComboboxInput: () => null,
    ComboboxItems: () => null,
    ComboboxPopup: () => null,
  };
});

vi.mock("@publira/ui-components/checkbox", () => ({
  Checkbox: ({
    checked,
    disabled,
    id,
    onCheckedChange,
  }: {
    checked?: boolean;
    disabled?: boolean;
    id?: string;
    onCheckedChange?: (checked: boolean) => void;
  }) => (
    <input
      checked={checked === true}
      disabled={disabled}
      id={id}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
      type="checkbox"
    />
  ),
}));

vi.mock("@publira/ui-components/dialog", () => ({
  DialogClose: ({ render }: { render: ReactNode }) => render,
  DialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

const t = bindMessages(sharedCatalog("en"));

const episodes = Array.from({ length: 40 }, (_, index) => ({
  id: `EP${String(index + 1).padStart(2, "0")}-ID`,
  publicId: `EP${String(index + 1).padStart(2, "0")}`,
  title: `Episode ${index + 1}`,
}));

const creators = [
  { id: "CREATOR_B", name: "Artist B" },
  { id: "CREATOR_C", name: "Artist C" },
];

const creatorRoles = [{ id: "ROLE_ARTIST", name: "Artist" }];

const render = ({
  action = () => Promise.resolve(null),
  formEpisodes = episodes,
  initialSelectedIds = [],
}: {
  action?: (
    prevState: BulkEditEpisodeCreditsActionState,
    formData: FormData
  ) => Promise<BulkEditEpisodeCreditsActionState>;
  formEpisodes?: typeof episodes;
  initialSelectedIds?: readonly string[];
} = {}) =>
  renderBase(
    <EpisodeCreditsRangeForm
      action={action}
      creatorRoles={creatorRoles}
      creators={creators}
      episodes={formEpisodes}
      isEpisodePending={false}
      onRetryEpisodes={() => {}}
      seriesId="SERIES001"
    />,
    {
      wrapper: ({ children }) => (
        <AdminLocaleTestProvider locale="en">
          <EpisodeSelectionProvider initialSelectedIds={initialSelectedIds}>
            {children}
          </EpisodeSelectionProvider>
        </AdminLocaleTestProvider>
      ),
    }
  );

const episodeCheckbox = (publicId: string, title: string) =>
  screen.getByRole<HTMLInputElement>("checkbox", {
    name: t("admin.series.episodes.credits.episode_option", {
      id: publicId,
      title,
    }),
  });

const authorPickers = () =>
  screen.getAllByRole<HTMLSelectElement>("combobox", { name: "Author" });
const applyButton = () => screen.getByRole("button", { name: "Apply" });

afterEach(cleanup);

/**
 * Whether a control refuses input. A native control its `<fieldset>`
 * closes matches `:disabled`, and a Base UI radio says so with
 * `aria-disabled`.
 */
const isClosed = (element: HTMLElement) =>
  element.matches(":disabled") ||
  element.getAttribute("aria-disabled") === "true";

const submittedControls = () => [
  ...screen.getAllByRole("radio"),
  ...authorPickers(),
  episodeCheckbox("EP01", "Episode 1"),
  episodeCheckbox("EP02", "Episode 2"),
];

describe("EpisodeCreditsRangeForm", () => {
  it("counts eleven checked episodes of a 40-episode series and does not enable apply until the credit is chosen", () => {
    render({
      initialSelectedIds: episodes.slice(0, 11).map((episode) => episode.id),
    });

    fireEvent.click(screen.getByRole("radio", { name: /Replace/u }));

    expect(screen.getByText("11 episodes selected.")).toBeDefined();
    expect(applyButton().hasAttribute("disabled")).toBe(true);
  });

  it("previews a replace on eleven checked episodes and applies it as one save", async () => {
    const action = vi.fn(
      (
        _prev: BulkEditEpisodeCreditsActionState,
        formData: FormData
      ): Promise<BulkEditEpisodeCreditsActionState> => {
        expect(formData.get("operation")).toBe("replace");
        expect(formData.get("episode_ids")).toBe(
          JSON.stringify(episodes.slice(0, 11).map((episode) => episode.id))
        );
        expect(formData.get("from_creator_id")).toBe("CREATOR_B");
        expect(formData.get("from_role_id")).toBe("ROLE_ARTIST");
        expect(formData.get("to_creator_id")).toBe("CREATOR_C");
        expect(formData.get("to_role_id")).toBe("ROLE_ARTIST");
        return Promise.resolve({
          changedEpisodeIds: episodes.slice(0, 11).map((episode) => episode.id),
          ok: true,
          unchangedEpisodes: [],
        });
      }
    );

    render({
      action,
      initialSelectedIds: episodes.slice(0, 11).map((episode) => episode.id),
    });

    fireEvent.click(screen.getByRole("radio", { name: /Replace/u }));
    const [fromAuthor, toAuthor] = authorPickers();
    if (!fromAuthor || !toAuthor) {
      throw new Error("replace offers two author pickers");
    }
    fireEvent.change(fromAuthor, { target: { value: "CREATOR_B" } });
    fireEvent.change(toAuthor, { target: { value: "CREATOR_C" } });

    expect(
      screen.getByText(
        t("admin.series.episodes.credits.preview_replace", {
          count: "11",
          from_creator: "Artist B",
          from_role: "Artist",
          to_creator: "Artist C",
          to_role: "Artist",
        })
      )
    ).toBeDefined();
    expect(applyButton().hasAttribute("disabled")).toBe(false);

    const form = applyButton().closest("form");
    if (!(form instanceof HTMLFormElement)) {
      throw new Error("apply is not inside a form");
    }
    fireEvent.submit(form);

    expect(await screen.findByText("Changed 11 episodes")).toBeDefined();
    expect(screen.getByText("Episode 1")).toBeDefined();
    expect(screen.getByText("Episode 11")).toBeDefined();
    expect(screen.queryByText("Episode 12")).toBeNull();
    expect(action).toHaveBeenCalledOnce();
  });

  it("posts a sparse selection in reading order, not in check order", async () => {
    const action = vi.fn(
      (
        _prev: BulkEditEpisodeCreditsActionState,
        formData: FormData
      ): Promise<BulkEditEpisodeCreditsActionState> => {
        expect(JSON.parse(String(formData.get("episode_ids")))).toEqual([
          "EP01-ID",
          "EP07-ID",
          "EP11-ID",
        ]);
        return Promise.resolve({
          changedEpisodeIds: ["EP01-ID", "EP07-ID", "EP11-ID"],
          ok: true,
          unchangedEpisodes: [],
        });
      }
    );

    render({ action });

    fireEvent.click(episodeCheckbox("EP11", "Episode 11"));
    fireEvent.click(episodeCheckbox("EP01", "Episode 1"));
    fireEvent.click(episodeCheckbox("EP07", "Episode 7"));
    fireEvent.click(screen.getByRole("radio", { name: /Add/u }));
    const [author] = authorPickers();
    if (!author) {
      throw new Error("add offers an author picker");
    }
    fireEvent.change(author, { target: { value: "CREATOR_B" } });

    expect(screen.getByText("3 episodes selected.")).toBeDefined();
    expect(applyButton().hasAttribute("disabled")).toBe(false);

    const form = applyButton().closest("form");
    if (!(form instanceof HTMLFormElement)) {
      throw new Error("apply is not inside a form");
    }
    fireEvent.submit(form);

    expect(await screen.findByText("Changed 3 episodes")).toBeDefined();
    expect(action).toHaveBeenCalledOnce();
  });

  it("previews a set-share and posts the share as typed", async () => {
    const action = vi.fn(
      (
        _prev: BulkEditEpisodeCreditsActionState,
        formData: FormData
      ): Promise<BulkEditEpisodeCreditsActionState> => {
        expect(formData.get("operation")).toBe("set_share");
        expect(formData.get("creator_id")).toBe("CREATOR_B");
        expect(formData.get("role_id")).toBe("ROLE_ARTIST");
        expect(formData.get("share")).toBe("25");
        return Promise.resolve({
          changedEpisodeIds: ["EP01-ID", "EP02-ID", "EP03-ID"],
          ok: true,
          unchangedEpisodes: [],
        });
      }
    );

    render({ action, initialSelectedIds: ["EP01-ID", "EP02-ID", "EP03-ID"] });

    fireEvent.click(screen.getByRole("radio", { name: /Set share/u }));
    const [author] = authorPickers();
    if (!author) {
      throw new Error("set-share offers an author picker");
    }
    fireEvent.change(author, { target: { value: "CREATOR_B" } });

    // The credit alone is not a set-share: the share has to be stated.
    expect(applyButton().hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByRole("textbox", { name: "Share (%)" }), {
      target: { value: "25" },
    });

    expect(
      screen.getByText(
        "Set the share of Artist B as Artist to 25% on 3 selected episodes."
      )
    ).toBeDefined();
    expect(applyButton().hasAttribute("disabled")).toBe(false);

    const form = applyButton().closest("form");
    if (!(form instanceof HTMLFormElement)) {
      throw new Error("apply is not inside a form");
    }
    fireEvent.submit(form);

    expect(await screen.findByText("Changed 3 episodes")).toBeDefined();
    expect(action).toHaveBeenCalledOnce();
  });

  it("keeps apply disabled and says why while the share is not one", () => {
    render({ initialSelectedIds: ["EP01-ID"] });

    fireEvent.click(screen.getByRole("radio", { name: /Set share/u }));
    const [author] = authorPickers();
    if (!author) {
      throw new Error("set-share offers an author picker");
    }
    fireEvent.change(author, { target: { value: "CREATOR_B" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Share (%)" }), {
      target: { value: "120" },
    });

    expect(
      screen.getByText(
        "Enter each share as a percentage from 0 to 100, with up to two decimal places."
      )
    ).toBeDefined();
    expect(applyButton().hasAttribute("disabled")).toBe(true);
  });

  // The Action carries the operation, the credit, and the selection the form
  // held when it was submitted, so a change made while it is in flight would
  // not be the edit that gets applied.
  it("closes the operation, the credit, and the selection while the edit is in flight", async () => {
    // Never resolved: the assertions are about the window the edit is open in.
    const edit = Promise.withResolvers<BulkEditEpisodeCreditsActionState>();
    render({ action: () => edit.promise, initialSelectedIds: ["EP01-ID"] });

    const [author] = authorPickers();
    if (!author) {
      throw new Error("add offers an author picker");
    }
    fireEvent.change(author, { target: { value: "CREATOR_B" } });

    for (const control of submittedControls()) {
      expect(isClosed(control)).toBe(false);
    }

    fireEvent.click(applyButton());

    await waitFor(() => {
      for (const control of submittedControls()) {
        expect(isClosed(control)).toBe(true);
      }
    });
  });
});
