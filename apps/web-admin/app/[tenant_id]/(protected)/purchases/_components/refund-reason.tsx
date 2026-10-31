"use client";

import { Button } from "@publira/ui-components/button";
import * as Dialog from "@publira/ui-components/dialog";
import { Textarea } from "@publira/ui-components/textarea";
import type { ReactNode } from "react";
import { createContext, use, useMemo, useState } from "react";

import { useClientMessages } from "#components/client-message";

/** The longest reason the refund Action accepts. */
const MAX_REASON_LENGTH = 1000;

interface RefundReasonContextValue {
  reason: string;
  setReason: (reason: string) => void;
}

const RefundReasonContext = createContext<RefundReasonContextValue | null>(
  null
);

const useRefundReason = (caller: string): RefundReasonContextValue => {
  const context = use(RefundReasonContext);

  if (!context) {
    throw new Error(`${caller} must be rendered inside a RefundReason.`);
  }

  return context;
};

/**
 * Holds the reason typed into the confirmation, which sits in a dialog
 * portaled away from the button that submits it.
 *
 * It wraps the dialog rather than living in it, so the reason survives the
 * dialog closing: a refund the API refused can be asked again without typing
 * it a second time.
 */
const RefundReason = ({ children }: { children: ReactNode }) => {
  const [reason, setReason] = useState("");
  const value = useMemo(() => ({ reason, setReason }), [reason]);

  return <RefundReasonContext value={value}>{children}</RefundReasonContext>;
};

/** The reason field, which joins the refund form through `form=`. */
const RefundReasonTextarea = ({ formId }: { formId: string }) => {
  const { reason, setReason } = useRefundReason("RefundReasonTextarea");
  const t = useClientMessages();

  return (
    <Textarea
      form={formId}
      maxLength={MAX_REASON_LENGTH}
      name="reason"
      onChange={(event) => setReason(event.currentTarget.value)}
      placeholder={t("admin.purchases.reason_placeholder")}
      required
      value={reason}
    />
  );
};

/**
 * Submits the refund form, and stays closed until a reason has been written:
 * the API refuses a refund without one, and the audit log entry is the only
 * record of why the money went back.
 */
const RefundReasonConfirmButton = ({
  children,
  formId,
}: {
  children: ReactNode;
  formId: string;
}) => {
  const { reason } = useRefundReason("RefundReasonConfirmButton");

  return (
    <Dialog.Close
      disabled={reason.trim() === ""}
      form={formId}
      render={<Button variant="destructive" />}
      type="submit"
    >
      {children}
    </Dialog.Close>
  );
};

export {
  RefundReason as Root,
  RefundReasonConfirmButton as ConfirmButton,
  RefundReasonTextarea as Textarea,
};
