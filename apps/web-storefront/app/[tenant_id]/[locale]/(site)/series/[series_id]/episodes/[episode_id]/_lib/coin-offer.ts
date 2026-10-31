import type { EpisodeDetail } from "#lib/catalog";
import { coinPackCovering } from "#lib/coins";
import type {
  CoinBalanceItem,
  CoinDisclosuresItem,
  CoinPackItem,
  CoinSettingsItem,
} from "#lib/coins";

/**
 * What the gate offers a signed-in reader for the tenant's coins: the episode
 * paid for with the coins they hold, or, when those fall short of the
 * permanent copy, the pack that covers the difference.
 */
export type CoinOffer =
  | {
      kind: "offer";
      /** What the reader can spend now. */
      balance: number;
      coinName: string;
      /** The tenant's terms, stated beside a pack the gate sells. */
      disclosures: CoinDisclosuresItem;
      /** How many days a pack's coins can be spent for after purchase. */
      expiryDays: number;
      /** Names this one payment, so a second tap spends nothing more. */
      idempotencyKey: string;
      /**
       * The coins the reader still needs for the permanent copy: its price
       * less the balance, plus what the next pack pays back of a refunded
       * one. 0 when the balance covers it.
       */
      needed: number;
      /**
       * The smallest pack on sale that covers `needed`. Absent when the
       * balance covers the permanent copy, and when no pack on sale is large
       * enough, where the gate sends the reader to every pack on sale instead.
       */
      pack?: CoinPackItem;
      /** Whether the site sells any pack the reader could buy right now. */
      packsOnSale: boolean;
      /** The permanent copy's price in coins. */
      price: number;
      /** The rental's price in coins; 0 on an episode that is not rented. */
      rentalPrice: number;
    }
  | { kind: "failed"; message: string };

/**
 * Whether the gate asks about coins at all: the episode is priced in them,
 * which it is only while the tenant offers coins, and it may be sold on the
 * site, which a payment with coins is refused off.
 */
export const episodeOffersCoins = (
  episode: Pick<
    EpisodeDetail,
    "coinPrice" | "coinRentalPrice" | "purchaseSurface"
  >
): boolean =>
  (episode.coinPrice > 0 || episode.coinRentalPrice > 0) &&
  episode.purchaseSurface !== "app";

/**
 * The gate's offer from the reader's balance and the tenant's packs.
 *
 * A balance that could not be read is the failure the gate words instead of
 * an offer, and one the API answers with nothing — the tenant turned coins off
 * after the episode was cached with its price — offers nothing, as an episode
 * with no coin price does. Packs are sold only through the site's payment
 * provider, so a site that takes no payments offers none, and a settings read
 * that failed offers none either: the reader can still spend what they hold.
 */
export const toCoinOffer = ({
  acceptsPayments,
  balance,
  episode,
  idempotencyKey,
  settings,
}: {
  acceptsPayments: boolean;
  balance:
    | { ok: true; value: CoinBalanceItem | null }
    | { message: string; ok: false };
  episode: Pick<EpisodeDetail, "coinName" | "coinPrice" | "coinRentalPrice">;
  idempotencyKey: string;
  settings: CoinSettingsItem | null;
}): CoinOffer | undefined => {
  if (!balance.ok) {
    return { kind: "failed", message: balance.message };
  }

  if (!balance.value) {
    return undefined;
  }

  const { coins, owedCoins } = balance.value;

  const needed =
    coins >= episode.coinPrice ? 0 : episode.coinPrice - coins + owedCoins;

  const packs = acceptsPayments && settings?.selling ? settings.packs : [];

  return {
    balance: coins,
    coinName: episode.coinName || balance.value.coinName,
    disclosures: settings?.disclosures ?? {
      contact: "",
      issuerName: "",
      notice: "",
      termsUrl: "",
    },
    expiryDays: settings?.expiryDays ?? 0,
    idempotencyKey,
    kind: "offer",
    needed,
    pack: needed > 0 ? coinPackCovering(packs, needed) : undefined,
    packsOnSale: packs.length > 0,
    price: episode.coinPrice,
    rentalPrice: episode.coinRentalPrice,
  };
};

/**
 * Whether the reader's coins pay for the episode outright, which makes paying
 * with them the gate's Shu: it opens the episode without leaving the page.
 */
export const coinsCarryShu = (offer: CoinOffer | undefined): boolean =>
  offer?.kind === "offer" &&
  (offer.needed === 0 ||
    (offer.rentalPrice > 0 && offer.balance >= offer.rentalPrice));

/**
 * Whether the reader can get into the episode with coins from the gate: their
 * coins pay for it, or the site sells a pack that lets them. Either tells the
 * reader the episode can be bought here, even on a site that sells it no other
 * way.
 */
export const offersCoinPayment = (offer: CoinOffer | undefined): boolean =>
  offer?.kind === "offer" && (coinsCarryShu(offer) || offer.packsOnSale);
