"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";

import { createNotification } from "#lib/notification";

import type { CreateNotificationActionState } from "../notification-types";

export const createNotificationAction = async (
  _prevState: CreateNotificationActionState,
  formData: FormData
): Promise<CreateNotificationActionState> => {
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const linkUrl = String(formData.get("link_url") ?? "").trim();
  const audienceTypeRaw = String(formData.get("audience_type") ?? "all").trim();
  const targetUserPublicIds = formData
    .getAll("target_user_public_ids")
    .flatMap((value) => {
      const trimmed = String(value).trim();
      return trimmed === "" ? [] : [trimmed];
    });

  if (!tenantId) {
    return {
      message: "テナント ID が見つかりません。",
      ok: false,
    };
  }
  if (!title) {
    return {
      message: "タイトルは必須です。",
      ok: false,
    };
  }
  if (!body) {
    return {
      message: "本文は必須です。",
      ok: false,
    };
  }

  const audienceType =
    audienceTypeRaw === "selected" ? ("selected" as const) : ("all" as const);

  if (audienceType === "selected" && targetUserPublicIds.length === 0) {
    return {
      message: "指定ユーザー配信では対象ユーザーを 1 件以上選択してください。",
      ok: false,
    };
  }

  if (
    linkUrl !== "" &&
    !linkUrl.startsWith("/") &&
    !linkUrl.startsWith("https://") &&
    !linkUrl.startsWith("http://")
  ) {
    return {
      message: "リンク先は / もしくは http(s):// で入力してください。",
      ok: false,
    };
  }

  const result = await createNotification({
    audienceType,
    body,
    linkUrl,
    targetUserPublicIds,
    tenantId,
    title,
  });

  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  updateTag(`notifications-${tenantId}`);
  redirect("/notifications");
};
