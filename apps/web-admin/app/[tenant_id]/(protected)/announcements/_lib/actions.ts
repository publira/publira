"use server";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { createAnnouncement } from "#lib/announcement";
import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import {
  optionalTrimmedString,
  requiredTrimmedString,
  trimmedStringListFormSchema,
} from "#lib/form-schemas";

import type { CreateAnnouncementActionState } from "../announcement-types";

const announcementFormSchema = (messages: SharedMessages) =>
  z
    .object({
      audienceType: z.preprocess(
        (value) => {
          if (typeof value !== "string" || value.trim() === "") {
            return "all";
          }

          return value.trim();
        },
        z.enum(["all", "selected"], {
          error: getMessage(
            messages,
            "admin.announcements.validation.audience_invalid"
          ),
        })
      ),
      body: requiredTrimmedString(
        getMessage(messages, "admin.announcements.validation.body_required"),
        2000
      ),
      linkUrl: optionalTrimmedString(2048),
      targetUserPublicIds: trimmedStringListFormSchema,
      tenantId: requiredTrimmedString(
        getMessage(messages, "admin.announcements.validation.tenant_missing")
      ),
      title: requiredTrimmedString(
        getMessage(messages, "admin.announcements.validation.title_required"),
        120
      ),
    })
    .superRefine((value, ctx) => {
      if (
        value.audienceType === "selected" &&
        value.targetUserPublicIds.length === 0
      ) {
        ctx.addIssue({
          code: "custom",
          message: getMessage(
            messages,
            "admin.announcements.validation.target_users_required"
          ),
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
          message: getMessage(
            messages,
            "admin.announcements.validation.link_invalid"
          ),
          path: ["linkUrl"],
        });
      }
    });

export const createAnnouncementAction = async (
  _prevState: CreateAnnouncementActionState,
  formData: FormData
): Promise<CreateAnnouncementActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const parsed = announcementFormSchema(sharedCatalog(locale)).safeParse(
    toFormDataInput(formData, {
      audienceType: { kind: "value", name: "audience_type" },
      body: "value",
      linkUrl: { kind: "value", name: "link_url" },
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

  const result = await withAdminSessionReauth(() =>
    createAnnouncement(
      {
        audienceType: parsed.data.audienceType,
        body: parsed.data.body,
        linkUrl: parsed.data.linkUrl,
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
