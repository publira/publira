import type { Locale } from "@publira/i18n";
import { z } from "zod";

import { requiredTrimmedString } from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";

/** Mirrors `push.MaxServiceAccountJSONBytes`. */
export const MAX_SERVICE_ACCOUNT_JSON_BYTES = 16 * 1024;

export const fcmCredentialsFormFields = {
  projectId: { kind: "value", name: "project_id" },
  serviceAccountFile: { kind: "file", name: "service_account_file" },
  tenantId: { kind: "value", name: "tenant_id" },
} as const;

export const fcmCredentialsFormSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    projectId: requiredTrimmedString(
      t("admin.settings.mobile_push.validation.project_id_required")
    ),
    serviceAccountFile: z
      .custom<File>((value) => value instanceof File, {
        error: t("admin.settings.mobile_push.validation.file_required"),
      })
      .refine(
        (file) => file.size <= MAX_SERVICE_ACCOUNT_JSON_BYTES,
        t("admin.settings.mobile_push.validation.file_too_large")
      ),
    tenantId: requiredTrimmedString(t("admin.settings.tenant_missing")),
  });
};

export const fcmDeleteFormSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    tenantId: requiredTrimmedString(t("admin.settings.tenant_missing")),
  });
};

/** The fields of a service account key that `fcmsettings.Validate` reads. */
const serviceAccountKeySchema = z.object({
  client_email: z.string(),
  private_key: z.string(),
  project_id: z.string().trim().min(1),
  type: z.literal("service_account"),
});

export type ServiceAccountKeyProblem =
  | { kind: "not-json" }
  | { kind: "not-service-account" }
  | { kind: "project-mismatch"; keyProjectId: string };

/**
 * The part of `fcmsettings.Validate` the form can answer before a round trip:
 * the file is a service account key, and it names the project entered. The
 * server stays the authority, and checks the private key too.
 */
export const checkServiceAccountKey = (
  json: string,
  projectId: string
): ServiceAccountKeyProblem | null => {
  let key: unknown;

  try {
    key = JSON.parse(json);
  } catch {
    return { kind: "not-json" };
  }

  // An array or a scalar is valid JSON, but not a key file at all.
  if (!z.object({}).safeParse(key).success) {
    return { kind: "not-json" };
  }

  const parsed = serviceAccountKeySchema.safeParse(key);

  if (!parsed.success) {
    return { kind: "not-service-account" };
  }

  const keyProjectId = parsed.data.project_id;

  if (keyProjectId !== projectId) {
    return { keyProjectId, kind: "project-mismatch" };
  }

  return null;
};
