"use client";

import { createContext, use, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { InstantInput } from "#components/instant-input";

interface AnnouncementScheduleContextValue {
  scheduled: boolean;
  setScheduled: (scheduled: boolean) => void;
}

const AnnouncementScheduleContext =
  createContext<AnnouncementScheduleContextValue | null>(null);

const useAnnouncementSchedule = () => {
  const context = use(AnnouncementScheduleContext);

  if (!context) {
    throw new Error(
      "AnnouncementSchedule slots must be rendered inside AnnouncementSchedule."
    );
  }

  return context;
};

/**
 * Whether the announcement is given a time to go out at, which the submit
 * control names: delivering it now and scheduling it are different promises.
 */
const AnnouncementSchedule = ({
  children,
  initialDeliverAt,
}: {
  children: ReactNode;
  /** The stored delivery time on edit, empty for now. */
  initialDeliverAt: string;
}) => {
  const [scheduled, setScheduled] = useState(initialDeliverAt !== "");
  const context = useMemo(() => ({ scheduled, setScheduled }), [scheduled]);

  return (
    <AnnouncementScheduleContext value={context}>
      {children}
    </AnnouncementScheduleContext>
  );
};

/** The delivery time, posted as `deliver_at`; empty delivers the announcement now. */
const AnnouncementScheduleInput = ({
  initialDeliverAt,
  timeZone,
}: {
  initialDeliverAt: string;
  timeZone: string;
}) => {
  const { setScheduled } = useAnnouncementSchedule();

  return (
    <InstantInput
      initialValue={initialDeliverAt}
      name="deliver_at"
      onValueChange={(localValue) => setScheduled(localValue !== "")}
      step={60}
      timeZone={timeZone}
    />
  );
};

/** Renders its children while the announcement has a time to go out at. */
const AnnouncementScheduleWhileScheduled = ({
  children,
}: {
  children: ReactNode;
}) => (useAnnouncementSchedule().scheduled ? children : null);

/** Renders its children while the announcement goes out on submission. */
const AnnouncementScheduleWhileImmediate = ({
  children,
}: {
  children: ReactNode;
}) => (useAnnouncementSchedule().scheduled ? null : children);

export {
  AnnouncementSchedule as Root,
  AnnouncementScheduleInput as Input,
  AnnouncementScheduleWhileImmediate as WhileImmediate,
  AnnouncementScheduleWhileScheduled as WhileScheduled,
};
