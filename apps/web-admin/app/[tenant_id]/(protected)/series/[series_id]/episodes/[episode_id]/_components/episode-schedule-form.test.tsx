// @vitest-environment jsdom

import { cleanup, render as renderBase, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleProvider } from "#components/admin-locale-context";

import { EpisodeForm } from "../../_components/episode-form";
import { EpisodeScheduleForm } from "./episode-schedule-form";

const render = (ui: React.ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleProvider locale="ja">{children}</AdminLocaleProvider>
    ),
  });

vi.mock("#lib/use-tenant-id", () => ({
  useTenantId: () => "TENANT001",
}));

afterEach(() => {
  cleanup();
});

describe("EpisodeScheduleForm", () => {
  const action = vi.fn(() => Promise.resolve(null));

  it("scheduledAt をテナントタイムゾーンの壁時計として初期表示する", () => {
    render(
      <EpisodeScheduleForm
        action={action}
        episodePublicId="EP001"
        scheduledAt="2030-01-01T01:00:00Z"
        seriesPublicId="SERIES001"
        timeZone="Asia/Tokyo"
      />
    );

    const localInput = screen.getByLabelText<HTMLInputElement>(/publish_at/u);

    expect(localInput.value).toBe("2030-01-01T10:00");
  });

  it("予約が無いときは入力を空にする", () => {
    render(
      <EpisodeScheduleForm
        action={action}
        episodePublicId="EP001"
        seriesPublicId="SERIES001"
        timeZone="Asia/Tokyo"
      />
    );

    const localInput = screen.getByLabelText<HTMLInputElement>(/publish_at/u);

    expect(localInput.value).toBe("");
  });

  it("作成フォームと同時にマウントされても id が重複しない", () => {
    render(
      <>
        <EpisodeForm
          action={() => Promise.resolve(null)}
          seriesPublicId="SERIES001"
          timeZone="Asia/Tokyo"
        />
        <EpisodeScheduleForm
          action={action}
          episodePublicId="EP001"
          scheduledAt="2030-01-01T01:00:00Z"
          seriesPublicId="SERIES001"
          timeZone="Asia/Tokyo"
        />
      </>
    );

    const ids = [...document.querySelectorAll("[id]")].map(
      (element) => element.id
    );

    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toHaveLength(new Set(ids).size);
    expect(screen.getAllByLabelText(/publish_at/u)).toHaveLength(2);
  });
});
