"use client";

import * as ActionForm from "@publira/ui-components/action-form";
import { FormMessage } from "@publira/ui-components/form-message";
import * as Identifier from "@publira/ui-components/identifier";
import { QrCode } from "@publira/ui-components/qr-code";
import type { QrCodePath } from "@publira/ui-components/qr-code";
import { createContext, use, useLayoutEffect, useState } from "react";
import type { Dispatch, ReactNode } from "react";

import { useClientMessages } from "#components/client-message";

import type {
  MfaEnrollmentStartState,
  MfaSettingsChangeState,
} from "../_lib/mfa-state";

interface MfaSettingsChange {
  message: string;
  /** The batch this change issued, or the one an earlier change left on screen. */
  recoveryCodes: string[];
}

const ReportMfaSettingsChangeContext =
  createContext<Dispatch<MfaSettingsChange> | null>(null);

/**
 * The recovery codes a change just issued, at the one moment they exist in
 * plaintext, with a control that copies the whole batch.
 *
 * A recovery code is transcribed character by character, so each is set in
 * the monospace face that tells `1` from `l` and `0` from `O`.
 */
const MfaRecoveryCodes = ({ codes }: { codes: string[] }) => {
  const t = useClientMessages();

  return (
    <div className="grid gap-3 border border-border bg-muted/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <p className="text-sm font-medium">
            {t("storefront.settings.mfa_recovery_codes_title")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("storefront.settings.mfa_recovery_codes_description")}
          </p>
        </div>
        <Identifier.Copy
          aria-label={t("storefront.settings.mfa_recovery_codes_copy")}
          value={codes.join("\n")}
        />
      </div>
      <ul
        aria-label={t("storefront.settings.mfa_recovery_codes_title")}
        className="grid grid-cols-2 gap-2"
      >
        {codes.map((code) => (
          <li key={code}>
            <code className="font-mono text-sm">{code}</code>
          </li>
        ))}
      </ul>
    </div>
  );
};

/**
 * Where the section says what the last change did, with the recovery codes it
 * issued. Turning two-step verification on swaps the forms below for the ones
 * that keep it, so the form that made the change cannot carry that answer.
 *
 * The router keeps a page it navigates away from inside a hidden `<Activity>`
 * and shows it again, state included, on Back. The codes are shown only once,
 * so the answer is dropped as the page is hidden; a layout Effect's cleanup
 * runs before the page is taken off the screen.
 */
const MfaSettingsOutcome = ({ children }: { children: ReactNode }) => {
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
        <div className="grid gap-4">
          <FormMessage variant="success">{change.message}</FormMessage>
          {change.recoveryCodes.length > 0 ? (
            <MfaRecoveryCodes codes={change.recoveryCodes} />
          ) : null}
        </div>
      ) : null}
      {children}
    </ReportMfaSettingsChangeContext>
  );
};

/**
 * Hands a successful change of the surrounding form to `MfaSettingsOutcome`.
 * A refused one stays on its form and leaves the last change in place, since
 * the codes it shows exist in plaintext nowhere else.
 */
const MfaSettingsOutcomeReport = () => {
  const report = use(ReportMfaSettingsChangeContext);
  ActionForm.useSettled<NonNullable<MfaSettingsChangeState>>((state) => {
    if (state?.ok) {
      report?.({
        message: state.message,
        recoveryCodes: state.recoveryCodes,
      });
    }
  });

  return null;
};

interface StartedMfaEnrollment {
  qr: QrCodePath;
  secret: string;
}

const MfaEnrollmentContext = createContext<StartedMfaEnrollment | null>(null);

const StartMfaEnrollmentContext =
  createContext<Dispatch<StartedMfaEnrollment> | null>(null);

/**
 * The two steps of turning two-step verification on: `start` until its form
 * has set an authenticator up, then `confirm`. The confirm step is a form of
 * its own, so the secret the start step answered is held here.
 */
const MfaEnrollment = ({
  confirm,
  start,
}: {
  confirm: ReactNode;
  start: ReactNode;
}) => {
  const [enrollment, setEnrollment] = useState<StartedMfaEnrollment | null>(
    null
  );

  return (
    <StartMfaEnrollmentContext value={setEnrollment}>
      <MfaEnrollmentContext value={enrollment}>
        {enrollment ? confirm : start}
      </MfaEnrollmentContext>
    </StartMfaEnrollmentContext>
  );
};

/** Moves `MfaEnrollment` on to its confirm step once the start form succeeds. */
const MfaEnrollmentStarted = () => {
  const start = use(StartMfaEnrollmentContext);
  ActionForm.useSettled<NonNullable<MfaEnrollmentStartState>>((state) => {
    if (state?.ok) {
      start?.({ qr: state.qr, secret: state.secret });
    }
  });

  return null;
};

/**
 * What an authenticator app needs to add the account: the code to scan, and
 * the same secret as a key to type where a camera is not an option.
 */
const MfaEnrollmentSecret = () => {
  const enrollment = use(MfaEnrollmentContext);
  const t = useClientMessages();

  if (!enrollment) {
    return null;
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <p className="text-sm font-medium">
          {t("storefront.settings.mfa_scan_title")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("storefront.settings.mfa_scan_description")}
        </p>
      </div>
      <div className="flex justify-center">
        <QrCode
          aria-label={t("storefront.settings.mfa_qr_label")}
          path={enrollment.qr.path}
          size={enrollment.qr.size}
        />
      </div>
      <div className="grid gap-1">
        <p className="text-sm font-medium">
          {t("storefront.settings.mfa_secret_label")}
        </p>
        <Identifier.Root>
          <code className="font-mono text-sm break-all">
            {enrollment.secret}
          </code>
          <Identifier.Copy
            aria-label={t("storefront.settings.mfa_secret_copy")}
            value={enrollment.secret}
          />
        </Identifier.Root>
        <p className="text-xs text-muted-foreground">
          {t("storefront.settings.mfa_secret_help")}
        </p>
      </div>
    </div>
  );
};

export {
  MfaEnrollment as Enrollment,
  MfaEnrollmentSecret as EnrollmentSecret,
  MfaEnrollmentStarted as EnrollmentStarted,
  MfaSettingsOutcome as Outcome,
  MfaSettingsOutcomeReport as Report,
};
