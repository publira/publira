import { toFormDataInput } from "@publira/utils/form-data";
import { z } from "zod";

import {
  SECRET_UPDATE_MODE_CLEAR,
  SECRET_UPDATE_MODE_REPLACE,
  SECRET_UPDATE_MODE_UNCHANGED,
} from "./email-settings-shared";
import { flagOneFormSchema } from "./form-schemas";

/**
 * What the form did with a stored credential: kept it, replaced it, or
 * removed it. A replace with nothing entered leaves the stored value as it is.
 */
const CREDENTIAL_MODES = ["keep", "replace", "clear"] as const;

/** The fields `ProviderCredential` posts for one credential. */
const credentialSchema = z.object({
  configured: flagOneFormSchema,
  mode: z.enum(CREDENTIAL_MODES),
  value: z
    .preprocess((value) => (typeof value === "string" ? value : ""), z.string())
    .transform((value) => value.trim()),
});

type CredentialInput = z.output<typeof credentialSchema>;

const credentialFormInput = (formData: FormData, name: string) =>
  toFormDataInput(formData, {
    configured: { kind: "value", name: `credential_${name}_configured` },
    mode: { kind: "value", name: `credential_${name}_mode` },
    value: { kind: "value", name: `credential_${name}` },
  });

const credentialUpdateMode = (credential: CredentialInput): number => {
  if (credential.mode === "clear") {
    return SECRET_UPDATE_MODE_CLEAR;
  }
  return credential.mode === "replace" && credential.value !== ""
    ? SECRET_UPDATE_MODE_REPLACE
    : SECRET_UPDATE_MODE_UNCHANGED;
};

const isCredentialStored = (credential: CredentialInput): boolean => {
  const mode = credentialUpdateMode(credential);
  return (
    mode === SECRET_UPDATE_MODE_REPLACE ||
    (mode === SECRET_UPDATE_MODE_UNCHANGED && credential.configured)
  );
};

/** A change to one credential field; `value` is read only on a replace. */
export interface ProviderCredentialUpdate {
  name: string;
  mode: number;
  value: string;
}

/** Keyed by `credential_<field name>`, the name each credential posts as. */
export type ProviderCredentialFieldErrors = Partial<Record<string, string>>;

export type ProviderCredentialUpdates =
  | { ok: true; fields: ProviderCredentialUpdate[] }
  | { ok: false; fieldErrors?: ProviderCredentialFieldErrors };

/**
 * Reads what the form posted for each field the provider declares, as the
 * updates the settings RPC takes. Turned on, every required field has to be
 * stored or entered, and one that is not answers `requiredMessage` under its
 * name. A field the form did not post in a shape it could have is a form that
 * was tampered with, which answers no field errors at all.
 */
export const toProviderCredentialUpdates = (
  formData: FormData,
  fields: readonly { name: string; required: boolean }[],
  {
    enabled,
    requiredMessage,
  }: {
    enabled: boolean;
    requiredMessage: string;
  }
): ProviderCredentialUpdates => {
  const updates: ProviderCredentialUpdate[] = [];
  const fieldErrors: ProviderCredentialFieldErrors = {};
  for (const field of fields) {
    const credential = credentialSchema.safeParse(
      credentialFormInput(formData, field.name)
    );
    if (!credential.success) {
      return { ok: false };
    }
    if (enabled && field.required && !isCredentialStored(credential.data)) {
      fieldErrors[`credential_${field.name}`] = requiredMessage;
    }
    updates.push({
      mode: credentialUpdateMode(credential.data),
      name: field.name,
      value: credential.data.value,
    });
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors, ok: false };
  }
  return { fields: updates, ok: true };
};
