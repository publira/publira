"use client";

import { Tabs } from "@base-ui/react/tabs";
import { cn } from "@publira/utils";
import type { ReactNode } from "react";

/**
 * `aria-selected` rather than Base UI's own `data-active`: the attribute that
 * marks the open day is written on the client, so a strip styled by it renders
 * with no day underlined until the page hydrates. `aria-selected` is in the
 * server's markup, which is where the open day is decided.
 */
const DAY = cn(
  "-mb-px cursor-pointer border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground transition-colors duration-state ease-state hover:text-foreground aria-selected:border-primary aria-selected:text-foreground"
);

/**
 * The week as one strip of days, each holding the series that expect an
 * episode on it.
 *
 * `defaultWeekday` opens the strip on the day it is where the tenant
 * publishes, and nothing here reads a clock: the day arrives already decided,
 * so a reader in another zone still sees the schedule the tenant keeps. The
 * strip is uncontrolled from there — which day is open afterwards is the
 * reader's, and no Effect copies it back.
 *
 * A day is a tab rather than a link because the whole week is already on the
 * page: a `?weekday=` in the URL would make the home page read its query, and
 * with it cost every other module on that page its prerendered shell.
 */
export const WeeklySchedule = ({
  children,
  defaultWeekday,
}: {
  children: ReactNode;
  /** `EXTRACT(DOW)`: 0 is Sunday and 6 is Saturday. */
  defaultWeekday: number;
}) => (
  <Tabs.Root className="grid gap-6" defaultValue={defaultWeekday}>
    {children}
  </Tabs.Root>
);

/** The row of days. `aria-label` says what the strip switches between. */
export const WeeklyScheduleDays = ({
  "aria-label": ariaLabel,
  children,
}: {
  "aria-label": string;
  children: ReactNode;
}) => (
  <Tabs.List
    aria-label={ariaLabel}
    className="flex flex-wrap border-b border-border"
  >
    {children}
  </Tabs.List>
);

export const WeeklyScheduleDay = ({
  children,
  weekday,
}: {
  children: ReactNode;
  weekday: number;
}) => (
  <Tabs.Tab className={DAY} value={weekday}>
    {children}
  </Tabs.Tab>
);

export const WeeklyScheduleDayPanel = ({
  children,
  weekday,
}: {
  children: ReactNode;
  weekday: number;
}) => <Tabs.Panel value={weekday}>{children}</Tabs.Panel>;
