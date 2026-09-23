import type { Locale } from "@publira/i18n";
import { z } from "zod";

import { checkboxOnFormSchema, requiredTrimmedString } from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";
import { MAX_ANDROID_CERT_FINGERPRINTS } from "#lib/tenant-mobile-app-association";
import type { TenantMobileAppAssociation } from "#lib/tenant-mobile-app-association";

// The API's patterns, which are the app manifest's (mobile/config/app.schema.json).
const ANDROID_APPLICATION_ID_RE =
  /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/u;
const IOS_BUNDLE_IDENTIFIER_RE = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/u;
const SHA256_FINGERPRINT_RE = /^[0-9A-F]{2}(?::[0-9A-F]{2}){31}$/u;
const APPLE_TEAM_ID_RE = /^[A-Z0-9]{10}$/u;

export const appLinksFormFields = {
  androidApplicationId: { kind: "value", name: "android_application_id" },
  androidEnabled: { kind: "value", name: "android_enabled" },
  androidFingerprints: { kind: "value", name: "android_fingerprints" },
  iosBundleIdentifier: { kind: "value", name: "ios_bundle_identifier" },
  iosEnabled: { kind: "value", name: "ios_enabled" },
  iosTeamId: { kind: "value", name: "ios_team_id" },
  tenantId: { kind: "value", name: "tenant_id" },
} as const;

/** The textarea's fingerprints, one per line, with blank lines dropped. */
const fingerprintLines = (value: unknown): string[] =>
  typeof value === "string"
    ? value.split(/\r?\n/u).flatMap((line) => {
        const fingerprint = line.trim().toUpperCase();
        return fingerprint ? [fingerprint] : [];
      })
    : [];

const trimmed = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

export interface AppLinksFormValues {
  association: TenantMobileAppAssociation;
  tenantId: string;
}

/**
 * A platform whose box is unticked is cleared, whatever its fields hold; a
 * ticked one needs every field.
 */
export const appLinksFormSchema = async (
  locale: Locale
): Promise<z.ZodType<AppLinksFormValues, unknown>> => {
  const t = await getMessagesFor(locale);

  return z
    .object({
      androidApplicationId: z.preprocess(trimmed, z.string()),
      androidEnabled: checkboxOnFormSchema,
      androidFingerprints: z.preprocess(fingerprintLines, z.array(z.string())),
      iosBundleIdentifier: z.preprocess(trimmed, z.string()),
      iosEnabled: checkboxOnFormSchema,
      iosTeamId: z.preprocess(
        (value) => trimmed(value).toUpperCase(),
        z.string()
      ),
      tenantId: requiredTrimmedString(t("admin.settings.tenant_missing")),
    })
    .superRefine((data, ctx) => {
      if (data.androidEnabled) {
        if (!ANDROID_APPLICATION_ID_RE.test(data.androidApplicationId)) {
          ctx.addIssue({
            code: "custom",
            message: t(
              "admin.settings.app_links.validation.application_id_invalid"
            ),
            path: ["androidApplicationId"],
          });
        }
        const fingerprints = data.androidFingerprints;
        if (
          fingerprints.length === 0 ||
          fingerprints.length > MAX_ANDROID_CERT_FINGERPRINTS
        ) {
          ctx.addIssue({
            code: "custom",
            message: t(
              "admin.settings.app_links.validation.fingerprints_count",
              {
                max: String(MAX_ANDROID_CERT_FINGERPRINTS),
              }
            ),
            path: ["androidFingerprints"],
          });
        }
        const malformed = fingerprints.find(
          (fingerprint) => !SHA256_FINGERPRINT_RE.test(fingerprint)
        );
        const repeated = fingerprints.find(
          (fingerprint, index) => fingerprints.indexOf(fingerprint) !== index
        );
        if (malformed !== undefined) {
          ctx.addIssue({
            code: "custom",
            message: t(
              "admin.settings.app_links.validation.fingerprint_invalid",
              { fingerprint: malformed }
            ),
            path: ["androidFingerprints"],
          });
        } else if (repeated !== undefined) {
          ctx.addIssue({
            code: "custom",
            message: t(
              "admin.settings.app_links.validation.fingerprint_duplicate",
              { fingerprint: repeated }
            ),
            path: ["androidFingerprints"],
          });
        }
      }
      if (data.iosEnabled) {
        if (!APPLE_TEAM_ID_RE.test(data.iosTeamId)) {
          ctx.addIssue({
            code: "custom",
            message: t("admin.settings.app_links.validation.team_id_invalid"),
            path: ["iosTeamId"],
          });
        }
        if (!IOS_BUNDLE_IDENTIFIER_RE.test(data.iosBundleIdentifier)) {
          ctx.addIssue({
            code: "custom",
            message: t(
              "admin.settings.app_links.validation.bundle_identifier_invalid"
            ),
            path: ["iosBundleIdentifier"],
          });
        }
      }
    })
    .transform((data) => ({
      association: {
        android: data.androidEnabled
          ? {
              applicationId: data.androidApplicationId,
              sha256CertFingerprints: data.androidFingerprints,
            }
          : undefined,
        ios: data.iosEnabled
          ? {
              bundleIdentifier: data.iosBundleIdentifier,
              teamId: data.iosTeamId,
            }
          : undefined,
      },
      tenantId: data.tenantId,
    }));
};
