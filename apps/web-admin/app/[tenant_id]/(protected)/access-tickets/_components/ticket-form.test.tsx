// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render as renderBase,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleProvider } from "#components/admin-locale-context";

import { listEpisodeOptionsAction } from "../_lib/actions";
import { TicketForm } from "./ticket-form";

vi.mock("#lib/use-tenant-id", () => ({
  useTenantId: () => "TENANT001",
}));

vi.mock("../_lib/actions", () => ({
  listEpisodeOptionsAction: vi.fn(),
}));

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
      <>
        <Input
          disabled={disabled}
          onChange={(event) => onValueChange(event.target.value)}
          value={value}
        />
        {items.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </>
    ),
  };
});

const mockListEpisodeOptionsAction = vi.mocked(listEpisodeOptionsAction);

const action = () => Promise.resolve({ message: "", ok: false });

const seriesA = { publicId: "SERIES001", title: "シリーズA" };
const seriesB = { publicId: "SERIES002", title: "シリーズB" };

const seriesCombobox = () => screen.getByLabelText(/シリーズ/u);
const episodeCombobox = () => screen.getByLabelText(/^エピソード/u);

const selectSeries = (item: { publicId: string; title: string }) => {
  fireEvent.change(seriesCombobox(), {
    target: { value: item.publicId },
  });
};

const render = (ui: ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleProvider locale="ja">{children}</AdminLocaleProvider>
    ),
  });

afterEach(() => {
  cleanup();
});

describe("TicketForm", () => {
  beforeEach(() => {
    mockListEpisodeOptionsAction.mockReset();
  });

  it("シリーズを選べるときは combobox でエピソードを選び、未選択では発行できない", () => {
    render(
      <TicketForm action={action} series={[seriesA]} timeZone="Asia/Tokyo" />
    );

    expect(seriesCombobox()).toBeDefined();
    expect(episodeCombobox()).toBeDefined();
    expect(screen.queryByLabelText(/エピソード public_id/u)).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "チケットを発行" })
        .hasAttribute("disabled")
    ).toBe(true);
  });

  it("シリーズ一覧が空ならエピソード public_id の直接入力に落とす", () => {
    render(<TicketForm action={action} series={[]} timeZone="Asia/Tokyo" />);

    expect(screen.getByLabelText(/エピソード public_id/u)).toBeDefined();
    expect(screen.queryByLabelText(/^シリーズ$/u)).toBeNull();
    expect(
      screen.getByText(
        "選択できるシリーズがありません。エピソードの public_id を直接入力してください。"
      )
    ).toBeDefined();
  });

  it("シリーズ取得失敗時も public_id 入力に落とし、エラーを出す", () => {
    render(
      <TicketForm
        action={action}
        series={[]}
        seriesErrorMessage="シリーズ一覧の取得に失敗しました。"
        timeZone="Asia/Tokyo"
      />
    );

    expect(screen.getByLabelText(/エピソード public_id/u)).toBeDefined();
    expect(
      screen.getByText("シリーズ一覧の取得に失敗しました。")
    ).toBeDefined();
  });

  it("シリーズを選ぶとエピソード候補を読み、選べるようにする", async () => {
    mockListEpisodeOptionsAction.mockResolvedValue({
      episodes: [{ publicId: "EPISODE001", title: "第1話" }],
      ok: true,
    });

    render(
      <TicketForm action={action} series={[seriesA]} timeZone="Asia/Tokyo" />
    );

    selectSeries(seriesA);

    await waitFor(() => {
      expect(mockListEpisodeOptionsAction).toHaveBeenCalledWith(
        "TENANT001",
        "SERIES001",
        "ja"
      );
    });

    expect(
      await screen.findByRole("option", { name: "第1話 (EPISODE001)" })
    ).toBeDefined();

    fireEvent.change(episodeCombobox(), {
      target: { value: "EPISODE001" },
    });
    await waitFor(() => {
      expect(
        screen
          .getByRole("button", { name: "チケットを発行" })
          .hasAttribute("disabled")
      ).toBe(false);
    });
  });

  it("エピソード取得失敗時も選択UIを残し、再試行できる", async () => {
    mockListEpisodeOptionsAction
      .mockResolvedValueOnce({
        episodes: [],
        message: "エピソード一覧の取得に失敗しました。",
        ok: false,
      })
      .mockResolvedValueOnce({
        episodes: [{ publicId: "EPISODE001", title: "第1話" }],
        ok: true,
      });

    render(
      <TicketForm action={action} series={[seriesA]} timeZone="Asia/Tokyo" />
    );

    selectSeries(seriesA);

    expect(
      await screen.findByText("エピソード一覧の取得に失敗しました。")
    ).toBeDefined();
    expect(seriesCombobox()).toBeDefined();
    expect(screen.queryByLabelText(/エピソード public_id/u)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "再試行" }));

    expect(
      await screen.findByRole("option", { name: "第1話 (EPISODE001)" })
    ).toBeDefined();
    expect(mockListEpisodeOptionsAction).toHaveBeenCalledTimes(2);
  });

  it("連続してシリーズを選んだとき、古い取得結果は捨てる", async () => {
    const firstLoad = Promise.withResolvers<{
      episodes: { publicId: string; title: string }[];
      ok: true;
    }>();

    mockListEpisodeOptionsAction
      .mockImplementationOnce(() => firstLoad.promise)
      .mockResolvedValueOnce({
        episodes: [{ publicId: "EPISODE-B", title: "後から選んだ話" }],
        ok: true,
      });

    render(
      <TicketForm
        action={action}
        series={[seriesA, seriesB]}
        timeZone="Asia/Tokyo"
      />
    );

    selectSeries(seriesA);
    selectSeries(seriesB);

    firstLoad.resolve({
      episodes: [{ publicId: "EPISODE-A", title: "先に返った話" }],
      ok: true,
    });

    expect(
      await screen.findByRole("option", { name: "後から選んだ話 (EPISODE-B)" })
    ).toBeDefined();
    expect(
      screen.queryByRole("option", { name: "先に返った話 (EPISODE-A)" })
    ).toBeNull();
  });
});
