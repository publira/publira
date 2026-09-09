"use client";

import { getMessage } from "@publira/i18n";
import { ChevronDownIcon, ChevronUpIcon } from "@publira/icons";
import { Button } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import { useCallback, useOptimistic, useState, useTransition } from "react";

import { useAdminMessages } from "#components/admin-locale-context";
import { useTenantId } from "#lib/use-tenant-id";

import { reorderGenresAction } from "../_lib/actions";
import type { GenreListItem } from "../genre-types";
import { GenreDeleteButton } from "./genre-delete-button";
import { GenreRenameForm } from "./genre-rename-form";

interface GenreListProps {
  genres: GenreListItem[];
}

/** Where a move button sends the genre it sits on. */
type MoveDirection = -1 | 1;

const withGenreMoved = (
  genres: GenreListItem[],
  index: number,
  direction: MoveDirection
): GenreListItem[] | null => {
  const target = index + direction;
  if (target < 0 || target >= genres.length) {
    return null;
  }

  const moved = [...genres];
  const [genre] = moved.splice(index, 1);
  moved.splice(target, 0, genre);
  return moved;
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
  const messages = useAdminMessages();
  const tenantId = useTenantId();
  const [isPending, startTransition] = useTransition();
  const [optimisticGenres, setOptimisticGenres] = useOptimistic(
    genres,
    (_currentGenres, nextGenres: GenreListItem[]) => nextGenres
  );
  const [reorderErrorMessage, setReorderErrorMessage] = useState("");

  const moveGenre = useCallback(
    (index: number, direction: MoveDirection) => {
      const currentGenres = optimisticGenres;
      const nextGenres = withGenreMoved(currentGenres, index, direction);
      if (!nextGenres) {
        return;
      }

      startTransition(async () => {
        setOptimisticGenres(nextGenres);

        const formData = new FormData();
        formData.set("tenant_id", tenantId);
        formData.set(
          "genre_public_ids",
          JSON.stringify(nextGenres.map((genre) => genre.publicId))
        );
        // The order the buttons were rendered from, so a console left open
        // while someone else moved a genre is refused rather than merged.
        formData.set(
          "expected_genre_public_ids",
          JSON.stringify(currentGenres.map((genre) => genre.publicId))
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
      <ul
        aria-label={getMessage(messages, "admin.genres.list_title")}
        className="grid gap-3"
      >
        {optimisticGenres.map((genre, index) => (
          <li
            className="grid gap-3 rounded-lg border border-border/70 bg-background px-4 py-3 sm:flex sm:items-start sm:justify-between sm:gap-4"
            key={genre.publicId}
          >
            <GenreRenameForm genre={genre} />
            <div className="flex items-start gap-2">
              <Button
                aria-label={getMessage(
                  messages,
                  "admin.genres.move_up_action",
                  {
                    name: genre.name,
                  }
                )}
                disabled={isPending || index === 0}
                onClick={() => moveGenre(index, -1)}
                size="icon"
                type="button"
                variant="outline"
              >
                <ChevronUpIcon className="size-4" />
              </Button>
              <Button
                aria-label={getMessage(
                  messages,
                  "admin.genres.move_down_action",
                  { name: genre.name }
                )}
                disabled={isPending || index === optimisticGenres.length - 1}
                onClick={() => moveGenre(index, 1)}
                size="icon"
                type="button"
                variant="outline"
              >
                <ChevronDownIcon className="size-4" />
              </Button>
              <GenreDeleteButton name={genre.name} publicId={genre.publicId} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};
