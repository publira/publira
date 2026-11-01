"use client";

import { CloseIcon, SearchIcon } from "@publira/icons";
import * as Dialog from "@publira/ui-components/dialog";
import { Skeleton } from "@publira/ui-components/skeleton";
import { cn } from "@publira/utils";
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

const CatalogSearchDialogCloseContext = createContext<(() => void) | null>(
  null
);

const useCloseCatalogSearchDialog = (): (() => void) => {
  const close = useContext(CatalogSearchDialogCloseContext);

  if (!close) {
    throw new Error(
      "Catalog search dialog parts must be rendered inside CatalogSearchDialog.Root."
    );
  }

  return close;
};

/**
 * The catalog search as a dialog: a control shaped like a text field, and the
 * keyword and the series filters in a modal it opens.
 *
 * The band gives the search one control rather than the field and its button,
 * so the filters cost the row no width at all: they are in the dialog, not in
 * the band. The form inside it is a `GET` navigation to `/search`, and the
 * layout stays mounted across that navigation, so the dialog closes itself on
 * the way out rather than staying open over the results.
 */
const CatalogSearchDialogRoot = ({ children }: { children: ReactNode }) => {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  return (
    <Dialog.Root onOpenChange={setOpen} open={open}>
      <CatalogSearchDialogCloseContext value={close}>
        {children}
      </CatalogSearchDialogCloseContext>
    </Dialog.Root>
  );
};

const TRIGGER = cn(
  "flex h-9 w-full min-w-0 items-center gap-2 rounded-control border border-input bg-card px-3 text-left text-sm text-muted-foreground transition-colors duration-state ease-state hover:border-ring focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-popup-open:border-ring pointer-coarse:h-11"
);

/**
 * What opens the dialog. It is a button, so a click, Enter, and Space open it
 * and Tab passes over it, but it is drawn as the field it stands for: the
 * glyph and the muted wording are what a reader looks for when they want
 * somewhere to type. `children` is that wording, and the button's name.
 */
const CatalogSearchDialogTrigger = ({ children }: { children: ReactNode }) => (
  <Dialog.Trigger className={TRIGGER}>
    <SearchIcon aria-hidden="true" className="size-4 shrink-0" />
    <span className="min-w-0 flex-1 truncate">{children}</span>
  </Dialog.Trigger>
);

/**
 * The modal. Below `sm` it covers the window, the way a phone's own search
 * does: the keyword row along the top, the button along the foot, and the
 * filters between them as the one part that scrolls. From `sm` up it is a
 * panel near the top of the window rather than its middle, so the field stays
 * where the eye is. In both, the form's keyword row is the popup's top edge,
 * so the popup has no padding of its own.
 *
 * Focus lands on the keyword field, the reason the dialog was opened, and goes
 * back to the trigger on the way out — whether the reader dismissed it or
 * submitted it. A submission bubbles here from the form inside and closes the
 * dialog; it also keeps bubbling through the React tree, which is how a dialog
 * opened from the navigation drawer closes the drawer behind it as well.
 */
const CatalogSearchDialogPopup = ({ children }: { children: ReactNode }) => {
  const close = useCloseCatalogSearchDialog();
  const popupRef = useRef<HTMLDivElement>(null);

  const focusKeyword = useCallback(
    () =>
      popupRef.current?.querySelector<HTMLInputElement>('input[name="q"]') ??
      true,
    []
  );

  return (
    <Dialog.Portal>
      <Dialog.Backdrop />
      <Dialog.Viewport>
        <Dialog.Popup
          className="top-[12vh] flex max-h-[76vh] w-[min(calc(100vw-2rem),40rem)] translate-y-0 flex-col overflow-hidden p-0 max-sm:inset-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:translate-x-0 max-sm:rounded-none max-sm:border-0"
          initialFocus={focusKeyword}
          onSubmit={close}
          ref={popupRef}
        >
          {children}
        </Dialog.Popup>
      </Dialog.Viewport>
    </Dialog.Portal>
  );
};

/**
 * The dialog's name. The keyword field's placeholder already says what the
 * dialog is for, so the name is for assistive technology alone and draws
 * nothing above the field.
 */
const CatalogSearchDialogTitle = ({ children }: { children: ReactNode }) => (
  <Dialog.Title className="sr-only">{children}</Dialog.Title>
);

/**
 * Closes the dialog without searching. It lies over the end of the keyword
 * row, which the form leaves clear for it, and comes last in the popup so Tab
 * reaches it after the form.
 */
const CatalogSearchDialogClose = ({
  "aria-label": ariaLabel,
}: {
  /** Names the button that closes the dialog without searching. */
  "aria-label": string;
}) => (
  <Dialog.Close
    aria-label={ariaLabel}
    className="absolute top-2.5 right-3 inline-flex size-9 items-center justify-center rounded-control text-muted-foreground transition-colors duration-state ease-state hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:top-1.5 pointer-coarse:size-11"
  >
    <CloseIcon aria-hidden="true" className="size-5" />
  </Dialog.Close>
);

/** Same footprint and place as the close button, while its name is resolved. */
const CatalogSearchDialogCloseSkeleton = () => (
  <Skeleton className="absolute top-2.5 right-3 size-9 rounded-control pointer-coarse:top-1.5 pointer-coarse:size-11" />
);

export {
  CatalogSearchDialogClose as Close,
  CatalogSearchDialogCloseSkeleton as CloseSkeleton,
  CatalogSearchDialogPopup as Popup,
  CatalogSearchDialogRoot as Root,
  CatalogSearchDialogTitle as Title,
  CatalogSearchDialogTrigger as Trigger,
};
