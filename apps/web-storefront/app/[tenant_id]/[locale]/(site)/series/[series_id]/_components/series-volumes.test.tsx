// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PromotionCodeProvider } from "#components/promotion-code-field";
import type { VolumeItem } from "#lib/catalog";
import type { PromotionCodeState } from "#lib/promotion-code";

import {
  VolumeBookstoreLinks,
  VolumeOwnershipFailure,
  VolumePurchaseControl,
} from "./series-volumes";

const { mockGetMySeriesPurchaseState } = vi.hoisted(() => ({
  mockGetMySeriesPurchaseState: vi.fn(),
}));

// `<Message>` is an async Server Component only the Next.js compiler can
// provide. The catalog is the real one, so the assertions stay on the copy a
// reader actually sees.
vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

vi.mock("#components/locale-field", () => ({
  LocaleField: () => <input name="locale" type="hidden" value="en" />,
}));

vi.mock("#lib/series-purchases", () => ({
  getMySeriesPurchaseState: mockGetMySeriesPurchaseState,
}));

vi.mock("#components/client-message", () => ({
  useClientMessages: () => (message: string) => message,
}));

vi.mock("../_lib/actions", () => ({
  applyVolumePromotionCodeAction: vi.fn(),
  startVolumeCheckoutAction: vi.fn(),
}));

vi.mock("#lib/api-client", () => ({ resolveAccessToken: vi.fn() }));

vi.mock("../_lib/volume-promotion-code-offer", () => ({
  quotableVolumeIds: vi.fn(),
  toVolumePromotionCodeOffer: vi.fn(),
}));

afterEach(cleanup);

const VOLUME: VolumeItem = {
  bookstoreLinks: [],
  episodeIds: ["EPISODE_ID_2", "EPISODE_ID_3"],
  id: "VOLUME_ID",
  orderIndex: 1,
  price: 350,
  publicId: "VOLUME_001",
  title: "Volume 1",
};

const owning = (...ids: string[]) => ({
  ok: true,
  ownedEpisodeIds: new Set(ids),
  remainder: null,
});

const FAILED = {
  message: "Could not check which episodes you already own.",
  ok: false,
};

const renderControl = async (canSell = true) =>
  render(
    <div>
      {await VolumePurchaseControl({
        canSell,
        currency: "JPY",
        locale: "en",
        seriesId: "SERIES_ID",
        seriesPublicId: "SERIES_001",
        taxIncluded: false,
        tenantId: "TENANT_001",
        volume: VOLUME,
      })}
    </div>
  );

const renderOwnershipError = async () =>
  render(
    <div>
      {await VolumeOwnershipFailure({
        locale: "en",
        seriesId: "SERIES_ID",
        tenantId: "TENANT_001",
      })}
    </div>
  );

describe("VolumePurchaseControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("says the volume is the reader's when they own every episode in it", async () => {
    mockGetMySeriesPurchaseState.mockResolvedValueOnce(
      owning("EPISODE_ID_2", "EPISODE_ID_3")
    );

    await renderControl();

    expect(
      screen.getByText("You own every episode in this volume")
    ).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers the volume to a reader who owns only part of it", async () => {
    mockGetMySeriesPurchaseState.mockResolvedValueOnce(owning("EPISODE_ID_2"));

    await renderControl();

    expect(screen.getByRole("button", { name: "Buy volume" })).toBeTruthy();
  });

  it("offers nothing to press on a site that takes no payments", async () => {
    mockGetMySeriesPurchaseState.mockResolvedValueOnce(owning());

    await renderControl(false);

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers nothing when what the reader owns could not be read", async () => {
    mockGetMySeriesPurchaseState.mockResolvedValueOnce(FAILED);

    await renderControl();

    expect(screen.queryByRole("button")).toBeNull();
    expect(
      screen.queryByText("You own every episode in this volume")
    ).toBeNull();
  });
});

describe("VolumeOwnershipFailure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("says why the cards offer nothing when the read failed", async () => {
    mockGetMySeriesPurchaseState.mockResolvedValueOnce(FAILED);

    await renderOwnershipError();

    expect(
      screen.getByText("Could not check which volumes you own")
    ).toBeTruthy();
    expect(screen.getByText(FAILED.message)).toBeTruthy();
  });

  it("says nothing when the read answered", async () => {
    mockGetMySeriesPurchaseState.mockResolvedValueOnce(owning());

    const { container } = await renderOwnershipError();

    expect(container.textContent).toBe("");
  });
});

describe("VolumeBookstoreLinks", () => {
  it("lists each link as a button that opens the bookstore in a new tab", () => {
    render(
      <VolumeBookstoreLinks
        links={[
          { label: "Bookstore A", url: "https://books.example.com/volume-1" },
          { label: "Bookstore B", url: "https://shop.example.net/v1" },
        ]}
      />
    );

    expect(screen.getByRole("heading", { name: "Buy the book" })).toBeTruthy();
    const links = screen.getAllByRole("link");
    expect(
      links.map((link) => [
        link.textContent,
        link.getAttribute("href"),
        link.getAttribute("target"),
        link.getAttribute("rel"),
      ])
    ).toEqual([
      [
        "Bookstore A",
        "https://books.example.com/volume-1",
        "_blank",
        "noopener noreferrer",
      ],
      [
        "Bookstore B",
        "https://shop.example.net/v1",
        "_blank",
        "noopener noreferrer",
      ],
    ]);
  });

  it("shows no heading and no links for a volume with none", () => {
    const { container } = render(<VolumeBookstoreLinks links={[]} />);

    expect(container.textContent).toBe("");
    expect(screen.queryByRole("link")).toBeNull();
  });
});

const renderUnder = async (
  state: PromotionCodeState<string>,
  action = vi.fn()
) => {
  mockGetMySeriesPurchaseState.mockResolvedValueOnce(owning());

  const control = await VolumePurchaseControl({
    canSell: true,
    currency: "JPY",
    locale: "en",
    seriesId: "SERIES_ID",
    seriesPublicId: "SERIES_001",
    taxIncluded: false,
    tenantId: "TENANT_001",
    volume: VOLUME,
  });

  return render(
    <PromotionCodeProvider action={action} initialState={state}>
      {control}
    </PromotionCodeProvider>
  );
};

const hiddenCode = (button: HTMLElement) =>
  button
    .closest("form")
    ?.querySelector<HTMLInputElement>('input[name="promotionCode"]')?.value;

describe("the button of a volume a code applies to", () => {
  it("names the discounted price and carries the code into the checkout", async () => {
    await renderUnder({
      code: "SPRING10",
      kind: "applied",
      quotes: { [VOLUME.id]: { listPrice: 350, price: 280 } },
    });

    const button = screen.getByRole("button");

    expect(button.querySelector("s")).not.toBeNull();
    expect(hiddenCode(button)).toBe("SPRING10");
  });

  it("keeps its price when the code does not apply to it", async () => {
    await renderUnder({
      code: "SPRING10",
      kind: "applied",
      quotes: { OTHER_VOLUME: { listPrice: 500, price: 400 } },
    });

    const button = screen.getByRole("button", { name: "Buy volume" });

    expect(hiddenCode(button)).toBeUndefined();
  });
});
