"use client";

import {
  ActionForm,
  useActionFormSettled,
} from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import { createContext, use, useState } from "react";
import type { Dispatch, ReactNode } from "react";

import {
  registerPasskey,
  usePasskeyCeremony,
} from "#components/passkey-ceremony";
import type { PasskeyRegistrationState } from "#lib/mfa-action-state";

import {
  beginAccountPasskeyRegistrationAction,
  finishAccountPasskeyRegistrationAction,
} from "../_lib/mfa-actions";

const AddedPasskeyContext = createContext("");

const SetAddedPasskeyContext = createContext<Dispatch<string> | null>(null);

/**
 * The two steps of adding a passkey: `add` until the browser has created one,
 * then `name` for the passkey it created. The name is asked for after the
 * ceremony rather than before it, so a prompt the operator closes leaves
 * nothing half-named behind; naming is a form of its own, so the passkey the
 * add form stored is held here rather than in either form.
 */
export const PasskeyAddition = ({
  add,
  name,
}: {
  add: ReactNode;
  name: ReactNode;
}) => {
  const [added, setAdded] = useState("");

  return (
    <SetAddedPasskeyContext value={setAdded}>
      <AddedPasskeyContext value={added}>
        {added ? name : add}
      </AddedPasskeyContext>
    </SetAddedPasskeyContext>
  );
};

/**
 * Runs the registration ceremony for the signed-in account. Its answer carries
 * the recovery codes when the passkey was the account's first factor, which
 * `ReportMfaSettingsChange` among the children hands to the card.
 */
export const PasskeyAddForm = ({ children }: { children: ReactNode }) => {
  const add = usePasskeyCeremony<PasskeyRegistrationState>(
    beginAccountPasskeyRegistrationAction,
    registerPasskey,
    finishAccountPasskeyRegistrationAction
  );

  return (
    <ActionForm action={add} className="grid gap-3" showSuccess={false}>
      {children}
    </ActionForm>
  );
};

/** Moves `PasskeyAddition` on to naming once the add form succeeds. */
export const PasskeyAdded = () => {
  const setAdded = use(SetAddedPasskeyContext);
  useActionFormSettled<NonNullable<PasskeyRegistrationState>>((state) => {
    if (state?.ok && state.passkeyId) {
      setAdded?.(state.passkeyId);
    }
  });

  return null;
};

/** The passkey the add form stored, as the naming form submits it. */
export const AddedPasskeyIdInput = () => (
  <input name="passkey_id" type="hidden" value={use(AddedPasskeyContext)} />
);

/** Moves `PasskeyAddition` back to its add form once the name is saved. */
export const PasskeyNamed = () => {
  const setAdded = use(SetAddedPasskeyContext);
  useActionFormSettled((state) => {
    if (state?.ok) {
      setAdded?.("");
    }
  });

  return null;
};

/** Leaves the passkey unnamed and goes back to the add form. */
export const SkipPasskeyNaming = ({ children }: { children: ReactNode }) => {
  const setAdded = use(SetAddedPasskeyContext);

  return (
    <Button
      onClick={() => {
        setAdded?.("");
      }}
      type="button"
      variant="ghost"
    >
      {children}
    </Button>
  );
};
