// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EpisodeAccessGate } from "./episode-access-gate";

afterEach(cleanup);

const props = {
  episodePublicId: "EPISODE_001",
  seriesPublicId: "SERIES_001",
  signedIn: true,
  tenantId: "TENANT_001",
};

describe("EpisodeAccessGate", () => {
  it("決済設定が無効なら購入 CTA を表示しない", () => {
    render(<EpisodeAccessGate {...props} acceptsPayments={false} />);

    expect(screen.queryByRole("button", { name: "購入手続きへ" })).toBeNull();
    expect(
      screen.getByText("購入手続きを利用できません", { exact: false })
    ).toBeDefined();
    expect(screen.getByRole("link", { name: "シリーズ詳細へ" })).toBeDefined();
  });

  it("決済設定が有効なら購入 CTA を表示する", () => {
    render(<EpisodeAccessGate {...props} acceptsPayments />);

    expect(screen.getByRole("button", { name: "購入手続きへ" })).toBeDefined();
  });
});
