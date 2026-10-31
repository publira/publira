"use client";

import { Button } from "@publira/ui-components/button";
import { Checkbox } from "@publira/ui-components/checkbox";
import * as Dialog from "@publira/ui-components/dialog";
import * as Field from "@publira/ui-components/field";
import type { ReactNode } from "react";
import { createContext, use, useMemo, useState } from "react";

interface BrandMarkConsentContextValue {
  accepted: boolean;
  setAccepted: (accepted: boolean) => void;
}

const BrandMarkConsentContext =
  createContext<BrandMarkConsentContextValue | null>(null);

const useBrandMarkConsentContext = (caller: string) => {
  const context = use(BrandMarkConsentContext);

  if (!context) {
    throw new Error(`${caller} must be rendered inside a BrandMarkConsent.`);
  }

  return context;
};

/**
 * Holds whether the administrator has ticked the box accepting a mark's
 * guidelines. It sits inside the dialog's popup, which unmounts when the
 * dialog closes, so every opening starts unticked.
 */
const BrandMarkConsent = ({ children }: { children: ReactNode }) => {
  const [accepted, setAccepted] = useState(false);
  const value = useMemo(() => ({ accepted, setAccepted }), [accepted]);

  return (
    <BrandMarkConsentContext value={value}>{children}</BrandMarkConsentContext>
  );
};

/**
 * The box that accepts the guidelines, labelled by its children. The popup is
 * portaled out of the form, so what it submits joins the form by `form`, and
 * only once the box is ticked.
 */
const BrandMarkConsentAccept = ({
  children,
  form,
}: {
  children: ReactNode;
  form: string;
}) => {
  const { accepted, setAccepted } = useBrandMarkConsentContext(
    "BrandMarkConsentAccept"
  );

  return (
    <>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox
          checked={accepted}
          className="mt-0.5"
          onCheckedChange={setAccepted}
        />
        <span>{children}</span>
      </label>
      {accepted ? (
        <input form={form} name="terms_accepted" type="hidden" value="true" />
      ) : null}
    </>
  );
};

/** A field that stays closed until the guidelines are accepted. */
const BrandMarkConsentField = ({ children }: { children: ReactNode }) => {
  const { accepted } = useBrandMarkConsentContext("BrandMarkConsentField");

  return <Field.Root disabled={!accepted}>{children}</Field.Root>;
};

/**
 * Closes the dialog and submits the form `form` names, closed until the
 * guidelines are accepted.
 */
const BrandMarkConsentSubmit = ({
  children,
  form,
}: {
  children: ReactNode;
  form: string;
}) => {
  const { accepted } = useBrandMarkConsentContext("BrandMarkConsentSubmit");

  return (
    <Dialog.Close
      disabled={!accepted}
      form={form}
      name="intent"
      render={<Button />}
      type="submit"
      value="upload"
    >
      {children}
    </Dialog.Close>
  );
};

export {
  BrandMarkConsent as Root,
  BrandMarkConsentAccept as Accept,
  BrandMarkConsentField as Field,
  BrandMarkConsentSubmit as Submit,
};
