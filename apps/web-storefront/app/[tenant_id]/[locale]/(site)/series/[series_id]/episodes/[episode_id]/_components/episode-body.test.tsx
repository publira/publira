// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  EpisodeAccessState,
  EpisodeDetail,
  EpisodeImageItem,
  EpisodeSeriesSummary,
} from "#lib/catalog";

import { EpisodeBody } from "./episode-body";

const { mockGetEpisodeViewer, mockResolveAccessToken } = vi.hoisted(() => ({
  mockGetEpisodeViewer: vi.fn(),
  mockResolveAccessToken: vi.fn(),
}));

vi.mock("#lib/api-client", () => ({
  resolveAccessToken: mockResolveAccessToken,
}));

vi.mock("#lib/catalog", () => ({
  getEpisodeViewer: mockGetEpisodeViewer,
  isPublicEpisodeBody: (access: EpisodeAccessState) => access === "free",
}));

vi.mock("#lib/locale", () => ({
  getLocale: () => Promise.resolve("en"),
}));

vi.mock("#lib/coins", () => ({
  getCoinSettings: vi.fn(),
  getMyCoinBalance: vi.fn(),
}));

vi.mock("#lib/wait-free", () => ({
  getMyWaitFreeTicketState: vi.fn(),
}));

vi.mock("#components/message", () => ({
  Message: ({ message }: { message: string }) => message,
}));

vi.mock("../_lib/subscription-offer", () => ({
  offersSubscription: () => Promise.resolve(false),
}));

vi.mock("../_lib/renew-page-urls-action", () => ({
  renewEpisodePageUrlsAction: () => Promise.resolve({}),
}));

// What this file is about is which of these the body hands the reader, and
// with what, so each stands in as a marker naming the pages it was given.
vi.mock("./episode-access-gate", () => ({
  EpisodeAccessGate: ({
    previewEnded,
    signedIn,
  }: {
    previewEnded?: boolean;
    signedIn: boolean;
  }) => (
    <p>
      {`gate ${signedIn ? "signed in" : "guest"}${previewEnded ? " after the preview" : ""}`}
    </p>
  ),
}));

vi.mock("./episode-gate-frame", () => ({
  EpisodeGateFrame: ({
    children,
    previewImages,
  }: {
    children: ReactNode;
    previewImages: EpisodeImageItem[];
  }) => (
    <section aria-label="Gate frame">
      {previewImages.map((image) => image.id).join(",")}
      {children}
    </section>
  ),
}));

vi.mock("./episode-preview-viewer", () => ({
  EpisodePreviewViewer: ({
    gate,
    previewPages,
  }: {
    gate: ReactNode;
    previewPages: EpisodeImageItem[];
  }) => (
    <section aria-label="Preview viewer">
      {previewPages.map((image) => image.id).join(",")}
      {gate}
    </section>
  ),
}));

vi.mock("./episode-viewer", () => ({
  EpisodeViewer: ({ images }: { images: EpisodeImageItem[] }) => (
    <section aria-label="Viewer">
      {images.map((image) => image.id).join(",")}
    </section>
  ),
}));

afterEach(cleanup);

const page = (id: string, displayOrder: number): EpisodeImageItem => ({
  contentType: "image/jpeg",
  displayOrder,
  fileSizeBytes: 1024,
  height: 1500,
  id,
  imageUrl: `/images/episodes/${id}`,
  width: 1050,
});

const episode: EpisodeDetail = {
  coinName: "",
  coinPrice: 0,
  coinRentalPrice: 0,
  credits: [],
  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  locale: "en",
  orderIndex: 10,
  price: 500,
  publicId: "EPISODE_010",
  publishedAt: "2026-08-01T00:00:00Z",
  purchaseSurface: "all",
  ratingCount: 0,
  readingDirection: "rtl",
  readingPeriodHours: 72,
  rentalPeriodHours: 0,
  rentalPrice: 0,
  scheduledAt: "",
  spreadStartIndex: 1,
  status: "published",
  title: "Last light",
};

const series: EpisodeSeriesSummary = {
  id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  locale: "en",
  publicId: "SERIES_001",
  title: "Long nights",
};

const props: Parameters<typeof EpisodeBody>[0] = {
  acceptsPayments: true,
  access: "locked",
  appPayments: { appStore: false, googlePlay: false },
  checkoutSessionId: "",
  commentMode: "disabled",
  commentToken: "",
  currency: "JPY",
  episode,
  images: [],
  labelPublicId: "",
  previewImages: [page("blurred_1", 1)],
  previewPages: [],
  series,
  tenantId: "TENANT_001",
  timeZone: "UTC",
};

const renderBody = async (overrides: Partial<typeof props> = {}) =>
  render(<div>{await EpisodeBody({ ...props, ...overrides })}</div>);

describe("EpisodeBody", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccessToken.mockResolvedValue("");
  });

  describe("a guest", () => {
    it("turns the preview pages and meets the gate after them, with no blurred teaser", async () => {
      await renderBody({
        previewPages: [page("page_1", 1), page("page_2", 2), page("page_3", 3)],
      });

      const viewer = screen.getByRole("region", { name: "Preview viewer" });
      expect(viewer.textContent).toBe(
        "page_1,page_2,page_3gate guest after the preview"
      );
      expect(screen.queryByRole("region", { name: "Gate frame" })).toBeNull();
    });

    it("meets the gate over the blurred teaser where the episode opens no preview", async () => {
      await renderBody();

      const frame = screen.getByRole("region", { name: "Gate frame" });
      expect(frame.textContent).toBe("blurred_1gate guest");
      expect(
        screen.queryByRole("region", { name: "Preview viewer" })
      ).toBeNull();
    });
  });

  describe("a reader signed in", () => {
    beforeEach(() => {
      mockResolveAccessToken.mockResolvedValue("session-token");
    });

    it("turns the preview pages their own read answered, then meets the gate", async () => {
      mockGetEpisodeViewer.mockResolvedValueOnce({
        ok: true,
        value: {
          access: "locked",
          images: [],
          previewPages: [page("own_1", 1), page("own_2", 2)],
        },
      });

      await renderBody({ previewPages: [page("shared_1", 1)] });

      expect(
        screen.getByRole("region", { name: "Preview viewer" }).textContent
      ).toBe("own_1,own_2gate signed in after the preview");
    });

    it("meets the gate over the blurred teaser where their read opens no preview", async () => {
      mockGetEpisodeViewer.mockResolvedValueOnce({
        ok: true,
        value: { access: "locked", images: [], previewPages: [] },
      });

      await renderBody();

      expect(
        screen.getByRole("region", { name: "Gate frame" }).textContent
      ).toBe("blurred_1gate signed in");
    });

    it("reads the whole body once the episode is theirs", async () => {
      mockGetEpisodeViewer.mockResolvedValueOnce({
        ok: true,
        value: {
          access: "entitled",
          entitlementSource: "purchase",
          images: [page("page_1", 1), page("page_2", 2), page("page_3", 3)],
          previewPages: [],
        },
      });

      await renderBody({ previewPages: [page("page_1", 1)] });

      expect(screen.getByRole("region", { name: "Viewer" }).textContent).toBe(
        "page_1,page_2,page_3"
      );
      expect(
        screen.queryByRole("region", { name: "Preview viewer" })
      ).toBeNull();
    });
  });
});
