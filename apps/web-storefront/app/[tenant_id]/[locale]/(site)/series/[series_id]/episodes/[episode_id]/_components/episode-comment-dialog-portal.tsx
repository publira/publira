"use client";

import { DialogPortal } from "@publira/ui-components/dialog";
import { useSyncExternalStore } from "react";
import type { ReactNode } from "react";

const subscribeToFullscreen = (onStoreChange: () => void) => {
  document.addEventListener("fullscreenchange", onStoreChange);

  return () => {
    document.removeEventListener("fullscreenchange", onStoreChange);
  };
};

const getFullscreenContainer = (): HTMLElement | null =>
  document.fullscreenElement instanceof HTMLElement
    ? document.fullscreenElement
    : null;

/** Nothing is full screen while rendering on the server. */
const getNullOnServer = () => null;

/**
 * The comments dialog's portal, which follows the element the reader made full
 * screen: a popup appended to `<body>` is not painted while another element
 * owns the screen.
 */
export const EpisodeCommentDialogPortal = ({
  children,
}: {
  children: ReactNode;
}) => {
  const fullscreenContainer = useSyncExternalStore(
    subscribeToFullscreen,
    getFullscreenContainer,
    getNullOnServer
  );

  return (
    // `undefined` rather than `null`, which the portal reads as a container it
    // is still waiting for and renders nothing into.
    <DialogPortal container={fullscreenContainer ?? undefined}>
      {children}
    </DialogPortal>
  );
};
