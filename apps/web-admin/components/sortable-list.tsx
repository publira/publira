"use client";

import { move } from "@dnd-kit/helpers";
import { DragDropProvider } from "@dnd-kit/react";
import type { DragEndEvent } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { GripVerticalIcon } from "@publira/icons";
import { cn } from "@publira/utils";
import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";

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
}: SortableListProps) => (
  <DragDropProvider onDragEnd={onDragEnd}>
    <ul {...props} className={className}>
      {children}
    </ul>
  </DragDropProvider>
);

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
  type,
}: SortableItemProps) => {
  const { handleRef, isDragging, ref } = useSortable({
    accept,
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
 * icon, so the copy stays a node with a boundary of its own.
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
  const handle = useContext(SortableItemContext);
  if (handle === null) {
    throw new Error("SortableItem is required.");
  }
  const { disabled, handleRef } = handle;

  return (
    <button
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
