"use server";

import type { Locale } from "@publira/i18n";
import { parseInstant } from "@publira/utils";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  accessTicketsCacheTag,
  issueAccessTicket,
  revokeAccessTicket,
} from "#lib/access-ticket";
import { getActionLocale } from "#lib/action-messages";
import { verifyAdminSession, withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { listAllEpisodesForTenant } from "#lib/episode";
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
} from "./access-ticket-shared";

const issueTicketSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z
    .object({
      episodeId: requiredRecordId(
        t("admin.access_tickets.validation.episode_id_required")
      ),
      expiresAt: optionalTrimmedString(),
      note: optionalTrimmedString(1000),
      tenantId: requiredTrimmedString(
        t("admin.access_tickets.validation.tenant_missing")
      ),
      userId: requiredRecordId(
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
    seriesId: requiredRecordId(
      t("admin.access_tickets.validation.series_required")
    ),
    tenantId: requiredTrimmedString(
      t("admin.access_tickets.validation.tenant_missing")
    ),
  });
};

const existingTicketMessage = async (
  publicId: string,
  status: string,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);

  if (status === "active") {
    return t("admin.access_tickets.existing_active", {
      id: publicId,
    });
  }

  if (status === "expired") {
    return t("admin.access_tickets.existing_expired", {
      id: publicId,
    });
  }

  return t("admin.access_tickets.existing_ticket", {
    id: publicId,
  });
};

/**
 * Issues the ticket the form describes. `{ locale }` once a ticket was issued,
 * for the caller to word what follows in; otherwise the state the form shows.
 */
const issueTicketFromForm = async (
  formData: FormData
): Promise<{ locale: Locale } | { state: IssueAccessTicketActionState }> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const schema = await issueTicketSchema(locale);

  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      episodeId: { kind: "value", name: "episode_id" },
      expiresAt: { kind: "value", name: "expires_at" },
      note: "value",
      tenantId: { kind: "value", name: "tenant_id" },
      userId: { kind: "value", name: "user_id" },
    })
  );

  if (!parsed.success) {
    return {
      state: {
        message: toFormErrorMessage(parsed.error, { locale }),
        ok: false,
      },
    };
  }

  const result = await withAdminSessionReauth(() =>
    issueAccessTicket(
      {
        episodeId: parsed.data.episodeId,
        expiresAt: parsed.data.expiresAt,
        note: parsed.data.note,
        tenantId: parsed.data.tenantId,
        userId: parsed.data.userId,
      },
      locale
    )
  );

  if (!result.ok) {
    return {
      state: {
        message: result.message,
        ok: false,
      },
    };
  }

  // Issue is idempotent for a non-revoked pair: the server hands the existing
  // ticket back without applying the requested expiry and note, so the form
  // names that ticket instead of reporting a new grant. An expired one still
  // occupies the unique slot until it is revoked.
  if (!result.created) {
    // The message sends the operator to the list to revoke the named ticket,
    // and a list cached before another operator issued it would not show it.
    updateTag(accessTicketsCacheTag(parsed.data.tenantId));

    return {
      state: {
        message: await existingTicketMessage(
          result.ticket.publicId,
          result.ticket.status,
          locale
        ),
        ok: false,
      },
    };
  }

  updateTag(accessTicketsCacheTag(parsed.data.tenantId));

  return { locale };
};

export const issueAccessTicketAction = async (
  _prevState: IssueAccessTicketActionState,
  formData: FormData
): Promise<IssueAccessTicketActionState> => {
  const outcome = await issueTicketFromForm(formData);

  if ("state" in outcome) {
    return outcome.state;
  }

  redirect("/access-tickets?created=1");
};

/**
 * Issues a ticket from a screen that stays where it is, such as the reader
 * page: the ticket list it reads is refreshed, and success is reported in the
 * state rather than by a redirect to the ticket list.
 */
export const issueAccessTicketInPlaceAction = async (
  _prevState: IssueAccessTicketActionState,
  formData: FormData
): Promise<IssueAccessTicketActionState> => {
  const outcome = await issueTicketFromForm(formData);

  if ("state" in outcome) {
    return outcome.state;
  }

  const t = await getMessagesFor(outcome.locale);

  return { message: t("admin.access_tickets.issued"), ok: true };
};

export const listEpisodeOptionsAction = async (
  tenantId: string,
  seriesId: string,
  locale: Locale
): Promise<ListTicketEpisodeOptionsResult> => {
  // This Server Action only reads episode options; the same-origin check
  // applies to mutations.
  const schema = await listEpisodeOptionsSchema(locale);

  const parsed = schema.safeParse({
    seriesId,
    tenantId,
  });

  if (!parsed.success) {
    return {
      episodes: [],
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
    };
  }

  // The tenant comes from the client and the episodes are read with the
  // service credential, which answers for any tenant.
  await verifyAdminSession(parsed.data.tenantId);

  const result = await listAllEpisodesForTenant(
    {
      seriesId: parsed.data.seriesId,
      tenantId: parsed.data.tenantId,
    },
    locale
  );

  if (!result.ok) {
    return {
      episodes: [],
      message: result.message,
      ok: false,
    };
  }

  return {
    episodes: result.episodes.map((episode) => ({
      id: episode.id,
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

  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    revokeAccessTicket(parsed.data.tenantId, parsed.data.ticketId, locale)
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(accessTicketsCacheTag(parsed.data.tenantId));
  const t = await getMessagesFor(locale);

  return { message: t("admin.access_tickets.revoked"), ok: true };
};
