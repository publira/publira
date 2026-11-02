"use client";

import { Checkbox } from "@publira/ui-components/checkbox";
import { createContext, use, useMemo, useState } from "react";
import type { ReactNode } from "react";

import * as AnnouncementAudience from "./announcement-audience-fields";

interface AnnouncementPinnedContextValue {
  pinned: boolean;
  setPinned: (pinned: boolean) => void;
  /** Whether conditions rule the banner out, which closes the switch. */
  targeted: boolean;
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

const AnnouncementPinnedState = ({
  children,
  initialPinned,
  targeted,
}: {
  children: ReactNode;
  initialPinned: boolean;
  targeted: boolean;
}) => {
  const [pinned, setPinned] = useState(initialPinned);

  const context = useMemo(
    () => ({ pinned, setPinned, targeted }),
    [pinned, targeted]
  );

  return (
    <AnnouncementPinnedContext value={context}>
      {children}
    </AnnouncementPinnedContext>
  );
};

/**
 * Whether the announcement goes out as a site banner, which asks for its stop
 * time. A targeted announcement is never one, so while it has conditions the
 * switch is off and closed, and it comes back as it started once they are
 * gone: the state is remounted rather than carried across.
 */
const AnnouncementPinned = ({
  children,
  initialPinned = false,
}: {
  children: ReactNode;
  /** Whether the announcement being edited is a banner. */
  initialPinned?: boolean;
}) => {
  const targeted = AnnouncementAudience.useTargeted();

  return (
    <AnnouncementPinnedState
      initialPinned={!targeted && initialPinned}
      key={String(targeted)}
      targeted={targeted}
    >
      {children}
    </AnnouncementPinnedState>
  );
};

/** The banner switch, posted as `pinned`. */
const AnnouncementPinnedCheckbox = () => {
  const { pinned, setPinned, targeted } = useAnnouncementPinned();

  return (
    <Checkbox
      checked={pinned}
      disabled={targeted}
      name="pinned"
      onCheckedChange={setPinned}
      value="on"
    />
  );
};

/** Renders its children while the announcement is a banner. */
const AnnouncementPinnedWhile = ({ children }: { children: ReactNode }) =>
  useAnnouncementPinned().pinned ? children : null;

export {
  AnnouncementPinned as Root,
  AnnouncementPinnedCheckbox as Checkbox,
  AnnouncementPinnedWhile as While,
};
