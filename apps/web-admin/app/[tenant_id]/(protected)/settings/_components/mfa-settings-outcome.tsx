"use client";

import { useActionFormSettled } from "@publira/ui-components/action-form";
import type { ActionFormResult } from "@publira/ui-components/action-form";
import { FormMessage } from "@publira/ui-components/form-message";
import { createContext, use, useLayoutEffect, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";

import { IssuedMfaRecoveryCodes } from "#components/mfa-recovery-code-list";

interface MfaSettingsChange {
  message: string;
  /**
   * The batch on screen: the last one a change issued — an enrollment's, a
   * regeneration's, or the one a first passkey brings — kept through the
   * changes after it that issue none.
   */
  recoveryCodes: string[] | null;
  /** This change issued `recoveryCodes`, rather than keeping an earlier batch. */
  issuedRecoveryCodes: boolean;
}

interface ReportedMfaSettingsChange {
  message: string;
  /** Empty or absent when the change issued no batch of its own. */
  recoveryCodes?: string[];
}

const ReportMfaSettingsChangeContext = createContext<Dispatch<
  SetStateAction<MfaSettingsChange | null>
> | null>(null);

/** The change on screen once `reported` has succeeded after `previous`. */
const nextMfaSettingsChange = (
  previous: MfaSettingsChange | null,
  reported: ReportedMfaSettingsChange
): MfaSettingsChange => {
  const issued = Boolean(reported.recoveryCodes?.length);

  return {
    issuedRecoveryCodes: issued,
    message: reported.message,
    recoveryCodes: issued
      ? (reported.recoveryCodes ?? null)
      : (previous?.recoveryCodes ?? null),
  };
};

/**
 * Where the card says what the last successful change did, with the recovery
 * codes it issued in `recoveryCodes`. Enabling or disabling the factor swaps
 * the forms below for the other set, so the form that made the change cannot
 * carry that answer itself.
 *
 * The batch on screen is the only plaintext copy, so a change that issues no
 * batch of its own — another passkey, a passkey or the app removed while
 * another factor remains — leaves it there. Only the account's factors, read
 * again from the API after every change, say when the codes went with the
 * last of them, and `hasSecondFactor` is that read. A batch the change itself
 * issued is shown whatever it says: the codes arrive with the submission's
 * answer, which can be ahead of the read that shows the new factor.
 *
 * The router keeps a page it navigates away from inside a hidden `<Activity>`
 * and shows it again, state included, on Back. The codes are shown only once,
 * so the answer is dropped as the page is hidden; a layout Effect's cleanup
 * runs before the page is taken off the screen.
 */
export const MfaSettingsOutcome = ({
  children,
  hasSecondFactor,
  recoveryCodes,
}: {
  children: ReactNode;
  hasSecondFactor: boolean;
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
      {change?.recoveryCodes &&
      (change.issuedRecoveryCodes || hasSecondFactor) ? (
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
        report?.((previous) =>
          nextMfaSettingsChange(previous, {
            message: state.message,
            recoveryCodes: state.recoveryCodes,
          })
        );
      }
    }
  );

  return null;
};
