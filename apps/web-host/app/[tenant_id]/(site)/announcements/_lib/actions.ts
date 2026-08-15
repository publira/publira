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
  await markAnnouncementAsRead(tenantId, announcementId);
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
  await markAllAnnouncementsAsRead(tenantId);
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
  const announcement = await getMyAnnouncement(tenantId, announcementId);
  if (!announcement) {
    return;
  }

  await markAnnouncementAsRead(tenantId, announcementId);
  updateTag(announcementsCacheTag(tenantId));

  const linkUrl = toSafeAnnouncementLinkUrl(announcement.linkUrl);
  if (!linkUrl) {
    return;
  }

  redirect(linkUrl);
};
