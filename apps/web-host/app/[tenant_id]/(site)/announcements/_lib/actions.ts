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
import { tenantIdFormSchema } from "#lib/auth-input";
import {
  requirePublicSession,
  withPublicSessionReauth,
} from "#lib/auth-session";

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
  tenantId: tenantIdFormSchema,
});

const markAllAnnouncementsAsReadFormSchema = z.object({
  tenantId: tenantIdFormSchema,
});

const markAnnouncementAsReadAndNavigateFormSchema = z.object({
  announcementId: announcementIdFormSchema,
  tenantId: tenantIdFormSchema,
});

export const markAnnouncementAsReadAction = async (
  formData: FormData
): Promise<void> => {
  const parsed = markAnnouncementAsReadFormSchema.safeParse(
    toFormDataInput(formData, {
      announcementId: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    return;
  }

  const { announcementId, tenantId } = parsed.data;
  const accessToken = await requirePublicSession(ANNOUNCEMENTS_RETURN_TO);
  await withPublicSessionReauth(ANNOUNCEMENTS_RETURN_TO, () =>
    markAnnouncementAsRead(tenantId, announcementId, accessToken)
  );
  updateTag(announcementsCacheTag(tenantId));
};

export const markAllAnnouncementsAsReadAction = async (
  formData: FormData
): Promise<void> => {
  const parsed = markAllAnnouncementsAsReadFormSchema.safeParse(
    toFormDataInput(formData, { tenantId: "value" })
  );
  if (!parsed.success) {
    return;
  }

  const { tenantId } = parsed.data;
  const accessToken = await requirePublicSession(ANNOUNCEMENTS_RETURN_TO);
  await withPublicSessionReauth(ANNOUNCEMENTS_RETURN_TO, () =>
    markAllAnnouncementsAsRead(tenantId, accessToken)
  );
  updateTag(announcementsCacheTag(tenantId));
};

export const markAnnouncementAsReadAndNavigateAction = async (
  formData: FormData
): Promise<void> => {
  const parsed = markAnnouncementAsReadAndNavigateFormSchema.safeParse(
    toFormDataInput(formData, {
      announcementId: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    return;
  }

  const { announcementId, tenantId } = parsed.data;
  const accessToken = await requirePublicSession(ANNOUNCEMENTS_RETURN_TO);
  const announcement = await withPublicSessionReauth(
    ANNOUNCEMENTS_RETURN_TO,
    () => getMyAnnouncement(tenantId, announcementId, accessToken)
  );
  if (!announcement) {
    return;
  }

  await withPublicSessionReauth(ANNOUNCEMENTS_RETURN_TO, () =>
    markAnnouncementAsRead(tenantId, announcementId, accessToken)
  );
  updateTag(announcementsCacheTag(tenantId));

  const linkUrl = toSafeAnnouncementLinkUrl(announcement.linkUrl);
  if (!linkUrl) {
    return;
  }

  redirect(linkUrl);
};
