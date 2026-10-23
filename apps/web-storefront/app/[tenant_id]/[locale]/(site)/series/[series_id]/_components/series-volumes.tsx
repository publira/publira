import type { Locale } from "@publira/i18n";
import { Button } from "@publira/ui-components/button";
import * as SectionError from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { formatPrice } from "@publira/utils";
import { Suspense } from "react";

import { EyeCatchFrame } from "#components/eye-catch-frame";
import { LocaleField } from "#components/locale-field";
import { Message } from "#components/message";
import type { TenantSales } from "#lib/app-payments";
import type { EyeCatchImageVariant, VolumeItem } from "#lib/catalog";
import { getMySeriesPurchaseState } from "#lib/series-purchases";

import { startVolumeCheckoutAction } from "../_lib/actions";

/** The button a volume is bought with, which the purchase control renders. */
const VolumeBuyForm = ({
  seriesPublicId,
  tenantId,
  volumeId,
}: {
  seriesPublicId: string;
  tenantId: string;
  volumeId: string;
}) => (
  <form action={startVolumeCheckoutAction}>
    <LocaleField />
    <input name="tenantId" type="hidden" value={tenantId} />
    <input name="seriesPublicId" type="hidden" value={seriesPublicId} />
    <input name="volumeId" type="hidden" value={volumeId} />
    <Button type="submit" variant="outline">
      <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
        <Message message="storefront.series.volume_buy" />
      </Suspense>
    </Button>
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
  locale,
  seriesId,
  seriesPublicId,
  tenantId,
  volume,
}: {
  /** Whether the site takes payments right now. */
  canSell: boolean;
  locale: Locale;
  seriesId: string;
  seriesPublicId: string;
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
      seriesPublicId={seriesPublicId}
      tenantId={tenantId}
      volumeId={volume.id}
    />
  );
};

/**
 * The volumes the site sells of the series, each a card with its cover, its
 * size, and its price, and the control that buys it.
 *
 * A volume is sold only where the site takes payments, so without them the
 * cards say what each volume holds and costs and offer nothing to press, the
 * way an episode row quotes a price nobody can pay right now; a reader who
 * already holds a volume is still told so. A price is not
 * quoted at all while the tenant's currency is unknown.
 */
export const SeriesVolumes = ({
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
  /** What a volume without a cover of its own shows instead. */
  seriesEyeCatchImageVariants: EyeCatchImageVariant[] | undefined;
  seriesId: string;
  seriesPublicId: string;
  tenantId: string;
  volumes: VolumeItem[];
}) =>
  volumes.length > 0 ? (
    <section className="grid gap-4">
      <h2 className="border-b border-border pb-2 font-serif text-xl leading-tight">
        <Suspense fallback={<SkeletonLine className="h-5 w-24" />}>
          <Message message="storefront.series.volumes_heading" />
        </Suspense>
      </h2>
      <Suspense fallback={null}>
        <VolumeOwnershipFailure
          locale={locale}
          seriesId={seriesId}
          tenantId={tenantId}
        />
      </Suspense>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {volumes.map((volume) => (
          <li key={volume.publicId}>
            <article className="flex h-full gap-4 border border-border bg-card p-4">
              <EyeCatchFrame
                alt=""
                className="aspect-3/4 w-20 shrink-0 rounded-surface"
                preferredType="portrait"
                sizes="80px"
                variants={
                  volume.coverImageVariants ?? seriesEyeCatchImageVariants
                }
              />
              <div className="grid min-w-0 flex-1 content-start gap-2">
                <h3 className="font-serif text-lg leading-tight">
                  {volume.title}
                </h3>
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
                    <span className="font-medium text-foreground tabular-nums">
                      {formatPrice(volume.price, {
                        currency: sales.currency,
                        locale,
                      })}
                    </span>
                  ) : null}
                </p>
                <Suspense
                  fallback={
                    sales.web ? <Skeleton className="h-9 w-28" /> : null
                  }
                >
                  <VolumePurchaseControl
                    canSell={sales.web}
                    locale={locale}
                    seriesId={seriesId}
                    seriesPublicId={seriesPublicId}
                    tenantId={tenantId}
                    volume={volume}
                  />
                </Suspense>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </section>
  ) : null;
