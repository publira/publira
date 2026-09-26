import type { Locale } from "@publira/i18n";
import { z } from "zod";

import { optionalTrimmedString, revisionFormSchema } from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";
import {
  STORAGE_SECRET_CLEAR,
  STORAGE_SECRET_REPLACE,
  STORAGE_SECRET_UNCHANGED,
} from "#lib/storage-settings-shared";

/** Mirrors `storagesettings.validateBucketName`, which holds S3's own rules. */
const BUCKET_NAME_RE = /^[a-z0-9](?:[a-z0-9.-]{1,61})[a-z0-9]$/u;
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/u;

const isBucketName = (value: string): boolean =>
  BUCKET_NAME_RE.test(value) && !value.includes("..") && !IPV4_RE.test(value);

/** Mirrors `storagesettings.validateAbsoluteURL`: empty, or http(s) with a host. */
const isStoreUrl = (value: string): boolean => {
  if (!value) {
    return true;
  }
  if (!URL.canParse(value)) {
    return false;
  }
  const url = new URL(value);
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.host !== "" &&
    !value.includes("?") &&
    !value.includes("#")
  );
};

export const storageFormFields = {
  accessKeyId: { kind: "value", name: "access_key_id" },
  bucket: "value",
  credentialMode: { kind: "value", name: "credential_mode" },
  endpoint: "value",
  forcePathStyle: { kind: "value", name: "force_path_style" },
  publicBaseUrl: { kind: "value", name: "public_base_url" },
  region: "value",
  revision: "value",
  secretAccessKey: { kind: "value", name: "secret_access_key" },
  secretAccessKeyUpdateMode: {
    kind: "value",
    name: "secret_access_key_update_mode",
  },
} as const;

/**
 * The storage form as the API takes it. The credential is one choice: the
 * ambient credential clears both halves, and an access key either keeps the
 * stored secret or states a new one.
 */
export const storageFormSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z
    .object({
      accessKeyId: optionalTrimmedString(128),
      bucket: z.preprocess(
        (value) => (typeof value === "string" ? value.trim() : ""),
        z
          .string()
          .min(1, t("platform.storage.form.bucket_required"))
          .refine(isBucketName, t("platform.storage.form.bucket_invalid"))
      ),
      credentialMode: z.preprocess(
        (value) => (value === "access_key" ? "access_key" : "ambient"),
        z.enum(["access_key", "ambient"])
      ),
      endpoint: optionalTrimmedString(2048).refine(
        isStoreUrl,
        t("platform.storage.form.endpoint_invalid")
      ),
      forcePathStyle: z.preprocess((value) => value === "on", z.boolean()),
      publicBaseUrl: optionalTrimmedString(2048).refine(
        isStoreUrl,
        t("platform.storage.form.public_base_url_invalid")
      ),
      region: z.preprocess(
        (value) => (typeof value === "string" ? value.trim() : ""),
        z
          .string()
          .min(1, t("platform.storage.form.region_required"))
          .regex(/^\S+$/u, t("platform.storage.form.region_invalid"))
      ),
      revision: revisionFormSchema(t("platform.policy.revision_invalid")),
      secretAccessKey: z.preprocess(
        (value) => (typeof value === "string" ? value.trim() : ""),
        z.string()
      ),
      secretAccessKeyUpdateMode: z.preprocess(
        (value) =>
          value === String(STORAGE_SECRET_REPLACE)
            ? STORAGE_SECRET_REPLACE
            : STORAGE_SECRET_UNCHANGED,
        z.number()
      ),
    })
    .superRefine((value, ctx) => {
      if (value.credentialMode !== "access_key") {
        return;
      }
      if (!value.accessKeyId) {
        ctx.addIssue({
          code: "custom",
          message: t("platform.storage.form.access_key_id_required"),
          path: ["accessKeyId"],
        });
      }
      if (
        value.secretAccessKeyUpdateMode === STORAGE_SECRET_REPLACE &&
        !value.secretAccessKey
      ) {
        ctx.addIssue({
          code: "custom",
          message: t("platform.storage.form.secret_access_key_required"),
          path: ["secretAccessKey"],
        });
      }
    })
    .transform(({ credentialMode, ...value }) =>
      credentialMode === "ambient"
        ? {
            ...value,
            accessKeyId: "",
            secretAccessKey: "",
            secretAccessKeyUpdateMode: STORAGE_SECRET_CLEAR,
          }
        : {
            ...value,
            secretAccessKey:
              value.secretAccessKeyUpdateMode === STORAGE_SECRET_REPLACE
                ? value.secretAccessKey
                : "",
          }
    );
};
