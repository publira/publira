import type { Locale } from "@publira/i18n";
import { z } from "zod";

import {
  checkboxOnFormSchema,
  isFormText,
  requiredTrimmedString,
} from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";
import type { UpdateTenantAnalyticsSettingsInput } from "#lib/tenant-analytics-settings";
import {
  GOOGLE_TAG_CONSENT_MODES,
  GOOGLE_TAG_SERVING_MODES,
} from "#lib/tenant-analytics-settings-shared";

// The API's patterns (server/internal/googletag), which it applies after
// trimming and capitalizing.
const MEASUREMENT_ID_RE = /^G-[A-Z0-9]{1,30}$/u;
const CONTAINER_ID_RE = /^GTM-[A-Z0-9]{1,28}$/u;

const HOSTNAME_RE =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u;

// The scheme, the longest host DNS carries, and a port.
const MAX_SERVER_CONTAINER_URL_LENGTH =
  "https://".length + 253 + ":65535".length;

/**
 * Whether `value` is an `https` origin on a domain name, as the API requires of
 * a server container URL: no path, query, fragment, or credentials, and a host
 * that is neither an IP address nor a single label. The text is read as written
 * first, because `URL` repairs `https:host` and drops an empty `?` or `#`.
 */
export const isServerContainerOrigin = (value: string): boolean => {
  if (
    value.length > MAX_SERVER_CONTAINER_URL_LENGTH ||
    /[\s?#]/u.test(value) ||
    !/^https:\/\/[^/\\]+\/?$/iu.test(value) ||
    value.replace(/\/$/u, "").endsWith(":") ||
    !URL.canParse(value)
  ) {
    return false;
  }

  const url = new URL(value);

  if (url.username || url.password || url.port === "0") {
    return false;
  }

  const labels = url.hostname.split(".");

  // A last label that is a number is an IPv4 address, `URL` having already
  // spelled `127.1` out as `127.0.0.1`; an IPv6 one is bracketed and fails the
  // pattern.
  return HOSTNAME_RE.test(url.hostname) && !/^\d+$/u.test(labels.at(-1) ?? "");
};

export const googleTagFormFields = {
  consentMode: { kind: "value", name: "consent_mode" },
  ga4MeasurementId: { kind: "value", name: "ga4_measurement_id" },
  gtmContainerId: { kind: "value", name: "gtm_container_id" },
  regenerateGatewayPath: { kind: "value", name: "regenerate_gateway_path" },
  serverContainerUrl: { kind: "value", name: "server_container_url" },
  servingMode: { kind: "value", name: "serving_mode" },
  tenantId: { kind: "value", name: "tenant_id" },
} as const;

const trimmed = z.preprocess(
  (value) => (isFormText(value) ? value.trim() : ""),
  z.string()
);

/**
 * The form as the API will take it. The server container URL is posted only
 * while a mode that uses it is chosen, so choosing Google's own servers clears
 * it.
 */
export const googleTagFormSchema = async (
  locale: Locale
): Promise<z.ZodType<UpdateTenantAnalyticsSettingsInput, unknown>> => {
  const t = await getMessagesFor(locale);

  return z
    .object({
      consentMode: z.enum(GOOGLE_TAG_CONSENT_MODES, {
        error: t("admin.settings.google_tag.validation.consent_mode_invalid"),
      }),
      ga4MeasurementId: trimmed.transform((value) => value.toUpperCase()),
      gtmContainerId: trimmed.transform((value) => value.toUpperCase()),
      regenerateGatewayPath: checkboxOnFormSchema,
      serverContainerUrl: trimmed,
      servingMode: z.enum(GOOGLE_TAG_SERVING_MODES, {
        error: t("admin.settings.google_tag.validation.serving_mode_invalid"),
      }),
      tenantId: requiredTrimmedString(t("admin.settings.tenant_missing")),
    })
    .superRefine((value, ctx) => {
      if (value.ga4MeasurementId.startsWith("UA-")) {
        ctx.addIssue({
          code: "custom",
          message: t(
            "admin.settings.google_tag.validation.universal_analytics_id"
          ),
          path: ["ga4MeasurementId"],
        });
      } else if (
        value.ga4MeasurementId &&
        !MEASUREMENT_ID_RE.test(value.ga4MeasurementId)
      ) {
        ctx.addIssue({
          code: "custom",
          message: t(
            "admin.settings.google_tag.validation.measurement_id_invalid"
          ),
          path: ["ga4MeasurementId"],
        });
      }

      if (value.gtmContainerId && !CONTAINER_ID_RE.test(value.gtmContainerId)) {
        ctx.addIssue({
          code: "custom",
          message: t(
            "admin.settings.google_tag.validation.container_id_invalid"
          ),
          path: ["gtmContainerId"],
        });
      } else if (!value.gtmContainerId && value.consentMode === "external") {
        // The API names the container ID too, since clearing it under a saved
        // external mode is refused the same way.
        ctx.addIssue({
          code: "custom",
          message: t(
            "admin.settings.google_tag.validation.container_id_required"
          ),
          path: ["gtmContainerId"],
        });
      }

      if (
        value.serverContainerUrl &&
        !isServerContainerOrigin(value.serverContainerUrl)
      ) {
        ctx.addIssue({
          code: "custom",
          message: t(
            "admin.settings.google_tag.validation.server_container_url_invalid"
          ),
          path: ["serverContainerUrl"],
        });
      } else if (
        !value.serverContainerUrl &&
        value.servingMode === "server_container"
      ) {
        ctx.addIssue({
          code: "custom",
          message: t(
            "admin.settings.google_tag.validation.server_container_url_required"
          ),
          path: ["serverContainerUrl"],
        });
      }
    })
    .transform((value) => ({
      regenerateGatewayPath: value.regenerateGatewayPath,
      settings: {
        consentMode: value.consentMode,
        ga4MeasurementId: value.ga4MeasurementId,
        gtmContainerId: value.gtmContainerId,
        serverContainerUrl: value.serverContainerUrl,
        servingMode: value.servingMode,
      },
      tenantId: value.tenantId,
    }));
};
