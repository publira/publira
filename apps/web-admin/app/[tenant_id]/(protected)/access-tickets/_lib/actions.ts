"use server";

import type { Locale } from "@publira/i18n";
import { parseInstant } from "@publira/utils";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { issueAccessTicket, revokeAccessTicket } from "#lib/access-ticket";
import { getActionLocale } from "#lib/action-messages";
import {
  redirectToLoginIfSessionRejected,
  withAdminSessionReauth,
} from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { listAllEpisodes } from "#lib/episode";
import {
  optionalTrimmedString,
  requiredRecordId,
  requiredTrimmedString,
} from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";

import type {
  IssueAccessTicketActionState,
  ListTicketEpisodeOptionsResult,
  RevokeAccessTicketActionState,
} from "../ticket-types";

const issueTicketSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z
    .object({
      episodePublicId: requiredTrimmedString(
        t("admin.access_tickets.validation.episode_id_required")
      ),
      expiresAt: optionalTrimmedString(),
      note: optionalTrimmedString(1000),
      tenantId: requiredTrimmedString(
        t("admin.access_tickets.validation.tenant_missing")
      ),
      userPublicId: requiredTrimmedString(
        t("admin.access_tickets.validation.user_id_required")
      ),
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
          message: t("admin.access_tickets.validation.expires_at_invalid"),
          path: ["expiresAt"],
        });
        return;
      }
      if (Temporal.Instant.compare(parsed, Temporal.Now.instant()) <= 0) {
        ctx.addIssue({
          code: "custom",
          message: t("admin.access_tickets.validation.expires_at_past"),
          path: ["expiresAt"],
        });
      }
    });
};
const revokeTicketSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    tenantId: requiredTrimmedString(
      t("admin.access_tickets.validation.revoke_target")
    ),
    ticketId: requiredRecordId(
      t("admin.access_tickets.validation.revoke_target")
    ),
  });
};
const listEpisodeOptionsSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    seriesPublicId: requiredTrimmedString(
      t("admin.access_tickets.validation.series_required")
    ),
    tenantId: requiredTrimmedString(
      t("admin.access_tickets.validation.tenant_missing")
    ),
  });
};
const existingNonActiveTicketMessage = async (
  publicId: string,
  status: string,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);
  if (status === "expired") {
    return t("admin.access_tickets.existing_expired", {
      id: publicId,
    });
  }

  return t("admin.access_tickets.existing_ticket", {
    id: publicId,
  });
};

export const issueAccessTicketAction = async (
  _prevState: IssueAccessTicketActionState,
  formData: FormData
): Promise<IssueAccessTicketActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const schema = await issueTicketSchema(locale);
  const parsed = schema.safeParse(
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
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    issueAccessTicket(
      {
        episodePublicId: parsed.data.episodePublicId,
        expiresAt: parsed.data.expiresAt,
        note: parsed.data.note,
        tenantId: parsed.data.tenantId,
        userPublicId: parsed.data.userPublicId,
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

  // Issue is idempotent for a non-revoked pair. An expired row still occupies
  // the unique slot, so treat that as a form error instead of a new grant.
  if (result.ticket.status !== "active") {
    return {
      message: await existingNonActiveTicketMessage(
        result.ticket.publicId,
        result.ticket.status,
        locale
      ),
      ok: false,
    };
  }

  updateTag(`access-tickets-${parsed.data.tenantId}`);
  redirect("/access-tickets?created=1");
};

export const listEpisodeOptionsAction = async (
  tenantId: string,
  seriesPublicId: string,
  locale: Locale
): Promise<ListTicketEpisodeOptionsResult> => {
  // This Server Action only reads episode options; the same-origin check
  // applies to mutations.
  const schema = await listEpisodeOptionsSchema(locale);
  const parsed = schema.safeParse({
    seriesPublicId,
    tenantId,
  });
  if (!parsed.success) {
    return {
      episodes: [],
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
    };
  }

  const result = await listAllEpisodes(
    {
      seriesPublicId: parsed.data.seriesPublicId,
      tenantId: parsed.data.tenantId,
    },
    locale
  );
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
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const input = toFormDataInput(formData, {
    tenantId: { kind: "value", name: "tenant_id" },
    ticketId: { kind: "value", name: "access_ticket_id" },
  });
  const schema = await revokeTicketSchema(locale);
  const parsed = schema.safeParse(input);
  const ticketId =
    typeof input.ticketId === "string" ? input.ticketId.trim() : "";
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
      ticketId,
    };
  }

  const result = await withAdminSessionReauth(() =>
    revokeAccessTicket(parsed.data.tenantId, parsed.data.ticketId, locale)
  );
  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
      ticketId: parsed.data.ticketId,
    };
  }

  updateTag(`access-tickets-${parsed.data.tenantId}`);
  const t = await getMessagesFor(locale);
  return {
    message: t("admin.access_tickets.revoked"),
    ok: true,
    ticketId: parsed.data.ticketId,
  };
};
