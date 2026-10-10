"use client";

import { useActionFormSettled } from "@publira/ui-components/action-form";
import { QrCode } from "@publira/ui-components/qr-code";
import type { QrCodePath } from "@publira/ui-components/qr-code";
import { createContext, use, useState } from "react";
import type { Dispatch, ReactNode } from "react";

import type { MfaEnrollmentStartState } from "#lib/mfa-action-state";

interface StartedMfaEnrollment {
  qr: QrCodePath;
  secret: string;
}

const MfaEnrollmentContext = createContext<StartedMfaEnrollment | null>(null);

const StartMfaEnrollmentContext =
  createContext<Dispatch<StartedMfaEnrollment> | null>(null);

/**
 * The two steps of an enrollment: `start` until its form has minted a secret,
 * then `confirm`. The confirm step is a form of its own, so the secret the
 * start step returned is held here rather than in either form.
 */
export const MfaEnrollment = ({
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
export const MfaEnrollmentStarted = () => {
  const start = use(StartMfaEnrollmentContext);
  useActionFormSettled<NonNullable<MfaEnrollmentStartState>>((state) => {
    if (state?.ok) {
      start?.({ qr: state.qr, secret: state.secret });
    }
  });

  return null;
};

/** The started enrollment's secret as a code to scan. */
export const MfaEnrollmentQrCode = ({ label }: { label: string }) => {
  const enrollment = use(MfaEnrollmentContext);

  return enrollment ? (
    <QrCode
      aria-label={label}
      path={enrollment.qr.path}
      size={enrollment.qr.size}
    />
  ) : null;
};

/**
 * The started enrollment's secret as text. It is typed into an authenticator
 * by hand when the QR code cannot be scanned, so it is set in the monospace
 * face that keeps its ambiguous characters apart.
 */
export const MfaEnrollmentSecretText = () => {
  const enrollment = use(MfaEnrollmentContext);

  return (
    <code className="block font-mono text-sm tracking-wider break-all text-foreground">
      {enrollment?.secret}
    </code>
  );
};
