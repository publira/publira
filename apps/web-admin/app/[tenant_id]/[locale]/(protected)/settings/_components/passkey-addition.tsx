"use client";

import * as ActionForm from "@publira/ui-components/action-form";
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
const PasskeyAddition = ({
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
 * `MfaSettingsOutcome.Report` among the children hands to the card.
 */
const PasskeyAdditionAddForm = ({ children }: { children: ReactNode }) => {
  const add = usePasskeyCeremony<PasskeyRegistrationState>(
    beginAccountPasskeyRegistrationAction,
    registerPasskey,
    finishAccountPasskeyRegistrationAction
  );

  return (
    <ActionForm.Root action={add} className="grid gap-3" showSuccess={false}>
      {children}
    </ActionForm.Root>
  );
};

/** Moves `PasskeyAddition` on to naming once the add form succeeds. */
const PasskeyAdditionAdded = () => {
  const setAdded = use(SetAddedPasskeyContext);
  ActionForm.useSettled<NonNullable<PasskeyRegistrationState>>((state) => {
    if (state?.ok && state.passkeyId) {
      setAdded?.(state.passkeyId);
    }
  });

  return null;
};

/** The passkey the add form stored, as the naming form submits it. */
const PasskeyAdditionAddedIdInput = () => (
  <input name="passkey_id" type="hidden" value={use(AddedPasskeyContext)} />
);

/** Moves `PasskeyAddition` back to its add form once the name is saved. */
const PasskeyAdditionNamed = () => {
  const setAdded = use(SetAddedPasskeyContext);
  ActionForm.useSettled((state) => {
    if (state?.ok) {
      setAdded?.("");
    }
  });

  return null;
};

/** Leaves the passkey unnamed and goes back to the add form. */
const PasskeyAdditionSkipNaming = ({ children }: { children: ReactNode }) => {
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

export {
  PasskeyAddition as Root,
  PasskeyAdditionAdded as Added,
  PasskeyAdditionAddedIdInput as AddedIdInput,
  PasskeyAdditionAddForm as AddForm,
  PasskeyAdditionNamed as Named,
  PasskeyAdditionSkipNaming as SkipNaming,
};
