import type { Locale } from "@publira/i18n";
import { ExternalLinkIcon } from "@publira/icons";
import { LinkButton } from "@publira/ui-components/button";
import * as SectionError from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { formatPrice } from "@publira/utils";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { EyeCatchFrame } from "#components/eye-catch-frame";
import { LocaleField } from "#components/locale-field";
import { Message } from "#components/message";
import * as PaymentProviderChoice from "#components/payment-provider-choice";
import * as PromotionCode from "#components/promotion-code";
import { resolveAccessToken } from "#lib/api-client";
import type { TenantSales } from "#lib/app-payments";
import type {
  EyeCatchImageVariant,
  VolumeBookstoreLink,
  VolumeItem,
} from "#lib/catalog";
import { getMySeriesPurchaseState } from "#lib/series-purchases";

import {
  applyVolumePromotionCodeAction,
  startVolumeCheckoutAction,
} from "../_lib/actions";
import { parseSeriesCheckoutSearchParams } from "../_lib/checkout-search-params";
import {
  quotableVolumeIds,
  toVolumePromotionCodeOffer,
} from "../_lib/volume-promotion-code-offer";

/**
 * The button a volume is bought with, which the purchase control renders. A
 * code the section's field applied to the volume rewrites it.
 */
const VolumeBuyForm = ({
  currency,
  locale,
  seriesPublicId,
  taxIncluded,
  tenantId,
  volumeId,
}: {
  currency: string | null;
  locale: Locale;
  seriesPublicId: string;
  taxIncluded: boolean;
  tenantId: string;
  volumeId: string;
}) => (
  <form action={startVolumeCheckoutAction}>
    <LocaleField />
    <input name="tenantId" type="hidden" value={tenantId} />
    <input name="seriesPublicId" type="hidden" value={seriesPublicId} />
    <input name="volumeId" type="hidden" value={volumeId} />
    <PaymentProviderChoice.Input />
    <PromotionCode.CheckoutSubmit
      currency={currency}
      locale={locale}
      sale={volumeId}
      taxIncluded={taxIncluded}
      variant="outline"
    >
      <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
        <Message message="storefront.series.volume_buy" />
      </Suspense>
    </PromotionCode.CheckoutSubmit>
  </form>
);

/**
 * Why the cards offer nothing to press: what the reader owns could not be
 * read, so no card can tell a volume already theirs from one to buy. One
 * notice above the cards rather than one in each, since every card asks the
 * same read.
 */
export const VolumeOwnershipFailure = async ({
  locale,
  seriesId,
  tenantId,
}: {
  locale: Locale;
  seriesId: string;
  tenantId: string;
}) => {
  const state = await getMySeriesPurchaseState(tenantId, seriesId, locale);

  if (state.ok) {
    return null;
  }

  return (
    <SectionError.Root>
      <SectionError.Heading>
        <SectionError.Title>
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="storefront.series.volume_ownership_error" />
          </Suspense>
        </SectionError.Title>
        <SectionError.Description>{state.message}</SectionError.Description>
      </SectionError.Heading>
    </SectionError.Root>
  );
};

/**
 * What the reader can do about one volume: nothing, because every episode in
 * it is already theirs for good, or buy it where the site takes payments.
 *
 * Member-specific, so it sits in a `<Suspense>` of its own and the card around
 * it stays on the shared series read. A read that failed offers nothing:
 * {@link VolumeOwnershipFailure} says why above the cards.
 */
export const VolumePurchaseControl = async ({
  canSell,
  currency,
  locale,
  seriesId,
  seriesPublicId,
  taxIncluded,
  tenantId,
  volume,
}: {
  /** Whether the site takes payments right now. */
  canSell: boolean;
  currency: string | null;
  locale: Locale;
  seriesId: string;
  seriesPublicId: string;
  taxIncluded: boolean;
  tenantId: string;
  volume: VolumeItem;
}) => {
  const state = await getMySeriesPurchaseState(tenantId, seriesId, locale);

  if (!state.ok) {
    return null;
  }

  // Owned rather than readable: a reader renting every episode, or holding a
  // ticket for each, is still offered the volume that keeps them for good.
  const owned =
    volume.episodeIds.length > 0 &&
    volume.episodeIds.every((id) => state.ownedEpisodeIds.has(id));

  if (owned) {
    return (
      <p className="text-sm text-success">
        <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
          <Message message="storefront.series.volume_owned" />
        </Suspense>
      </p>
    );
  }

  if (!canSell) {
    return null;
  }

  return (
    <VolumeBuyForm
      currency={currency}
      locale={locale}
      seriesPublicId={seriesPublicId}
      taxIncluded={taxIncluded}
      tenantId={tenantId}
      volumeId={volume.id}
    />
  );
};

/**
 * Where the volume's printed book is sold, as a row of buttons that open each
 * bookstore in a new tab; nothing at all for a volume with no links.
 *
 * The links come with the shared series read, so the row stays in the cached
 * card rather than in {@link VolumePurchaseControl}.
 */
export const VolumeBookstoreLinks = ({
  links,
}: {
  links: VolumeBookstoreLink[];
}) =>
  links.length > 0 ? (
    <div className="grid gap-2">
      <h4 className="text-sm font-medium">
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="storefront.series.volume_bookstore_links_heading" />
        </Suspense>
      </h4>
      <ul className="flex flex-wrap gap-2">
        {links.map((link) => (
          <li className="max-w-full" key={`${link.label} ${link.url}`}>
            <LinkButton
              className="max-w-full"
              href={link.url}
              rel="noopener noreferrer"
              size="sm"
              target="_blank"
              variant="outline"
            >
              <span className="truncate">{link.label}</span>
              <ExternalLinkIcon
                aria-hidden="true"
                className="size-4 shrink-0"
              />
            </LinkButton>
          </li>
        ))}
      </ul>
    </div>
  ) : null;

/**
 * The volumes inside the promotion code's state, with the **Promotion code**
 * field above them, once for the whole section: a signed-in reader who can
 * still buy a volume applies one code to all of them, for one lookup. Elsewhere
 * the cards render as they do without a code.
 *
 * Member-specific and read from the query, so the caller holds the cards as
 * this component's fallback rather than holding them back. Keyed on the code
 * the URL carried: a checkout refused for its code comes back with it, and the
 * field starts over from that quote.
 */
const VolumePromotionCodeScope = async ({
  children,
  locale,
  searchParams,
  seriesId,
  seriesPublicId,
  tenantId,
  volumes,
}: {
  children: ReactNode;
  locale: Locale;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  seriesId: string;
  seriesPublicId: string;
  tenantId: string;
  volumes: VolumeItem[];
}) => {
  const [sessionId, state, query] = await Promise.all([
    resolveAccessToken(),
    getMySeriesPurchaseState(tenantId, seriesId, locale),
    searchParams,
  ]);

  const volumeIds = state.ok
    ? quotableVolumeIds(volumes, state.ownedEpisodeIds)
    : [];

  if (!sessionId || volumeIds.length === 0) {
    return children;
  }

  const code = parseSeriesCheckoutSearchParams(query).promotion_code;

  const offer = await toVolumePromotionCodeOffer({
    code,
    sessionId,
    tenantId,
    volumeIds,
  });

  return (
    <PromotionCode.Root
      action={applyVolumePromotionCodeAction}
      initialState={offer}
      key={code}
    >
      <PromotionCode.Field subject="volumes">
        <input name="tenantId" type="hidden" value={tenantId} />
        <input name="seriesPublicId" type="hidden" value={seriesPublicId} />
        {volumeIds.map((volumeId) => (
          <input
            key={volumeId}
            name="volumeIds"
            type="hidden"
            value={volumeId}
          />
        ))}
      </PromotionCode.Field>
      {children}
    </PromotionCode.Root>
  );
};

/**
 * One card per volume, with its cover, its size, and its price, the control
 * that buys it, and the bookstores that sell its printed book.
 */
const VolumeCards = ({
  locale,
  sales,
  seriesEyeCatchImageVariants,
  seriesId,
  seriesPublicId,
  tenantId,
  volumes,
}: {
  locale: Locale;
  sales: TenantSales;
  seriesEyeCatchImageVariants: EyeCatchImageVariant[] | undefined;
  seriesId: string;
  seriesPublicId: string;
  tenantId: string;
  volumes: VolumeItem[];
}) => (
  <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {volumes.map((volume) => (
      <li key={volume.publicId}>
        <article className="flex h-full gap-4 border border-border bg-card p-4">
          <EyeCatchFrame
            alt=""
            className="aspect-3/4 w-20 shrink-0 rounded-surface"
            preferredType="portrait"
            sizes="80px"
            variants={volume.coverImageVariants ?? seriesEyeCatchImageVariants}
          />
          <div className="grid min-w-0 flex-1 content-start gap-2">
            <h3 className="font-serif text-lg leading-tight">{volume.title}</h3>
            <p className="flex flex-wrap items-baseline gap-x-3 text-sm text-muted-foreground">
              <span className="tabular-nums">
                <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                  <Message
                    message="storefront.series.episode_count"
                    values={{ count: volume.episodeIds.length }}
                  />
                </Suspense>
              </span>
              {sales.currency ? (
                <span className="inline-flex items-baseline gap-x-1">
                  <span className="font-medium text-foreground tabular-nums">
                    {formatPrice(volume.price, {
                      currency: sales.currency,
                      locale,
                    })}
                  </span>
                  {sales.taxIncluded ? (
                    <span className="text-xs font-normal text-muted-foreground">
                      <Suspense
                        fallback={
                          <SkeletonLine className="inline-block h-3 w-12" />
                        }
                      >
                        <Message message="storefront.common.tax_included" />
                      </Suspense>
                    </span>
                  ) : null}
                </span>
              ) : null}
            </p>
            <Suspense
              fallback={sales.web ? <Skeleton className="h-9 w-28" /> : null}
            >
              <VolumePurchaseControl
                canSell={sales.web}
                currency={sales.currency}
                locale={locale}
                seriesId={seriesId}
                seriesPublicId={seriesPublicId}
                taxIncluded={sales.taxIncluded}
                tenantId={tenantId}
                volume={volume}
              />
            </Suspense>
            <VolumeBookstoreLinks links={volume.bookstoreLinks} />
          </div>
        </article>
      </li>
    ))}
  </ul>
);

/**
 * The volumes the site sells of the series.
 *
 * A volume is sold only where the site takes payments, so without them the
 * cards say what each volume holds and costs and offer nothing to press, the
 * way an episode row quotes a price nobody can pay right now; a reader who
 * already holds a volume is still told so. A price is not
 * quoted at all while the tenant's currency is unknown, and says it includes
 * tax while the tenant states a rate. Where the site sells through more than
 * one provider, the reader chooses which under the heading, once for every
 * card.
 */
export const SeriesVolumes = ({
  acceptsPromotionCodes,
  locale,
  sales,
  searchParams,
  seriesEyeCatchImageVariants,
  seriesId,
  seriesPublicId,
  tenantId,
  volumes,
}: {
  /** Whether the tenant holds a code a reader could enter. */
  acceptsPromotionCodes: boolean;
  locale: Locale;
  sales: TenantSales;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  /** What a volume without a cover of its own shows instead. */
  seriesEyeCatchImageVariants: EyeCatchImageVariant[] | undefined;
  seriesId: string;
  seriesPublicId: string;
  tenantId: string;
  volumes: VolumeItem[];
}) => {
  if (volumes.length === 0) {
    return null;
  }

  const cards = (
    <VolumeCards
      locale={locale}
      sales={sales}
      seriesEyeCatchImageVariants={seriesEyeCatchImageVariants}
      seriesId={seriesId}
      seriesPublicId={seriesPublicId}
      tenantId={tenantId}
      volumes={volumes}
    />
  );

  return (
    <PaymentProviderChoice.Root
      providers={sales.web ? sales.paymentProviders : []}
      tenantId={tenantId}
    >
      <section className="grid gap-4">
        <h2 className="border-b border-border pb-2 font-serif text-xl leading-tight">
          <Suspense fallback={<SkeletonLine className="h-5 w-24" />}>
            <Message message="storefront.series.volumes_heading" />
          </Suspense>
        </h2>
        <PaymentProviderChoice.Picker />
        <Suspense fallback={null}>
          <VolumeOwnershipFailure
            locale={locale}
            seriesId={seriesId}
            tenantId={tenantId}
          />
        </Suspense>
        {acceptsPromotionCodes && sales.web && sales.currency ? (
          <Suspense fallback={cards}>
            <VolumePromotionCodeScope
              locale={locale}
              searchParams={searchParams}
              seriesId={seriesId}
              seriesPublicId={seriesPublicId}
              tenantId={tenantId}
              volumes={volumes}
            >
              {cards}
            </VolumePromotionCodeScope>
          </Suspense>
        ) : (
          cards
        )}
      </section>
    </PaymentProviderChoice.Root>
  );
};
