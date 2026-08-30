"use server";

import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  announcementsCacheTag,
  getMyAnnouncement,
  markAllAnnouncementsAsRead,
  markAnnouncementAsRead,
} from "#lib/announcements";
import { tenantIdSchema } from "#lib/auth-input";
import {
  requirePublicSession,
  withPublicSessionReauth,
} from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { localeFormSchema } from "#lib/locale-form";
import { tenantLocalePath } from "#lib/tenant-locale-path";

const ANNOUNCEMENTS_RETURN_TO = "/announcements";

const announcementIdFormSchema = z.string().trim().min(1).max(64);

/**
 * Operator-authored destination on the authorized announcement row.
 * Form-supplied URLs never reach `redirect()`.
 */
const toSafeAnnouncementLinkUrl = (value: string): string | null => {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) {
    return null;
  }

  const isInternalPath =
    trimmed.startsWith("/") &&
    !trimmed.startsWith("//") &&
    !trimmed.startsWith("/\\");
  if (
    isInternalPath ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("http://")
  ) {
    return trimmed;
  }

  return null;
};

const markAnnouncementAsReadFormSchema = z.object({
  announcementId: announcementIdFormSchema,
  locale: localeFormSchema,
  tenantId: tenantIdSchema,
});

const markAllAnnouncementsAsReadFormSchema = z.object({
  locale: localeFormSchema,
  tenantId: tenantIdSchema,
});

const markAnnouncementAsReadAndNavigateFormSchema = z.object({
  announcementId: announcementIdFormSchema,
  locale: localeFormSchema,
  tenantId: tenantIdSchema,
});

export const markAnnouncementAsReadAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();
  const parsed = markAnnouncementAsReadFormSchema.safeParse(
    toFormDataInput(formData, {
      announcementId: "value",
      locale: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    return;
  }

  const { announcementId, locale, tenantId } = parsed.data;
  const accessToken = await requirePublicSession(
    locale,
    ANNOUNCEMENTS_RETURN_TO,
    tenantId
  );
  await withPublicSessionReauth(
    locale,
    ANNOUNCEMENTS_RETURN_TO,
    () => markAnnouncementAsRead(tenantId, announcementId, accessToken),
    tenantId
  );
  updateTag(announcementsCacheTag(tenantId));
};

export const markAllAnnouncementsAsReadAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();
  const parsed = markAllAnnouncementsAsReadFormSchema.safeParse(
    toFormDataInput(formData, { locale: "value", tenantId: "value" })
  );
  if (!parsed.success) {
    return;
  }

  const { locale, tenantId } = parsed.data;
  const accessToken = await requirePublicSession(
    locale,
    ANNOUNCEMENTS_RETURN_TO,
    tenantId
  );
  await withPublicSessionReauth(
    locale,
    ANNOUNCEMENTS_RETURN_TO,
    () => markAllAnnouncementsAsRead(tenantId, accessToken),
    tenantId
  );
  updateTag(announcementsCacheTag(tenantId));
};

export const markAnnouncementAsReadAndNavigateAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();
  const parsed = markAnnouncementAsReadAndNavigateFormSchema.safeParse(
    toFormDataInput(formData, {
      announcementId: "value",
      locale: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    return;
  }

  const { announcementId, locale, tenantId } = parsed.data;
  const accessToken = await requirePublicSession(
    locale,
    ANNOUNCEMENTS_RETURN_TO,
    tenantId
  );
  const announcement = await withPublicSessionReauth(
    locale,
    ANNOUNCEMENTS_RETURN_TO,
    () => getMyAnnouncement(tenantId, announcementId, accessToken),
    tenantId
  );
  if (!announcement) {
    return;
  }

  await withPublicSessionReauth(
    locale,
    ANNOUNCEMENTS_RETURN_TO,
    () => markAnnouncementAsRead(tenantId, announcementId, accessToken),
    tenantId
  );
  updateTag(announcementsCacheTag(tenantId));

  const linkUrl = toSafeAnnouncementLinkUrl(announcement.linkUrl);
  if (!linkUrl) {
    return;
  }

  // An operator writes `/series/SR01`, not `/ja/series/SR01`: the destination
  // is the same page in whichever language the reader is already in. An
  // external URL passes through unchanged.
  const destination = await tenantLocalePath(tenantId, locale, linkUrl);
  redirect(destination);
};
