"use server";

import { parseInstant } from "@publira/utils";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";

import { issueAccessTicket, revokeAccessTicket } from "#lib/access-ticket";

import type {
  IssueAccessTicketActionState,
  RevokeAccessTicketActionState,
} from "../ticket-types";

export const issueAccessTicketAction = async (
  _prevState: IssueAccessTicketActionState,
  formData: FormData
): Promise<IssueAccessTicketActionState> => {
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  const userPublicId = String(formData.get("user_public_id") ?? "").trim();
  const episodePublicId = String(
    formData.get("episode_public_id") ?? ""
  ).trim();
  // The form already converted the datetime-local wall clock to an absolute
  // instant, so anything without `Z` / an offset is rejected below.
  const expiresAt = String(formData.get("expires_at") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  if (!tenantId) {
    return {
      message: "テナント ID が見つかりません。",
      ok: false,
    };
  }
  if (!userPublicId) {
    return {
      message: "ユーザー public_id は必須です。",
      ok: false,
    };
  }
  if (!episodePublicId) {
    return {
      message: "エピソード public_id は必須です。",
      ok: false,
    };
  }

  if (expiresAt !== "") {
    const parsed = parseInstant(expiresAt);
    if (!parsed) {
      return {
        message: "有効期限の形式が正しくありません。",
        ok: false,
      };
    }
    if (Temporal.Instant.compare(parsed, Temporal.Now.instant()) <= 0) {
      return {
        message: "有効期限は未来の日時を指定してください。",
        ok: false,
      };
    }
  }

  const result = await issueAccessTicket({
    episodePublicId,
    expiresAt,
    note,
    tenantId,
    userPublicId,
  });

  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  updateTag(`access-tickets-${tenantId}`);
  redirect("/access-tickets");
};

export const revokeAccessTicketAction = async (
  _prevState: RevokeAccessTicketActionState,
  formData: FormData
): Promise<RevokeAccessTicketActionState> => {
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  const publicId = String(formData.get("public_id") ?? "").trim();

  if (!tenantId || !publicId) {
    return {
      message: "失効対象が不正です。",
      ok: false,
      publicId,
    };
  }

  const result = await revokeAccessTicket(tenantId, publicId);
  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
      publicId,
    };
  }

  updateTag(`access-tickets-${tenantId}`);
  return {
    message: "チケットを失効しました。",
    ok: true,
    publicId,
  };
};
