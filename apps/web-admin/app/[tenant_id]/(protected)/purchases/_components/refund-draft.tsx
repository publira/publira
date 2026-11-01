"use client";

import { Button } from "@publira/ui-components/button";
import * as Dialog from "@publira/ui-components/dialog";
import { Input } from "@publira/ui-components/input";
import { Textarea } from "@publira/ui-components/textarea";
import type { ReactNode } from "react";
import { createContext, use, useMemo, useState } from "react";

import { useClientMessages } from "#components/client-message";
import { parsePriceInput, priceInputStep, toPriceInputValue } from "#lib/price";

/** The longest reason the refund Action accepts. */
const MAX_REASON_LENGTH = 1000;

/**
 * The amount a refund can be asked for, in the minor unit of `currency`: above
 * zero and up to `left`, what the provider has not reported refunded yet.
 * While `requested` is above zero, a refund in part of that much is waiting
 * for the provider, and the API takes no other amount until it reports it.
 */
export interface RefundAmountBounds {
  currency: string;
  left: number;
  requested: number;
}

interface RefundDraftContextValue {
  amount: string;
  bounds: RefundAmountBounds | null;
  reason: string;
  setAmount: (amount: string) => void;
  setReason: (reason: string) => void;
}

const RefundDraftContext = createContext<RefundDraftContextValue | null>(null);

const useRefundDraft = (caller: string): RefundDraftContextValue => {
  const context = use(RefundDraftContext);

  if (!context) {
    throw new Error(`${caller} must be rendered inside a RefundDraft.`);
  }

  return context;
};

/**
 * The amount typed, read into the minor unit of the currency, or `null` while
 * it is not one the API would take.
 */
const readAmount = (
  amount: string,
  bounds: RefundAmountBounds
): number | null => {
  const value = parsePriceInput(amount, bounds.currency);

  if (value === null || value <= 0 || value > bounds.left) {
    return null;
  }

  if (bounds.requested > 0 && value !== bounds.requested) {
    return null;
  }

  return value;
};

/**
 * Holds what is typed into the confirmation, which sits in a dialog portaled
 * away from the button that submits it: the reason, and, when `bounds` is
 * given, the amount. Without `bounds` the refund is of all that is left, and
 * the dialog asks for no amount.
 *
 * It wraps the dialog rather than living in it, so what was typed survives the
 * dialog closing: a refund the API refused can be asked again without typing
 * it a second time. The amount starts at the refund waiting for the provider,
 * or else at all that is left.
 */
const RefundDraft = ({
  bounds,
  children,
}: {
  bounds: RefundAmountBounds | null;
  children: ReactNode;
}) => {
  const [reason, setReason] = useState("");

  const [amount, setAmount] = useState(() =>
    bounds
      ? toPriceInputValue(bounds.requested || bounds.left, bounds.currency)
      : ""
  );

  const value = useMemo(
    () => ({ amount, bounds, reason, setAmount, setReason }),
    [amount, bounds, reason]
  );

  return <RefundDraftContext value={value}>{children}</RefundDraftContext>;
};

/** The reason field, which joins the refund form through `form=`. */
const RefundReasonTextarea = ({ formId }: { formId: string }) => {
  const { reason, setReason } = useRefundDraft("RefundReasonTextarea");
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
 * The amount field, in the purchase's currency, which joins the refund form
 * through `form=`. It is read-only while a refund in part waits for the
 * provider: asking again is only ever for the same amount.
 */
const RefundAmountInput = ({ formId }: { formId: string }) => {
  const { amount, bounds, setAmount } = useRefundDraft("RefundAmountInput");

  if (!bounds) {
    return null;
  }

  const step = priceInputStep(bounds.currency);

  return (
    <Input
      form={formId}
      max={toPriceInputValue(bounds.left, bounds.currency)}
      min={step}
      name="amount"
      onChange={(event) => setAmount(event.currentTarget.value)}
      readOnly={bounds.requested > 0}
      required
      step={step}
      type="number"
      value={amount}
    />
  );
};

/**
 * Whether what the reader bought stays open to them for the amount typed, or
 * closes because the amount is all that is left; or, while the amount is not
 * one the API would take, what it has to be.
 */
const RefundAmountNote = () => {
  const { amount, bounds } = useRefundDraft("RefundAmountNote");
  const t = useClientMessages();

  if (!bounds) {
    return null;
  }

  const value = readAmount(amount, bounds);

  if (value === null) {
    return t("admin.purchases.refund_amount_note.invalid");
  }

  if (value === bounds.left) {
    return t("admin.purchases.refund_amount_note.closes");
  }

  return t("admin.purchases.refund_amount_note.stays_open");
};

/**
 * Submits the refund form, and stays closed until a reason has been written
 * and the amount is one the API takes: the API refuses a refund without a
 * reason, and the audit log entry is the only record of why the money went
 * back.
 */
const RefundConfirmButton = ({
  children,
  formId,
}: {
  children: ReactNode;
  formId: string;
}) => {
  const { amount, bounds, reason } = useRefundDraft("RefundConfirmButton");
  const amountReady = !bounds || readAmount(amount, bounds) !== null;

  return (
    <Dialog.Close
      disabled={reason.trim() === "" || !amountReady}
      form={formId}
      render={<Button variant="destructive" />}
      type="submit"
    >
      {children}
    </Dialog.Close>
  );
};

export {
  RefundAmountInput as AmountInput,
  RefundAmountNote as AmountNote,
  RefundConfirmButton as ConfirmButton,
  RefundDraft as Root,
  RefundReasonTextarea as Textarea,
};
