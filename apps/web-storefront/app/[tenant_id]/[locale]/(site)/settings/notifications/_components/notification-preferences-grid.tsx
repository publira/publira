"use client";

import { Field, FieldLabel } from "@publira/ui-components/field";
import { Switch } from "@publira/ui-components/switch";
import { cn } from "@publira/utils";
import type { ReactNode } from "react";
import { createContext, use, useId, useMemo, useState } from "react";

import { ClientMessage } from "#components/client-message";
import type { NotificationPreferenceCells } from "#lib/auth";

import type {
  CellGroupState,
  NotificationCategory,
  NotificationCell,
  NotificationChannel,
} from "../_lib/notification-grid";
import {
  cellGroupState,
  columnCells,
  notificationCell,
  rowCells,
  toggleCellGroup,
} from "../_lib/notification-grid";

interface GridContextValue {
  cells: NotificationPreferenceCells;
  setCell: (cell: NotificationCell, checked: boolean) => void;
  toggle: (group: NotificationCell[]) => void;
}

const GridContext = createContext<GridContextValue | null>(null);

/**
 * The columns the heading line and every row share once the container is wide
 * enough. Each row is a grid of its own inside its fieldset, so the channel
 * columns are a fixed width rather than sized to their content: that is what
 * keeps them lined up from one row to the next.
 */
const GRID_COLUMNS = "@lg:grid @lg:grid-cols-[minmax(0,1fr)_repeat(3,7rem)]";

interface RowContextValue {
  category: NotificationCategory;
  labelId: string;
}

const RowContext = createContext<RowContextValue | null>(null);

const useGrid = (): GridContextValue => {
  const grid = use(GridContext);
  if (!grid) {
    throw new Error("A grid part must be rendered inside the grid.");
  }
  return grid;
};

const useRow = (): RowContextValue => {
  const row = use(RowContext);
  if (!row) {
    throw new Error("A row part must be rendered inside a row.");
  }
  return row;
};

/**
 * `aria-pressed` is the group's state as a screen reader hears it: pressed when
 * every cell is on, mixed when only some are.
 */
const ariaPressed = (state: CellGroupState): boolean | "mixed" =>
  state === "mixed" ? "mixed" : state === "on";

/**
 * A column's heading. Below the width the grid needs, the headings stand in a
 * line of their own above the rows, still turning a whole channel on or off.
 */
const ColumnToggle = ({
  channel,
  children,
}: {
  channel: NotificationChannel;
  children: ReactNode;
}) => {
  const { cells, toggle } = useGrid();
  const group = columnCells(channel);

  return (
    <button
      aria-pressed={ariaPressed(cellGroupState(cells, group))}
      className="rounded-control border border-input px-2 py-1 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none @lg:border-transparent @lg:text-center"
      onClick={() => toggle(group)}
      type="button"
    >
      {children}
    </button>
  );
};

/**
 * One category. Below the width the grid needs, it is a section of its own with
 * a labelled switch per channel; from there up it is a row of the grid, whose
 * columns the headings name.
 */
const Row = ({
  category,
  children,
}: {
  category: NotificationCategory;
  children: ReactNode;
}) => {
  const labelId = useId();
  const row = useMemo(() => ({ category, labelId }), [category, labelId]);

  // A fieldset named by the row's label rather than a legend: the label is the
  // button that toggles the row, and a legend is laid out outside the grid.
  return (
    <RowContext value={row}>
      <fieldset
        aria-labelledby={labelId}
        className="min-w-0 border-t border-border pt-3 @lg:py-2"
      >
        <div className={cn("grid gap-2 @lg:items-center", GRID_COLUMNS)}>
          {children}
        </div>
      </fieldset>
    </RowContext>
  );
};

/** A row's label, which turns every cell of the row on or off. */
const RowToggle = ({ children }: { children: ReactNode }) => {
  const { cells, toggle } = useGrid();
  const { category, labelId } = useRow();
  const group = rowCells(category);

  return (
    <button
      aria-pressed={ariaPressed(cellGroupState(cells, group))}
      className="justify-self-start rounded-control text-left text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      id={labelId}
      onClick={() => toggle(group)}
      type="button"
    >
      {children}
    </button>
  );
};

/**
 * One category on one channel. `children` names the channel: it is the
 * switch's label, shown beside it below the width the grid needs and left to
 * a screen reader above it, where the column heading names the channel.
 */
const Cell = ({
  channel,
  children,
}: {
  channel: NotificationChannel;
  children: ReactNode;
}) => {
  const { cells, setCell } = useGrid();
  const cell = notificationCell(useRow().category, channel);

  if (!cell) {
    return (
      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground @lg:justify-center">
        <span className="@lg:sr-only">{children}</span>
        <span>
          <span aria-hidden="true" className="hidden @lg:inline">
            —
          </span>
          <span className="text-xs @lg:sr-only">
            <ClientMessage message="storefront.settings.notification_cell_unavailable" />
          </span>
        </span>
      </div>
    );
  }

  return (
    <Field className="flex items-center justify-between gap-3 @lg:justify-center">
      <FieldLabel className="font-normal @lg:sr-only">{children}</FieldLabel>
      <Switch
        checked={cells[cell]}
        name={cell}
        onCheckedChange={(checked) => setCell(cell, checked)}
      />
    </Field>
  );
};

/**
 * The reader's notification preferences, one row per category and one column
 * per channel the server delivers. Every switch is a field of the surrounding
 * form; the row labels and column headings only move the switches and are
 * never submitted.
 *
 * The layout follows the width the grid is given, not the device: a container
 * narrower than the grid needs gets one section per category instead.
 */
export const NotificationPreferencesGrid = ({
  initialCells,
}: {
  initialCells: NotificationPreferenceCells;
}) => {
  const [cells, setCells] = useState(initialCells);
  const grid = useMemo<GridContextValue>(
    () => ({
      cells,
      setCell: (cell, checked) =>
        setCells((current) => ({ ...current, [cell]: checked })),
      toggle: (group) => setCells((current) => toggleCellGroup(current, group)),
    }),
    [cells]
  );

  return (
    <GridContext value={grid}>
      <div className="@container">
        <div className="grid gap-3 @lg:gap-0">
          <div className={cn("flex flex-wrap gap-2 @lg:pb-2", GRID_COLUMNS)}>
            <span aria-hidden="true" className="hidden @lg:block" />
            <ColumnToggle channel="inbox">
              <ClientMessage message="storefront.settings.notification_channel_inbox" />
            </ColumnToggle>
            <ColumnToggle channel="webPush">
              <ClientMessage message="storefront.settings.notification_channel_web_push" />
            </ColumnToggle>
            <ColumnToggle channel="mobilePush">
              <ClientMessage message="storefront.settings.notification_channel_mobile_push" />
            </ColumnToggle>
          </div>

          <Row category="followedEpisodes">
            <RowToggle>
              <ClientMessage message="storefront.settings.notification_category_followed_episodes" />
            </RowToggle>
            <Cell channel="inbox">
              <ClientMessage message="storefront.settings.notification_channel_inbox" />
            </Cell>
            <Cell channel="webPush">
              <ClientMessage message="storefront.settings.notification_channel_web_push" />
            </Cell>
            <Cell channel="mobilePush">
              <ClientMessage message="storefront.settings.notification_channel_mobile_push" />
            </Cell>
          </Row>

          <Row category="followedCreators">
            <RowToggle>
              <ClientMessage message="storefront.settings.notification_category_followed_creators" />
            </RowToggle>
            <Cell channel="inbox">
              <ClientMessage message="storefront.settings.notification_channel_inbox" />
            </Cell>
            <Cell channel="webPush">
              <ClientMessage message="storefront.settings.notification_channel_web_push" />
            </Cell>
            <Cell channel="mobilePush">
              <ClientMessage message="storefront.settings.notification_channel_mobile_push" />
            </Cell>
          </Row>

          <Row category="comments">
            <RowToggle>
              <ClientMessage message="storefront.settings.notification_category_comments" />
            </RowToggle>
            <Cell channel="inbox">
              <ClientMessage message="storefront.settings.notification_channel_inbox" />
            </Cell>
            <Cell channel="webPush">
              <ClientMessage message="storefront.settings.notification_channel_web_push" />
            </Cell>
            <Cell channel="mobilePush">
              <ClientMessage message="storefront.settings.notification_channel_mobile_push" />
            </Cell>
          </Row>

          <Row category="announcements">
            <RowToggle>
              <ClientMessage message="storefront.settings.notification_category_announcements" />
            </RowToggle>
            <Cell channel="inbox">
              <ClientMessage message="storefront.settings.notification_channel_inbox" />
            </Cell>
            <Cell channel="webPush">
              <ClientMessage message="storefront.settings.notification_channel_web_push" />
            </Cell>
            <Cell channel="mobilePush">
              <ClientMessage message="storefront.settings.notification_channel_mobile_push" />
            </Cell>
          </Row>
        </div>
      </div>
    </GridContext>
  );
};
