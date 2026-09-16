// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import {
  cleanup,
  fireEvent,
  render as renderBase,
  screen,
} from "@testing-library/react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleProvider } from "#components/admin-locale-context";

import type { BulkEditEpisodeCreditsActionState } from "../episode-types";
import { EpisodeCreditsRangeForm } from "./episode-credits-range-form";
import { EpisodeCreditsSelectionProvider } from "./episode-credits-selection";

vi.mock("#lib/use-tenant-id", () => ({
  useTenantId: () => "TENANT001",
}));

vi.mock("@publira/ui-components/combobox", () => ({
  Combobox: ({
    disabled,
    id,
    items,
    onValueChange,
    value,
  }: {
    disabled?: boolean;
    id?: string;
    items: { label: string; value: string }[];
    onValueChange: (next: string) => void;
    value: string;
  }) => (
    <select
      disabled={disabled}
      id={id}
      onChange={(event) => onValueChange(event.target.value)}
      value={value}
    >
      <option value="">-</option>
      {items.map((item) => (
        <option key={item.value} value={item.value}>
          {item.label}
        </option>
      ))}
    </select>
  ),
  ComboboxEmpty: () => null,
  ComboboxInput: () => null,
  ComboboxItems: () => null,
  ComboboxPopup: () => null,
}));

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

vi.mock("@publira/ui-components/input", () => ({
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@publira/ui-components/dialog", () => ({
  DialogClose: ({ render }: { render: ReactNode }) => render,
  DialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

const t = bindMessages(sharedCatalog("en"));

const episodes = Array.from({ length: 40 }, (_, index) => ({
  publicId: `EP${String(index + 1).padStart(2, "0")}`,
  title: `Episode ${index + 1}`,
}));

const creators = [
  { name: "Artist B", publicId: "CREATOR_B" },
  { name: "Artist C", publicId: "CREATOR_C" },
];

const creatorRoles = [{ name: "Artist", publicId: "ROLE_ARTIST" }];

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
      seriesPublicId="SERIES001"
    />,
    {
      wrapper: ({ children }) => (
        <AdminLocaleProvider locale="en" messages={sharedCatalog("en")}>
          <EpisodeCreditsSelectionProvider
            initialSelectedIds={initialSelectedIds}
          >
            {children}
          </EpisodeCreditsSelectionProvider>
        </AdminLocaleProvider>
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

describe("EpisodeCreditsRangeForm", () => {
  it("counts eleven checked episodes of a 40-episode series and does not enable apply until the credit is chosen", () => {
    render({
      initialSelectedIds: episodes
        .slice(0, 11)
        .map((episode) => episode.publicId),
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
        expect(formData.get("episode_public_ids")).toBe(
          JSON.stringify(
            episodes.slice(0, 11).map((episode) => episode.publicId)
          )
        );
        expect(formData.get("from_creator_public_id")).toBe("CREATOR_B");
        expect(formData.get("from_role_public_id")).toBe("ROLE_ARTIST");
        expect(formData.get("to_creator_public_id")).toBe("CREATOR_C");
        expect(formData.get("to_role_public_id")).toBe("ROLE_ARTIST");
        return Promise.resolve({
          changedEpisodePublicIds: episodes
            .slice(0, 11)
            .map((episode) => episode.publicId),
          ok: true,
          unchangedEpisodes: [],
        });
      }
    );

    render({
      action,
      initialSelectedIds: episodes
        .slice(0, 11)
        .map((episode) => episode.publicId),
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
        expect(JSON.parse(String(formData.get("episode_public_ids")))).toEqual([
          "EP01",
          "EP07",
          "EP11",
        ]);
        return Promise.resolve({
          changedEpisodePublicIds: ["EP01", "EP07", "EP11"],
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
});
