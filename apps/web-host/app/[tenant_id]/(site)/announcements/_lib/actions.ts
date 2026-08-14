"use server";

import { toFormDataInput } from "@publira/utils/form-data";
import { revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  markAllAnnouncementsAsRead,
  markAnnouncementAsRead,
} from "#lib/announcements";
import { tenantIdFormSchema } from "#lib/auth-input";

const announcementIdFormSchema = z.string().trim().min(1).max(64);

/**
 * Announcement links are operator-authored (internal path or http(s) URL).
 * Anything else is treated as missing so a tampered hidden field cannot
 * become a `javascript:` redirect.
 */
const announcementLinkUrlFormSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine(
    (value) =>
      (value.startsWith("/") && !value.startsWith("//")) ||
      value.startsWith("https://") ||
      value.startsWith("http://")
  );

const markAnnouncementAsReadFormSchema = z.object({
  announcementId: announcementIdFormSchema,
  tenantId: tenantIdFormSchema,
});

const markAllAnnouncementsAsReadFormSchema = z.object({
  tenantId: tenantIdFormSchema,
});

const markAnnouncementAsReadAndNavigateFormSchema = z.object({
  announcementId: z
    .string()
    .trim()
    .max(64)
    .transform((value) => (value.length > 0 ? value : undefined))
    .optional(),
  linkUrl: announcementLinkUrlFormSchema,
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
  revalidateTag(`member-announcements-${tenantId}`, "max");
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
  revalidateTag(`member-announcements-${tenantId}`, "max");
};

export const markAnnouncementAsReadAndNavigateAction = async (
  formData: FormData
): Promise<void> => {
  const parsed = markAnnouncementAsReadAndNavigateFormSchema.safeParse(
    toFormDataInput(formData, {
      announcementId: "value",
      linkUrl: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    return;
  }

  const { announcementId, linkUrl, tenantId } = parsed.data;
  if (announcementId) {
    await markAnnouncementAsRead(tenantId, announcementId);
    revalidateTag(`member-announcements-${tenantId}`, "max");
  }

  redirect(linkUrl);
};
