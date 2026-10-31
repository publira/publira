import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getMessages } from "#lib/get-messages";

/**
 * Which codes the field takes.
 *
 * - `authenticator`: only one from the authenticator app, where the point is
 *   proving the authenticator — confirming an enrollment, or minting a new
 *   batch of codes. The API refuses a recovery code there.
 * - `authenticator_or_recovery`: either, where the point is proving the
 *   account.
 * - `recovery`: a recovery code alone, for an account whose only other
 *   factor is a passkey.
 */
export type MfaCodeFieldAccepts =
  | "authenticator"
  | "authenticator_or_recovery"
  | "recovery";

interface MfaCodeFieldProps {
  accepts: MfaCodeFieldAccepts;
}

/** `placeholder` is an attribute rather than a node, so the input waits for the catalog alone. */
const MfaCodeInput = async ({ accepts }: MfaCodeFieldProps) => {
  const t = await getMessages();

  return (
    <Input
      autoComplete="one-time-code"
      // A recovery code carries letters and a separator, so the numeric
      // keypad is only right where the authenticator is the only source.
      inputMode={accepts === "authenticator" ? "numeric" : "text"}
      name="code"
      // The six digits stand for an authenticator code, which a recovery code
      // does not look like.
      placeholder={
        accepts === "recovery"
          ? undefined
          : t("admin.auth.mfa.code_placeholder")
      }
      required
      type="text"
    />
  );
};

const MfaCodeHelp = ({ accepts }: MfaCodeFieldProps) => {
  switch (accepts) {
    case "authenticator": {
      return <Message message="admin.auth.mfa.code_help_totp_only" />;
    }

    case "authenticator_or_recovery": {
      return <Message message="admin.auth.mfa.code_help" />;
    }

    case "recovery": {
      return <Message message="admin.auth.mfa.code_help_recovery_only" />;
    }

    default: {
      return accepts satisfies never;
    }
  }
};

/**
 * The one input every second-factor form has, closed while its `ActionForm`
 * is submitting.
 *
 * It reads the same on all of them, so it resolves its own copy rather than
 * making four call sites pass the same label and hint.
 */
export const MfaCodeField = ({ accepts }: MfaCodeFieldProps) => (
  <ActionForm.Fieldset>
    <Field.Root>
      <Field.Label required>
        <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
          {accepts === "recovery" ? (
            <Message message="admin.auth.mfa.recovery_code_label" />
          ) : (
            <Message message="admin.auth.mfa.code_label" />
          )}
        </Suspense>
      </Field.Label>
      <Field.Content>
        <Suspense fallback={<Skeleton className="h-9 w-full" />}>
          <MfaCodeInput accepts={accepts} />
        </Suspense>
        <Field.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
            <MfaCodeHelp accepts={accepts} />
          </Suspense>
        </Field.Description>
      </Field.Content>
    </Field.Root>
  </ActionForm.Fieldset>
);
