"use client";

import { useActionFormSettled } from "@publira/ui-components/action-form";
import type { ActionFormResult } from "@publira/ui-components/action-form";
import { FormMessage } from "@publira/ui-components/form-message";
import { createContext, use, useLayoutEffect, useState } from "react";
import type { Dispatch, ReactNode } from "react";

import { IssuedMfaRecoveryCodes } from "#components/mfa-recovery-code-list";

interface MfaSettingsChange {
  message: string;
  /** The batch the change issued, for an enrollment or a regeneration. */
  recoveryCodes: string[] | null;
}

const ReportMfaSettingsChangeContext =
  createContext<Dispatch<MfaSettingsChange> | null>(null);

/**
 * Where the card says what the last successful change did, with the recovery
 * codes it issued in `recoveryCodes`. Enabling or disabling the factor swaps
 * the forms below for the other set, so the form that made the change cannot
 * carry that answer itself.
 *
 * The router keeps a page it navigates away from inside a hidden `<Activity>`
 * and shows it again, state included, on Back. The codes are shown only once,
 * so the answer is dropped as the page is hidden; a layout Effect's cleanup
 * runs before the page is taken off the screen.
 */
export const MfaSettingsOutcome = ({
  children,
  recoveryCodes,
}: {
  children: ReactNode;
  recoveryCodes: ReactNode;
}) => {
  const [change, setChange] = useState<MfaSettingsChange | null>(null);
  useLayoutEffect(
    () => () => {
      setChange(null);
    },
    []
  );

  return (
    <ReportMfaSettingsChangeContext value={setChange}>
      {change ? (
        <FormMessage variant="success">{change.message}</FormMessage>
      ) : null}
      {change?.recoveryCodes ? (
        <IssuedMfaRecoveryCodes value={change.recoveryCodes}>
          {recoveryCodes}
        </IssuedMfaRecoveryCodes>
      ) : null}
      {children}
    </ReportMfaSettingsChangeContext>
  );
};

/**
 * Hands a successful change to `MfaSettingsOutcome`. A refused one stays on
 * its form and leaves the last change in place, since the codes it shows
 * exist in plaintext nowhere else.
 */
export const ReportMfaSettingsChange = () => {
  const report = use(ReportMfaSettingsChangeContext);
  useActionFormSettled<ActionFormResult & { recoveryCodes?: string[] }>(
    (state) => {
      if (state?.ok) {
        report?.({
          message: state.message,
          recoveryCodes: state.recoveryCodes ?? null,
        });
      }
    }
  );

  return null;
};
