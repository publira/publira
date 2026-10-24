import type { Locale } from "@publira/i18n";
import { LinkButton } from "@publira/ui-components/button";
import * as EmptyState from "@publira/ui-components/empty-state";
import * as SectionError from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import * as Sortable from "#components/sortable-list";
import { getMessages } from "#lib/get-messages";
import { formatTenantAmount } from "#lib/price";
import type { VolumeItem } from "#lib/volume";

import { VolumeSortableList } from "./volume-sortable-list";
import { VolumeStatusChip } from "./volume-status";

interface VolumeListProps {
  /**
   * Whether the operator may write the volumes. Without it the list is the
   * volumes in their order and nothing that would change them.
   */
  canEdit: boolean;
  /** The tenant's currency, or `null` while it cannot be read. */
  currency: string | null;
  listErrorMessage?: string;
  locale: Locale;
  seriesId: string;
  seriesPublicId: string;
  tenantId: string;
  volumes: VolumeItem[];
}

/** The smallest portrait cut of the cover, which is all a row has room for. */
const thumbnailOf = (volume: VolumeItem) =>
  volume.coverImageVariants
    .filter((variant) => variant.variantType === "portrait")
    .toSorted((a, b) => a.width - b.width)
    .at(0);

/** An `alt` cannot be a node, so the thumbnail resolves the catalog itself. */
const VolumeThumbnailImage = async ({
  title,
  url,
}: {
  title: string;
  url: string;
}) => {
  const t = await getMessages();

  return (
    <Image
      alt={t("admin.series.volumes.cover_alt", { title })}
      className="aspect-[3/4] w-12 shrink-0 rounded-control border object-cover"
      height={64}
      src={url}
      width={48}
    />
  );
};

const VolumeThumbnail = ({ volume }: { volume: VolumeItem }) => {
  const thumbnail = thumbnailOf(volume);

  return thumbnail ? (
    <Suspense
      fallback={
        <Skeleton className="aspect-[3/4] w-12 shrink-0 rounded-control" />
      }
    >
      <VolumeThumbnailImage title={volume.title} url={thumbnail.url} />
    </Suspense>
  ) : (
    <div
      aria-hidden="true"
      className="aspect-[3/4] w-12 shrink-0 rounded-control border border-dashed border-border bg-muted/40"
    />
  );
};

/** What the row says of the volume: its cover, title, price, and episodes. */
const VolumeSummary = ({
  currency,
  locale,
  volume,
}: {
  currency: string | null;
  locale: Locale;
  volume: VolumeItem;
}) => (
  <div className="flex min-w-0 flex-1 items-start gap-3">
    <VolumeThumbnail volume={volume} />
    <div className="grid min-w-0 gap-1">
      <p className="truncate text-sm font-medium">{volume.title}</p>
      <p className="text-sm text-muted-foreground tabular-nums">
        {formatTenantAmount(volume.price, { currency, locale })}
        {" · "}
        <Suspense fallback={<SkeletonLine className="inline-block h-4 w-20" />}>
          <Message
            message="admin.series.volumes.episode_count"
            values={{ count: volume.episodeIds.length }}
          />
        </Suspense>
      </p>
      <div>
        <VolumeStatusChip published={volume.published} />
      </div>
    </div>
  </div>
);

const volumePath = (seriesPublicId: string, volume: VolumeItem): string =>
  `/series/${seriesPublicId}/volumes/${volume.publicId}`;

const VolumeRow = ({
  currency,
  locale,
  seriesPublicId,
  volume,
}: {
  currency: string | null;
  locale: Locale;
  seriesPublicId: string;
  volume: VolumeItem;
}) => (
  <Sortable.Item
    className="flex items-start gap-3 border border-border bg-background px-4 py-3 sm:gap-4"
    id={volume.id}
    label={volume.title}
  >
    <Sortable.ItemHandle>
      <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
        <Message
          message="admin.series.volumes.reorder_action"
          values={{ title: volume.title }}
        />
      </Suspense>
    </Sortable.ItemHandle>
    <VolumeSummary currency={currency} locale={locale} volume={volume} />
    <LinkButton
      render={<Link href={volumePath(seriesPublicId, volume)} />}
      size="sm"
      variant="outline"
    >
      <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
        <Message message="admin.series.volumes.edit_action" />
      </Suspense>
    </LinkButton>
  </Sortable.Item>
);

/** A volume as a tenant auditor sees it: described, and opened to be viewed. */
const ReadOnlyVolumeRow = ({
  currency,
  locale,
  seriesPublicId,
  volume,
}: {
  currency: string | null;
  locale: Locale;
  seriesPublicId: string;
  volume: VolumeItem;
}) => (
  <li className="flex items-start justify-between gap-4 border border-border bg-background px-4 py-3">
    <VolumeSummary currency={currency} locale={locale} volume={volume} />
    <LinkButton
      render={<Link href={volumePath(seriesPublicId, volume)} />}
      size="sm"
      variant="outline"
    >
      <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
        <Message message="admin.common.view_action" />
      </Suspense>
    </LinkButton>
  </li>
);

/**
 * The series' volumes in their own order — the order the series page lists
 * the ones on sale in — with the drag handle that writes it for an operator
 * who may.
 */
export const VolumeList = ({
  canEdit,
  currency,
  listErrorMessage,
  locale,
  seriesId,
  seriesPublicId,
  tenantId,
  volumes,
}: VolumeListProps) => {
  // A failed read still hands an empty array; the empty state next to the
  // error would read as "this series has no volumes".
  if (listErrorMessage) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-56" />}>
              <Message message="admin.series.volumes.list_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>
            {listErrorMessage}
          </SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  if (volumes.length === 0) {
    return (
      <EmptyState.Root>
        <EmptyState.Heading>
          <EmptyState.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-56" />}>
              <Message message="admin.series.volumes.empty_title" />
            </Suspense>
          </EmptyState.Title>
          <EmptyState.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              {canEdit ? (
                <Message message="admin.series.volumes.empty_description" />
              ) : (
                <Message message="admin.series.volumes.empty_description_read_only" />
              )}
            </Suspense>
          </EmptyState.Description>
        </EmptyState.Heading>
      </EmptyState.Root>
    );
  }

  return canEdit ? (
    <VolumeSortableList
      rows={volumes.map((volume) => ({
        content: (
          <VolumeRow
            currency={currency}
            locale={locale}
            seriesPublicId={seriesPublicId}
            volume={volume}
          />
        ),
        id: volume.id,
      }))}
      seriesId={seriesId}
      tenantId={tenantId}
    />
  ) : (
    <ul className="grid gap-3">
      {volumes.map((volume) => (
        <ReadOnlyVolumeRow
          currency={currency}
          key={volume.id}
          locale={locale}
          seriesPublicId={seriesPublicId}
          volume={volume}
        />
      ))}
    </ul>
  );
};
