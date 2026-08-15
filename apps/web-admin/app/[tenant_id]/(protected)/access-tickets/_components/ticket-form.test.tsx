// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TicketForm } from "./ticket-form";

vi.mock("#lib/use-tenant-id", () => ({
  useTenantId: () => "TENANT001",
}));

vi.mock("../_lib/actions", () => ({
  listEpisodeOptionsAction: vi.fn(),
}));

const action = () => Promise.resolve({ message: "", ok: false });

afterEach(() => {
  cleanup();
});

describe("TicketForm", () => {
  it("シリーズを選べるときは combobox でエピソードを選ぶ", () => {
    render(
      <TicketForm
        action={action}
        series={[{ publicId: "SERIES001", title: "シリーズA" }]}
        timeZone="Asia/Tokyo"
      />
    );

    expect(screen.getByLabelText(/シリーズ/u)).toBeDefined();
    expect(screen.getByLabelText(/^エピソード/u)).toBeDefined();
    expect(screen.queryByLabelText(/エピソード public_id/u)).toBeNull();
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
});
