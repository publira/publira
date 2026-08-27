"use server";

import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createAnnouncement } from "#lib/announcement";
import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import {
  optionalTrimmedString,
  requiredTrimmedString,
  trimmedStringListFormSchema,
} from "#lib/form-schemas";

import type { CreateAnnouncementActionState } from "../announcement-types";

const announcementFormSchema = z
  .object({
    audienceType: z.preprocess(
      (value) => {
        if (typeof value !== "string" || value.trim() === "") {
          return "all";
        }

        return value.trim();
      },
      z.enum(["all", "selected"], { error: "配信対象が不正です。" })
    ),
    body: requiredTrimmedString("本文は必須です。", 2000),
    linkUrl: optionalTrimmedString(2048),
    targetUserPublicIds: trimmedStringListFormSchema,
    tenantId: requiredTrimmedString("テナント ID が見つかりません。"),
    title: requiredTrimmedString("タイトルは必須です。", 120),
  })
  .superRefine((value, ctx) => {
    if (
      value.audienceType === "selected" &&
      value.targetUserPublicIds.length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "指定ユーザー配信では対象ユーザーを 1 件以上選択してください。",
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
        message: "リンク先は / もしくは http(s):// で入力してください。",
        path: ["linkUrl"],
      });
    }
  });

export const createAnnouncementAction = async (
  _prevState: CreateAnnouncementActionState,
  formData: FormData
): Promise<CreateAnnouncementActionState> => {
  await assertSameOrigin();
  const parsed = announcementFormSchema.safeParse(
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
      message: toFormErrorMessage(parsed.error),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    createAnnouncement({
      audienceType: parsed.data.audienceType,
      body: parsed.data.body,
      linkUrl: parsed.data.linkUrl,
      targetUserPublicIds: parsed.data.targetUserPublicIds,
      tenantId: parsed.data.tenantId,
      title: parsed.data.title,
    })
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
