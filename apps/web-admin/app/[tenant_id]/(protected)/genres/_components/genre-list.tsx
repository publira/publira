import { LinkButton } from "@publira/ui-components/button";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import { SortableItem, SortableItemHandle } from "#components/sortable-list";
import { getMessages } from "#lib/get-messages";

import type { GenreListItem } from "../genre-types";
import { GenreDeleteButton } from "./genre-delete-button";
import { GenreRenameForm } from "./genre-rename-form";
import { GenreSortableList } from "./genre-sortable-list";

interface GenreListProps {
  /**
   * Whether the operator may write the genres. Without it the list is the
   * genres in their order and nothing that would change them.
   */
  canEdit: boolean;
  genres: GenreListItem[];
  tenantId: string;
}

/** The smallest square cut of the eye-catch, which is all a row has room for. */
const thumbnailOf = (genre: GenreListItem) =>
  genre.eyeCatchImageVariants
    .filter((variant) => variant.variantType === "square")
    .toSorted((a, b) => a.width - b.width)
    .at(0);

const EmptyThumbnail = () => (
  <div
    aria-hidden="true"
    className="size-10 shrink-0 rounded-control border border-dashed border-border bg-muted/40"
  />
);

/** An `alt` cannot be a node, so the thumbnail resolves the catalog itself. */
const GenreThumbnailImage = async ({
  name,
  url,
}: {
  name: string;
  url: string;
}) => {
  const t = await getMessages();

  return (
    <Image
      alt={t("admin.genres.eye_catch_alt", { name })}
      className="size-10 shrink-0 rounded-control border object-cover"
      height={40}
      src={url}
      width={40}
    />
  );
};

const GenreThumbnail = ({ genre }: { genre: GenreListItem }) => {
  const thumbnail = thumbnailOf(genre);

  return thumbnail ? (
    <Suspense
      fallback={<Skeleton className="size-10 shrink-0 rounded-control" />}
    >
      <GenreThumbnailImage name={genre.name} url={thumbnail.url} />
    </Suspense>
  ) : (
    <EmptyThumbnail />
  );
};

const GenreRow = ({
  genre,
  tenantId,
}: {
  genre: GenreListItem;
  tenantId: string;
}) => (
  <SortableItem
    className="grid gap-3 border border-border bg-background px-4 py-3 sm:flex sm:items-start sm:justify-between sm:gap-4"
    id={genre.id}
    label={genre.name}
  >
    {/* The height of the name field beside it, so the grip is level with the
        row's first line rather than above it. */}
    <SortableItemHandle className="h-10">
      <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
        <Message
          message="admin.genres.reorder_action"
          values={{ name: genre.name }}
        />
      </Suspense>
    </SortableItemHandle>
    <div className="flex flex-1 items-start gap-3">
      <GenreThumbnail genre={genre} />
      <GenreRenameForm genre={genre} tenantId={tenantId} />
    </div>
    <div className="flex flex-wrap items-start gap-2">
      <LinkButton
        render={<Link href={`/genres/${genre.publicId}`} />}
        size="sm"
        variant="outline"
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="admin.genres.edit_action" />
        </Suspense>
      </LinkButton>
      <GenreDeleteButton id={genre.id} name={genre.name} tenantId={tenantId} />
    </div>
  </SortableItem>
);

/** A genre as a tenant auditor sees it: named, and opened to be viewed. */
const ReadOnlyGenreRow = ({ genre }: { genre: GenreListItem }) => (
  <li className="flex items-center justify-between gap-4 border border-border bg-background px-4 py-3">
    <div className="flex flex-1 items-center gap-3">
      <GenreThumbnail genre={genre} />
      <p className="text-sm font-medium">{genre.name}</p>
    </div>
    <LinkButton
      render={<Link href={`/genres/${genre.publicId}`} />}
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
 * The tenant's genres in their own order, with the controls that write it for
 * an operator who may.
 */
export const GenreList = ({ canEdit, genres, tenantId }: GenreListProps) =>
  canEdit ? (
    <GenreSortableList
      rows={genres.map((genre) => ({
        content: <GenreRow genre={genre} tenantId={tenantId} />,
        id: genre.id,
      }))}
      tenantId={tenantId}
    />
  ) : (
    <ul className="grid gap-3">
      {genres.map((genre) => (
        <ReadOnlyGenreRow genre={genre} key={genre.id} />
      ))}
    </ul>
  );
