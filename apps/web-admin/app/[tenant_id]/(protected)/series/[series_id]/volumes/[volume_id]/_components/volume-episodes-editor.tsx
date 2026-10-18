"use client";

import type { DragEndEvent } from "@dnd-kit/react";
import { CloseIcon, PlusIcon } from "@publira/icons";
import { Button } from "@publira/ui-components/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItems,
  ComboboxPopup,
} from "@publira/ui-components/combobox";
import type { ComboboxItem } from "@publira/ui-components/combobox";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { useCallback, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

import { ClientMessage, useClientMessages } from "#components/client-message";
import {
  SortableItem,
  SortableItemHandle,
  SortableList,
  withItemMoved,
} from "#components/sortable-list";

import type { VolumeEpisodeOption } from "../../volume-types";

interface VolumeEpisodesEditorProps {
  /** Every episode of the series, in the series' order. */
  episodes: VolumeEpisodeOption[];
  /**
   * The episodes the volume holds, read once. The list is this editor's own
   * state from then on, and what the form posts is the hidden field below.
   */
  initialEpisodeIds: string[];
  /**
   * The episodes that cannot be taken out: every one the volume held when it
   * was first put on sale, since a checkout started then still opens them.
   */
  lockedEpisodeIds: string[];
  /** Episodes another volume of the series holds, which this one cannot. */
  takenEpisodeIds: string[];
}

const identity = (id: string): string => id;

interface VolumeEpisodeRowProps {
  episode: VolumeEpisodeOption;
  index: number;
  locked: boolean;
  onRemove: () => void;
}

const VolumeEpisodeRow = ({
  episode,
  index,
  locked,
  onRemove,
}: VolumeEpisodeRowProps) => {
  const { pending } = useFormStatus();

  return (
    <SortableItem
      className="flex items-center gap-2 border border-border bg-background px-2 py-2 sm:gap-3 sm:px-3"
      disabled={pending}
      id={episode.id}
      index={index}
      label={episode.title}
    >
      <SortableItemHandle>
        <ClientMessage
          message="admin.series.volumes.episodes.reorder"
          values={{ title: episode.title }}
        />
      </SortableItemHandle>
      <span className="w-6 shrink-0 text-right text-sm text-muted-foreground tabular-nums">
        {index + 1}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">{episode.title}</span>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        <ClientMessage
          message="admin.series.volumes.episodes.position"
          values={{ position: episode.position }}
        />
      </span>
      {locked ? null : (
        <Button
          className="shrink-0"
          disabled={pending}
          onClick={onRemove}
          size="icon"
          type="button"
          variant="ghost"
        >
          <CloseIcon aria-hidden="true" className="size-4" />
          <span className="sr-only">
            <ClientMessage
              message="admin.series.volumes.episodes.remove"
              values={{ title: episode.title }}
            />
          </span>
        </Button>
      )}
    </SortableItem>
  );
};

/**
 * The episodes a purchase of the volume opens, in the volume's order, and the
 * controls that add, take out, and arrange them.
 *
 * Nothing is written until the form is saved, since `SetVolumeEpisodes`
 * replaces the whole list: an episode moved and another added go up together.
 * An episode another volume holds is not offered, and one the volume held
 * when it went on sale cannot be taken out — the API refuses both, so the
 * editor is never handed a list it would only fail to save.
 */
export const VolumeEpisodesEditor = ({
  episodes,
  initialEpisodeIds,
  lockedEpisodeIds,
  takenEpisodeIds,
}: VolumeEpisodesEditorProps) => {
  const t = useClientMessages();
  const { pending } = useFormStatus();
  // Seeded once per mount: the page keys this editor by the list it was read
  // with, so a save remounts it on what the API stored.
  const [episodeIds, setEpisodeIds] = useState(initialEpisodeIds);
  const [pickedEpisodeId, setPickedEpisodeId] = useState("");
  // Bumped after each add, so the picker starts over empty rather than
  // keeping the text of the episode it just added.
  const [pickerKey, setPickerKey] = useState(0);

  const episodesById = useMemo(
    () => new Map(episodes.map((episode) => [episode.id, episode])),
    [episodes]
  );
  const locked = useMemo(() => new Set(lockedEpisodeIds), [lockedEpisodeIds]);
  const candidateItems = useMemo<ComboboxItem[]>(() => {
    const unavailable = new Set([...takenEpisodeIds, ...episodeIds]);
    return episodes.flatMap((episode) =>
      unavailable.has(episode.id)
        ? []
        : [{ label: episode.title, value: episode.id }]
    );
  }, [episodeIds, episodes, takenEpisodeIds]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setEpisodeIds((current) => withItemMoved(current, identity, event));
  }, []);

  const handleAdd = useCallback(() => {
    if (!pickedEpisodeId) {
      return;
    }
    setEpisodeIds((current) =>
      current.includes(pickedEpisodeId)
        ? current
        : [...current, pickedEpisodeId]
    );
    setPickedEpisodeId("");
    setPickerKey((current) => current + 1);
  }, [pickedEpisodeId]);

  const handleRemove = (id: string) => {
    setEpisodeIds((current) => current.filter((episodeId) => episodeId !== id));
  };

  return (
    <div className="grid gap-3">
      {episodeIds.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <ClientMessage message="admin.series.volumes.episodes.none" />
        </p>
      ) : (
        <SortableList
          aria-label={t("admin.series.volumes.episodes.title")}
          className="grid gap-2"
          onDragEnd={handleDragEnd}
        >
          {episodeIds.map((id, index) => (
            <VolumeEpisodeRow
              episode={
                // An episode is never deleted while a volume holds it, so a
                // missing one is only a list read a moment apart from this.
                episodesById.get(id) ?? { id, position: 0, title: id }
              }
              index={index}
              key={id}
              locked={locked.has(id)}
              onRemove={() => handleRemove(id)}
            />
          ))}
        </SortableList>
      )}

      {candidateItems.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2">
          <Field className="min-w-48 flex-1">
            <FieldLabel>
              <ClientMessage message="admin.series.volumes.episodes.add_label" />
            </FieldLabel>
            <FieldContent>
              <Combobox
                disabled={pending}
                items={candidateItems}
                key={pickerKey}
                onValueChange={setPickedEpisodeId}
                value={pickedEpisodeId}
              >
                <ComboboxInput
                  placeholder={t(
                    "admin.series.volumes.episodes.add_placeholder"
                  )}
                />
                <ComboboxPopup>
                  <ComboboxEmpty>
                    <ClientMessage message="admin.series.volumes.episodes.no_match" />
                  </ComboboxEmpty>
                  <ComboboxItems />
                </ComboboxPopup>
              </Combobox>
            </FieldContent>
          </Field>
          <Button
            disabled={pending || !pickedEpisodeId}
            onClick={handleAdd}
            type="button"
            variant="outline"
          >
            <PlusIcon aria-hidden="true" className="size-4" />
            <ClientMessage message="admin.series.volumes.episodes.add" />
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          <ClientMessage message="admin.series.volumes.episodes.none_available" />
        </p>
      )}
      {takenEpisodeIds.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          <ClientMessage message="admin.series.volumes.episodes.taken_note" />
        </p>
      ) : null}

      <input
        name="episode_ids"
        type="hidden"
        value={JSON.stringify(episodeIds)}
      />
    </div>
  );
};
