// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContentViewTracker } from "./content-view-tracker";

const { mockRecordContentViewAction } = vi.hoisted(() => ({
  mockRecordContentViewAction: vi.fn(),
}));

vi.mock("#lib/view-event-actions", () => ({
  recordContentViewAction: mockRecordContentViewAction,
}));

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

afterEach(cleanup);

describe("ContentViewTracker", () => {
  it("開かれたページの閲覧を 1 度だけ報告する", () => {
    mockRecordContentViewAction.mockReturnValue(Promise.resolve());

    const { rerender } = render(
      <ContentViewTracker
        kind="episode"
        publicId="EP_001"
        tenantId={TENANT_ID}
      />
    );
    rerender(
      <ContentViewTracker
        kind="episode"
        publicId="EP_001"
        tenantId={TENANT_ID}
      />
    );

    expect(mockRecordContentViewAction).toHaveBeenCalledTimes(1);
    expect(mockRecordContentViewAction).toHaveBeenCalledWith({
      kind: "episode",
      publicId: "EP_001",
      tenantId: TENANT_ID,
    });
  });

  it("別のエピソードへ移ったら改めて報告する", () => {
    mockRecordContentViewAction.mockReturnValue(Promise.resolve());

    const { rerender } = render(
      <ContentViewTracker
        kind="episode"
        publicId="EP_001"
        tenantId={TENANT_ID}
      />
    );
    rerender(
      <ContentViewTracker
        kind="episode"
        publicId="EP_002"
        tenantId={TENANT_ID}
      />
    );

    expect(mockRecordContentViewAction).toHaveBeenCalledTimes(2);
  });

  it("報告が失敗してもページを壊さない", () => {
    mockRecordContentViewAction.mockRejectedValue(new Error("unavailable"));

    expect(() =>
      render(
        <ContentViewTracker
          kind="series"
          publicId="SR_001"
          tenantId={TENANT_ID}
        />
      )
    ).not.toThrow();
  });
});
