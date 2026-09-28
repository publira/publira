"use client";

import { Checkbox } from "@publira/ui-components/checkbox";
import { createContext, use, useMemo, useState } from "react";
import type { ReactNode } from "react";

interface AnnouncementPinnedContextValue {
  pinned: boolean;
  setPinned: (pinned: boolean) => void;
}

const AnnouncementPinnedContext =
  createContext<AnnouncementPinnedContextValue | null>(null);

const useAnnouncementPinned = () => {
  const context = use(AnnouncementPinnedContext);
  if (!context) {
    throw new Error(
      "AnnouncementPinned slots must be rendered inside AnnouncementPinned."
    );
  }
  return context;
};

/** Whether the announcement goes out as a site banner, which asks for its stop time. */
export const AnnouncementPinned = ({ children }: { children: ReactNode }) => {
  const [pinned, setPinned] = useState(false);
  const context = useMemo(() => ({ pinned, setPinned }), [pinned]);

  return (
    <AnnouncementPinnedContext value={context}>
      {children}
    </AnnouncementPinnedContext>
  );
};

/** The banner switch, posted as `pinned`. */
export const AnnouncementPinnedCheckbox = () => {
  const { pinned, setPinned } = useAnnouncementPinned();

  return (
    <Checkbox
      checked={pinned}
      name="pinned"
      onCheckedChange={setPinned}
      value="on"
    />
  );
};

/** Renders its children while the announcement is a banner. */
export const AnnouncementPinnedWhile = ({
  children,
}: {
  children: ReactNode;
}) => (useAnnouncementPinned().pinned ? children : null);
