"use server";

import type { Locale } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { parseInstant, toInstantIsoString } from "@publira/utils";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { createAnnouncement, unpinAnnouncement } from "#lib/announcement";
import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import {
  optionalTrimmedString,
  requiredTrimmedString,
  trimmedStringListFormSchema,
} from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import type { CreateAnnouncementActionState } from "../announcement-types";

const announcementFormSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z
    .object({
      audienceType: z.preprocess(
        (value) => {
          if (typeof value !== "string" || value.trim() === "") {
            return "all";
          }

          return value.trim();
        },
        z.enum(["all", "selected"], {
          error: t("admin.announcements.validation.audience_invalid"),
        })
      ),
      body: requiredTrimmedString(
        t("admin.announcements.validation.body_required"),
        2000
      ),
      linkUrl: optionalTrimmedString(2048),
      // An unchecked checkbox posts nothing at all, which is the "no banner"
      // answer rather than a missing field.
      pinned: z.preprocess(
        (value) => typeof value === "string" && value.trim() !== "",
        z.boolean()
      ),
      pinnedUntil: optionalTrimmedString(64),
      targetUserPublicIds: trimmedStringListFormSchema,
      tenantId: requiredTrimmedString(
        t("admin.announcements.validation.tenant_missing")
      ),
      title: requiredTrimmedString(
        t("admin.announcements.validation.title_required"),
        120
      ),
    })
    .superRefine((value, ctx) => {
      // The banner read behind the site answers no reader in particular, so an
      // announcement addressed to named readers has nowhere to show. The server
      // refuses the pair too; saying so here keeps the operator in the form.
      if (value.pinned && value.audienceType !== "all") {
        ctx.addIssue({
          code: "custom",
          message: t("admin.announcements.validation.pinned_audience"),
          path: ["pinned"],
        });
      }

      if (
        value.audienceType === "selected" &&
        value.targetUserPublicIds.length === 0
      ) {
        ctx.addIssue({
          code: "custom",
          message: t("admin.announcements.validation.target_users_required"),
          path: ["targetUserPublicIds"],
        });
      }

      const isInternalPath =
        value.linkUrl.startsWith("/") && !value.linkUrl.startsWith("//");
      if (
        value.linkUrl !== "" &&
        !isInternalPath &&
        !value.linkUrl.startsWith("https://") &&
        !value.linkUrl.startsWith("http://")
      ) {
        ctx.addIssue({
          code: "custom",
          message: t("admin.announcements.validation.link_invalid"),
          path: ["linkUrl"],
        });
      }
    });
};

/**
 * The instant a banner is asked to stop at, read from what the form posted.
 *
 * The form posts an absolute instant resolved against the zone it was rendered
 * in. A leftover `datetime-local` wall clock (no JS) is still accepted and read
 * in the tenant's current display zone, the same way an episode's publish time
 * is.
 */
const toPinnedUntil = async (
  raw: string,
  tenantId: string,
  locale: Locale
): Promise<{ ok: true; value: string } | { ok: false; message: string }> => {
  if (!raw) {
    return { ok: true, value: "" };
  }

  const [t, timeZone] = await Promise.all([
    getMessagesFor(locale),
    getTenantDisplayTimeZone(tenantId),
  ]);
  const value = toInstantIsoString(raw, timeZone);
  const parsed = parseInstant(value);
  if (!parsed) {
    return {
      message: t("admin.announcements.validation.pinned_until_invalid"),
      ok: false,
    };
  }
  if (Temporal.Instant.compare(parsed, Temporal.Now.instant()) <= 0) {
    return {
      message: t("admin.announcements.validation.pinned_until_future"),
      ok: false,
    };
  }

  return { ok: true, value };
};

export const createAnnouncementAction = async (
  _prevState: CreateAnnouncementActionState,
  formData: FormData
): Promise<CreateAnnouncementActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const schema = await announcementFormSchema(locale);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      audienceType: { kind: "value", name: "audience_type" },
      body: "value",
      linkUrl: { kind: "value", name: "link_url" },
      pinned: "value",
      pinnedUntil: { kind: "value", name: "pinned_until" },
      targetUserPublicIds: { kind: "values", name: "target_user_public_ids" },
      tenantId: { kind: "value", name: "tenant_id" },
      title: "value",
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
    };
  }

  const pinnedUntil = parsed.data.pinned
    ? await toPinnedUntil(parsed.data.pinnedUntil, parsed.data.tenantId, locale)
    : ({ ok: true, value: "" } as const);
  if (!pinnedUntil.ok) {
    return {
      message: pinnedUntil.message,
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    createAnnouncement(
      {
        audienceType: parsed.data.audienceType,
        body: parsed.data.body,
        linkUrl: parsed.data.linkUrl,
        pinned: parsed.data.pinned,
        pinnedUntil: pinnedUntil.value,
        targetUserPublicIds: parsed.data.targetUserPublicIds,
        tenantId: parsed.data.tenantId,
        title: parsed.data.title,
      },
      locale
    )
  );

  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  updateTag(`announcements-${parsed.data.tenantId}`);
  redirect("/announcements");
};

const unpinAnnouncementFormSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    // Both fields are written by the list rather than typed, so a failure here
    // is a bug in the row and gets the shared validation wording.
    announcementId: z.string().trim().pipe(z.uuid()),
    tenantId: requiredTrimmedString(
      t("admin.announcements.validation.tenant_missing")
    ),
  });
};

/**
 * Take one announcement's banner down. The announcement stays in the list, so
 * this is the control an operator reaches for once the event a notice was about
 * is over.
 */
export const unpinAnnouncementAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const schema = await unpinAnnouncementFormSchema(locale);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      announcementId: { kind: "value", name: "announcement_id" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    unpinAnnouncement(
      {
        announcementId: parsed.data.announcementId,
        tenantId: parsed.data.tenantId,
      },
      locale
    )
  );
  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  updateTag(`announcements-${parsed.data.tenantId}`);
  return null;
};
