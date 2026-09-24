"use client";

import { Accessibility } from "@dnd-kit/dom";
import type { Draggable } from "@dnd-kit/dom";
import { move } from "@dnd-kit/helpers";
import { DragDropProvider } from "@dnd-kit/react";
import type { DragEndEvent } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import { GripVerticalIcon } from "@publira/icons";
import { cn } from "@publira/utils";
import { createContext, use, useContext, useMemo } from "react";
import type { ComponentProps, ReactNode } from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
import { useClientMessages } from "#components/client-message";
import type { AdminClientMessageAccessor } from "#lib/messages";

/**
 * The items in the order a drop leaves them, or the array itself when the drop
 * moved nothing — which is what a cancelled drag and a drop back in place both
 * are, and what lets a caller skip the write.
 */
export const withItemMoved = <T,>(
  items: T[],
  itemId: (item: T) => string,
  event: DragEndEvent
): T[] => {
  const ids = items.map(itemId);
  const nextIds = move(ids, event);
  if (nextIds === ids) {
    return items;
  }

  const byId = new Map(ids.map((id, index) => [id, items[index]]));
  return nextIds.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
};

/** What a row is announced as: the name its {@link SortableItem} was given. */
const labelOf = (source: Draggable): string =>
  (source.data as { label: string }).label;

/** The 1-based position a row holds now, or held when the drag began. */
const positionOf = (source: Draggable, initial = false): string => {
  if (!isSortable(source)) {
    return "";
  }
  return String((initial ? source.initialIndex : source.index) + 1);
};

/**
 * dnd-kit's own plugins, with its screen reader copy replaced by the console's.
 * Its defaults are English whatever the console's locale, and name a row by
 * its sortable id — a public id — rather than by what the screen calls it.
 */
const localizedPlugins =
  (
    t: AdminClientMessageAccessor
  ): ComponentProps<typeof DragDropProvider>["plugins"] =>
  (defaults) => {
    // The position last announced, so a dragover that leaves the row where it
    // was does not talk over the announcement before it.
    let announcedPosition = "";

    return defaults.map((plugin) =>
      plugin === Accessibility
        ? Accessibility.configure({
            announcements: {
              dragend: ({ canceled, operation: { source } }) => {
                if (!source) {
                  return;
                }
                return canceled
                  ? t("admin.common.sortable.cancelled", {
                      name: labelOf(source),
                      position: positionOf(source, true),
                    })
                  : t("admin.common.sortable.dropped", {
                      name: labelOf(source),
                      position: positionOf(source),
                    });
              },
              // A row's index moves after the dragover that carries it over
              // another row, and the sorting then makes the row its own target
              // again — which is the dragover its new position is read from.
              dragover: ({ operation: { source, target } }) => {
                if (!source || source.id !== target?.id) {
                  return;
                }
                const position = positionOf(source);
                if (position === announcedPosition) {
                  return;
                }
                announcedPosition = position;
                return t("admin.common.sortable.moved", {
                  name: labelOf(source),
                  position,
                });
              },
              dragstart: ({ operation: { source } }) => {
                if (!source) {
                  return;
                }
                announcedPosition = positionOf(source);
                return t("admin.common.sortable.picked_up", {
                  name: labelOf(source),
                  position: announcedPosition,
                });
              },
            },
            screenReaderInstructions: {
              draggable: t("admin.common.sortable.instructions"),
            },
          })
        : plugin
    );
  };

interface SortableItemContextValue {
  disabled: boolean;
  handleRef: (element: Element | null) => void;
}

const SortableItemContext = createContext<SortableItemContextValue | null>(
  null
);

interface SortableListProps {
  "aria-label"?: string;
  "aria-labelledby"?: string;
  children: ReactNode;
  className?: string;
  /** Where the list decides what a drop did, with {@link withItemMoved}. */
  onDragEnd: (event: DragEndEvent) => void;
}

/**
 * A list whose rows are reordered by dragging one of them — with a pointer, on
 * a touch screen, or from the keyboard, because dnd-kit binds a sensor for
 * each.
 *
 * Every reorderable list in the console is built from these three components,
 * so an operator meets the same control on each of them.
 */
export const SortableList = ({
  children,
  className,
  onDragEnd,
  ...props
}: SortableListProps) => {
  const locale = use(AdminLocaleContext);
  const t = useClientMessages();

  return (
    // dnd-kit reads the plugin's copy once, when it builds the plugin, so a
    // change of locale builds a new provider rather than updating this one.
    <DragDropProvider
      key={locale}
      onDragEnd={onDragEnd}
      plugins={localizedPlugins(t)}
    >
      <ul {...props} className={className}>
        {children}
      </ul>
    </DragDropProvider>
  );
};

interface SortableItemProps {
  /**
   * The groups this row takes a drop from, and the group it belongs to. Left
   * out, the whole list is one group.
   */
  accept?: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  id: string;
  index: number;
  /**
   * The row's name as the screen shows it, which a screen reader hears when
   * the row is picked up, moved, and dropped.
   */
  label: string;
  type?: string;
}

/**
 * One row, dragged by the {@link SortableItemHandle} inside it rather than by
 * itself, so the controls it holds still take a pointer.
 */
export const SortableItem = ({
  accept,
  children,
  className,
  disabled = false,
  id,
  index,
  label,
  type,
}: SortableItemProps) => {
  const { handleRef, isDragging, ref } = useSortable({
    accept,
    data: { label },
    disabled,
    id,
    index,
    type,
  });
  const handle = useMemo(
    () => ({ disabled, handleRef }),
    [disabled, handleRef]
  );

  return (
    <SortableItemContext.Provider value={handle}>
      <li className={cn(className, isDragging && "opacity-60")} ref={ref}>
        {children}
      </li>
    </SortableItemContext.Provider>
  );
};

/**
 * The grip a row is dragged by. It is a `button` so the keyboard sensor can
 * reach it: focus it, press Space, move with the arrow keys, press Space again
 * to drop.
 *
 * Its children are its accessible name, rendered visually hidden beside the
 * icon. Its role description is set here because dnd-kit only fills one in
 * when the element has none, and its own is English.
 *
 * The grip is the height of its own icon, which leaves it above the middle of
 * a row built around a taller control. Such a row gives it that control's
 * height through `className`, so the grip lines up with the field beside it
 * and stays put when a message grows the row underneath.
 */
export const SortableItemHandle = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => {
  const t = useClientMessages();
  const handle = useContext(SortableItemContext);
  if (handle === null) {
    throw new Error("SortableItem is required.");
  }
  const { disabled, handleRef } = handle;

  return (
    <button
      aria-roledescription={t("admin.common.sortable.role_description")}
      className={cn(
        "flex shrink-0 cursor-grab touch-none items-center justify-center rounded-control p-1 text-muted-foreground transition-colors duration-state ease-state hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      disabled={disabled}
      ref={handleRef}
      type="button"
    >
      <GripVerticalIcon aria-hidden="true" className="size-4" />
      <span className="sr-only">{children}</span>
    </button>
  );
};
