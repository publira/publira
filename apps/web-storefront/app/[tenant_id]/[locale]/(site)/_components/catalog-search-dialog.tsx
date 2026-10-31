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
 * The modal, near the top of the window rather than its middle, so the field
 * stays where the eye is while a phone's keyboard takes the lower half.
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
          className="top-4 grid max-h-[calc(100dvh-2rem)] w-[min(calc(100vw-2rem),40rem)] translate-y-0 gap-5 overflow-y-auto sm:top-[12vh] sm:max-h-[76vh]"
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

/** The title row: the dialog's name and its close button. */
const CatalogSearchDialogHeader = ({ children }: { children: ReactNode }) => (
  <div className="flex items-center justify-between gap-4">{children}</div>
);

const CatalogSearchDialogTitle = ({ children }: { children: ReactNode }) => (
  <Dialog.Title className="font-serif text-lg leading-tight font-medium text-foreground">
    {children}
  </Dialog.Title>
);

const CatalogSearchDialogClose = ({
  "aria-label": ariaLabel,
}: {
  /** Names the button that closes the dialog without searching. */
  "aria-label": string;
}) => (
  <Dialog.Close
    aria-label={ariaLabel}
    className="inline-flex size-9 shrink-0 items-center justify-center rounded-control border border-input text-muted-foreground transition-colors duration-state ease-state hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:size-11"
  >
    <CloseIcon aria-hidden="true" className="size-4" />
  </Dialog.Close>
);

/** Same footprint as the close button, while its name is resolved. */
const CatalogSearchDialogCloseSkeleton = () => (
  <Skeleton className="size-9 shrink-0 rounded-control pointer-coarse:size-11" />
);

export {
  CatalogSearchDialogClose as Close,
  CatalogSearchDialogCloseSkeleton as CloseSkeleton,
  CatalogSearchDialogHeader as Header,
  CatalogSearchDialogPopup as Popup,
  CatalogSearchDialogRoot as Root,
  CatalogSearchDialogTitle as Title,
  CatalogSearchDialogTrigger as Trigger,
};
