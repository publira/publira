"use client";

import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as Dialog from "@publira/ui-components/dialog";
import * as Toast from "@publira/ui-components/toast";
import { createContext, use, useMemo, useState } from "react";
import type { ReactNode } from "react";

interface IssueTicketDialogContextValue {
  close: () => void;
  /** Bumped on every opening, so the form starts empty each time. */
  sessionKey: number;
}

const IssueTicketDialogContext =
  createContext<IssueTicketDialogContextValue | null>(null);

const useIssueTicketDialog = () => {
  const context = use(IssueTicketDialogContext);
  if (!context) {
    throw new Error(
      "IssueTicketDialog parts must be rendered inside IssueTicketDialog."
    );
  }
  return context;
};

/**
 * Issues a ticket to the reader whose page this is, from a dialog that keeps
 * the page where it is. The form inside is the ticket screen's, handed in by
 * the page as children.
 */
const IssueTicketDialog = ({ children }: { children: ReactNode }) => {
  const [open, setOpen] = useState(false);
  const [sessionKey, setSessionKey] = useState(0);
  const value = useMemo<IssueTicketDialogContextValue>(
    () => ({
      close: () => {
        setOpen(false);
      },
      sessionKey,
    }),
    [sessionKey]
  );

  return (
    <IssueTicketDialogContext value={value}>
      <Dialog.Root
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (nextOpen) {
            // A note typed the last time does not carry into the next ticket.
            setSessionKey((current) => current + 1);
          }
        }}
        open={open}
      >
        {children}
      </Dialog.Root>
    </IssueTicketDialogContext>
  );
};

/** The button that opens the dialog; `children` are its label. */
const IssueTicketDialogTrigger = ({ children }: { children: ReactNode }) => (
  <Dialog.Trigger
    render={
      <Button size="sm" type="button" variant="outline">
        {children}
      </Button>
    }
  />
);

/** The dialog itself; `children` are its header and the form. */
const IssueTicketDialogPopup = ({ children }: { children: ReactNode }) => (
  <Dialog.Portal>
    <Dialog.Backdrop />
    <Dialog.Viewport>
      <Dialog.Popup className="flex max-h-[min(90vh,48rem)] min-h-0 w-[min(92vw,36rem)] flex-col overflow-y-auto">
        {children}
      </Dialog.Popup>
    </Dialog.Viewport>
  </Dialog.Portal>
);

/** Holds the form, remounted on every opening. */
const IssueTicketDialogBody = ({ children }: { children: ReactNode }) => {
  const { sessionKey } = useIssueTicketDialog();

  return (
    <div className="mt-4" key={sessionKey}>
      {children}
    </div>
  );
};

/**
 * Rendered inside the form: once a ticket is issued, raises the result as a
 * toast and closes the dialog over the list that now shows the ticket.
 */
const IssueTicketDialogCloseOnIssued = () => {
  const { close } = useIssueTicketDialog();
  const { add } = Toast.useManager();
  ActionForm.useSettled((state) => {
    if (state?.ok) {
      add({ title: state.message, type: "success" });
      close();
    }
  });

  return null;
};

export {
  IssueTicketDialog as Root,
  IssueTicketDialogBody as Body,
  IssueTicketDialogCloseOnIssued as CloseOnIssued,
  IssueTicketDialogPopup as Popup,
  IssueTicketDialogTrigger as Trigger,
};
