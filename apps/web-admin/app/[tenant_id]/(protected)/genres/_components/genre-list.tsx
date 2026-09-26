"use client";

import type { DragEndEvent } from "@dnd-kit/react";
import { LinkButton } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useOptimistic, useState, useTransition } from "react";

import { ClientMessage, useClientMessages } from "#components/client-message";
import {
  SortableItem,
  SortableItemHandle,
  SortableList,
  withItemMoved,
} from "#components/sortable-list";
import { useTenantId } from "#lib/use-tenant-id";

import { reorderGenresAction } from "../_lib/actions";
import type { GenreListItem } from "../genre-types";
import { GenreDeleteButton } from "./genre-delete-button";
import { GenreRenameForm } from "./genre-rename-form";

interface GenreListProps {
  genres: GenreListItem[];
}

const genreId = (genre: GenreListItem): string => genre.publicId;

/** The smallest square cut of the eye-catch, which is all a row has room for. */
const thumbnailOf = (genre: GenreListItem) =>
  genre.eyeCatchImageVariants
    .filter((variant) => variant.variantType === "square")
    .toSorted((a, b) => a.width - b.width)
    .at(0);

const GenreThumbnail = ({ genre }: { genre: GenreListItem }) => {
  const t = useClientMessages();
  const thumbnail = thumbnailOf(genre);

  return thumbnail ? (
    <Image
      alt={t("admin.genres.eye_catch_alt", { name: genre.name })}
      className="size-10 shrink-0 rounded-control border object-cover"
      height={40}
      src={thumbnail.url}
      width={40}
    />
  ) : (
    <div
      aria-hidden="true"
      className="size-10 shrink-0 rounded-control border border-dashed border-border bg-muted/40"
    />
  );
};

/**
 * The tenant's genres in their own order, with the controls that write it.
 *
 * A move posts the whole order rather than the one genre that moved, because
 * that is what `ReorderGenres` takes: the order the screen was showing goes up
 * beside the order it wants, and a list someone else has changed in the
 * meantime is refused instead of merged. The whole list therefore has to be on
 * screen, which is why this screen does not page.
 */
export const GenreList = ({ genres }: GenreListProps) => {
  const t = useClientMessages();
  const tenantId = useTenantId();
  const [isPending, startTransition] = useTransition();
  const [optimisticGenres, setOptimisticGenres] = useOptimistic(
    genres,
    (_currentGenres, nextGenres: GenreListItem[]) => nextGenres
  );
  const [reorderErrorMessage, setReorderErrorMessage] = useState("");

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const currentGenres = optimisticGenres;
      const nextGenres = withItemMoved(currentGenres, genreId, event);
      if (nextGenres === currentGenres) {
        return;
      }

      startTransition(async () => {
        setOptimisticGenres(nextGenres);

        const formData = new FormData();
        formData.set("tenant_id", tenantId);
        formData.set(
          "genre_public_ids",
          JSON.stringify(nextGenres.map(genreId))
        );
        // The order the list was rendered from, so a console left open while
        // someone else moved a genre is refused rather than merged.
        formData.set(
          "expected_genre_public_ids",
          JSON.stringify(currentGenres.map(genreId))
        );

        const result = await reorderGenresAction(formData);
        setReorderErrorMessage(result.ok ? "" : (result.message ?? ""));
      });
    },
    [optimisticGenres, setOptimisticGenres, tenantId]
  );

  return (
    <div className="grid gap-3">
      {reorderErrorMessage ? (
        <FormMessage variant="destructive">{reorderErrorMessage}</FormMessage>
      ) : null}
      <SortableList
        aria-label={t("admin.genres.list_title")}
        className="grid gap-3"
        onDragEnd={handleDragEnd}
      >
        {optimisticGenres.map((genre, index) => (
          <SortableItem
            className="grid gap-3 border border-border bg-background px-4 py-3 sm:flex sm:items-start sm:justify-between sm:gap-4"
            disabled={isPending}
            id={genre.publicId}
            index={index}
            key={genre.publicId}
            label={genre.name}
          >
            {/* The height of the name field beside it, so the grip is level
                with the row's first line rather than above it. */}
            <SortableItemHandle className="h-10">
              <ClientMessage
                message="admin.genres.reorder_action"
                values={{ name: genre.name }}
              />
            </SortableItemHandle>
            <div className="flex flex-1 items-start gap-3">
              <GenreThumbnail genre={genre} />
              <GenreRenameForm genre={genre} />
            </div>
            <div className="flex flex-wrap items-start gap-2">
              <LinkButton
                render={<Link href={`/genres/${genre.publicId}`} />}
                size="sm"
                variant="outline"
              >
                <ClientMessage message="admin.genres.edit_action" />
              </LinkButton>
              <GenreDeleteButton name={genre.name} publicId={genre.publicId} />
            </div>
          </SortableItem>
        ))}
      </SortableList>
    </div>
  );
};
