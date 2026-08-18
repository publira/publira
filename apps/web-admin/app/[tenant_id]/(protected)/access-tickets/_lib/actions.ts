"use server";

import { parseInstant } from "@publira/utils";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { issueAccessTicket, revokeAccessTicket } from "#lib/access-ticket";
import {
  redirectToLoginIfSessionRejected,
  withAdminSessionReauth,
} from "#lib/auth-session";
import { listAllEpisodes } from "#lib/episode";
import {
  optionalTrimmedString,
  requiredTrimmedString,
} from "#lib/form-schemas";

import type {
  IssueAccessTicketActionState,
  ListTicketEpisodeOptionsResult,
  RevokeAccessTicketActionState,
} from "../ticket-types";

const issueTicketSchema = z
  .object({
    episodePublicId: requiredTrimmedString("エピソード public_id は必須です。"),
    expiresAt: optionalTrimmedString(),
    note: optionalTrimmedString(1000),
    tenantId: requiredTrimmedString("テナント ID が見つかりません。"),
    userPublicId: requiredTrimmedString("ユーザー public_id は必須です。"),
  })
  .superRefine((value, ctx) => {
    if (value.expiresAt === "") {
      return;
    }

    // The form already converted the datetime-local wall clock to an absolute
    // instant, so anything without `Z` / an offset is rejected here.
    const parsed = parseInstant(value.expiresAt);
    if (!parsed) {
      ctx.addIssue({
        code: "custom",
        message: "有効期限の形式が正しくありません。",
        path: ["expiresAt"],
      });
      return;
    }
    if (Temporal.Instant.compare(parsed, Temporal.Now.instant()) <= 0) {
      ctx.addIssue({
        code: "custom",
        message: "有効期限は未来の日時を指定してください。",
        path: ["expiresAt"],
      });
    }
  });

const revokeTicketSchema = z.object({
  publicId: requiredTrimmedString("失効対象が不正です。"),
  tenantId: requiredTrimmedString("失効対象が不正です。"),
});

const listEpisodeOptionsSchema = z.object({
  seriesPublicId: requiredTrimmedString("シリーズを選択してください。"),
  tenantId: requiredTrimmedString("テナント ID が見つかりません。"),
});

const existingNonActiveTicketMessage = (publicId: string, status: string) => {
  if (status === "expired") {
    return `同じユーザー・エピソードの期限切れチケット（${publicId}）が未失効のまま残っています。期限を付け直すには、先に一覧から失効してください。`;
  }

  return `同じユーザー・エピソードのチケット（${publicId}）を発行できません。一覧を確認してください。`;
};

export const issueAccessTicketAction = async (
  _prevState: IssueAccessTicketActionState,
  formData: FormData
): Promise<IssueAccessTicketActionState> => {
  const parsed = issueTicketSchema.safeParse(
    toFormDataInput(formData, {
      episodePublicId: { kind: "value", name: "episode_public_id" },
      expiresAt: { kind: "value", name: "expires_at" },
      note: "value",
      tenantId: { kind: "value", name: "tenant_id" },
      userPublicId: { kind: "value", name: "user_public_id" },
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    issueAccessTicket({
      episodePublicId: parsed.data.episodePublicId,
      expiresAt: parsed.data.expiresAt,
      note: parsed.data.note,
      tenantId: parsed.data.tenantId,
      userPublicId: parsed.data.userPublicId,
    })
  );

  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  // Issue is idempotent for a non-revoked pair. An expired row still occupies
  // the unique slot, so treat that as a form error instead of a new grant.
  if (result.ticket.status !== "active") {
    return {
      message: existingNonActiveTicketMessage(
        result.ticket.publicId,
        result.ticket.status
      ),
      ok: false,
    };
  }

  updateTag(`access-tickets-${parsed.data.tenantId}`);
  redirect("/access-tickets?created=1");
};

export const listEpisodeOptionsAction = async (
  tenantId: string,
  seriesPublicId: string
): Promise<ListTicketEpisodeOptionsResult> => {
  const parsed = listEpisodeOptionsSchema.safeParse({
    seriesPublicId,
    tenantId,
  });
  if (!parsed.success) {
    return {
      episodes: [],
      message: toFormErrorMessage(parsed.error),
      ok: false,
    };
  }

  const result = await listAllEpisodes({
    seriesPublicId: parsed.data.seriesPublicId,
    tenantId: parsed.data.tenantId,
  });
  await redirectToLoginIfSessionRejected(result);
  if (!result.ok) {
    return {
      episodes: [],
      message: result.message,
      ok: false,
    };
  }

  return {
    episodes: result.episodes.map((episode) => ({
      publicId: episode.publicId,
      title: episode.title,
    })),
    ok: true,
  };
};

export const revokeAccessTicketAction = async (
  _prevState: RevokeAccessTicketActionState,
  formData: FormData
): Promise<RevokeAccessTicketActionState> => {
  const input = toFormDataInput(formData, {
    publicId: { kind: "value", name: "public_id" },
    tenantId: { kind: "value", name: "tenant_id" },
  });
  const parsed = revokeTicketSchema.safeParse(input);
  const publicId =
    typeof input.publicId === "string" ? input.publicId.trim() : "";
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error),
      ok: false,
      publicId,
    };
  }

  const result = await withAdminSessionReauth(() =>
    revokeAccessTicket(parsed.data.tenantId, parsed.data.publicId)
  );
  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
      publicId: parsed.data.publicId,
    };
  }

  updateTag(`access-tickets-${parsed.data.tenantId}`);
  return {
    message: "チケットを失効しました。",
    ok: true,
    publicId: parsed.data.publicId,
  };
};
