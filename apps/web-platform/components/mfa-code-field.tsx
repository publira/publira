import { ActionFormFieldset } from "@publira/ui-components/action-form";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getMessages } from "#lib/get-messages";

interface MfaCodeFieldProps {
  /**
   * Whether one of the account's recovery codes is accepted here too. The API
   * takes one where the point is proving the account, and refuses one where
   * the point is proving the authenticator — confirming an enrollment, or
   * minting a new batch of codes.
   */
  allowRecoveryCode: boolean;
}

/** `placeholder` is an attribute rather than a node, so the input waits for the catalog alone. */
const MfaCodeInput = async ({ allowRecoveryCode }: MfaCodeFieldProps) => {
  const t = await getMessages();

  return (
    <Input
      autoComplete="one-time-code"
      // A recovery code carries letters and a separator, so the numeric
      // keypad is only right where the authenticator is the only source.
      inputMode={allowRecoveryCode ? "text" : "numeric"}
      name="code"
      placeholder={t("platform.auth.mfa.code_placeholder")}
      required
      type="text"
    />
  );
};

/**
 * The one input every second-factor form has, closed while its `ActionForm`
 * is submitting.
 *
 * It reads the same on all of them, so it resolves its own copy rather than
 * making four call sites pass the same label and hint.
 */
export const MfaCodeField = ({ allowRecoveryCode }: MfaCodeFieldProps) => (
  <ActionFormFieldset>
    <Field>
      <FieldLabel required>
        <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
          <Message message="platform.auth.mfa.code_label" />
        </Suspense>
      </FieldLabel>
      <FieldContent>
        <Suspense fallback={<Skeleton className="h-9 w-full" />}>
          <MfaCodeInput allowRecoveryCode={allowRecoveryCode} />
        </Suspense>
        <FieldDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
            {allowRecoveryCode ? (
              <Message message="platform.auth.mfa.code_help" />
            ) : (
              <Message message="platform.auth.mfa.code_help_totp_only" />
            )}
          </Suspense>
        </FieldDescription>
      </FieldContent>
    </Field>
  </ActionFormFieldset>
);
