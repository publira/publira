"use server";

import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
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
  requiredTrimmedString,
} from "#lib/form-schemas";

import type {
  IssueAccessTicketActionState,
  ListTicketEpisodeOptionsResult,
  RevokeAccessTicketActionState,
} from "../ticket-types";

const issueTicketSchema = (messages: SharedMessages) =>
  z
    .object({
      episodePublicId: requiredTrimmedString(
        getMessage(
          messages,
          "admin.access_tickets.validation.episode_id_required"
        )
      ),
      expiresAt: optionalTrimmedString(),
      note: optionalTrimmedString(1000),
      tenantId: requiredTrimmedString(
        getMessage(messages, "admin.access_tickets.validation.tenant_missing")
      ),
      userPublicId: requiredTrimmedString(
        getMessage(messages, "admin.access_tickets.validation.user_id_required")
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
          message: getMessage(
            messages,
            "admin.access_tickets.validation.expires_at_invalid"
          ),
          path: ["expiresAt"],
        });
        return;
      }
      if (Temporal.Instant.compare(parsed, Temporal.Now.instant()) <= 0) {
        ctx.addIssue({
          code: "custom",
          message: getMessage(
            messages,
            "admin.access_tickets.validation.expires_at_past"
          ),
          path: ["expiresAt"],
        });
      }
    });

const revokeTicketSchema = (messages: SharedMessages) =>
  z.object({
    publicId: requiredTrimmedString(
      getMessage(messages, "admin.access_tickets.validation.revoke_target")
    ),
    tenantId: requiredTrimmedString(
      getMessage(messages, "admin.access_tickets.validation.revoke_target")
    ),
  });

const listEpisodeOptionsSchema = (messages: SharedMessages) =>
  z.object({
    seriesPublicId: requiredTrimmedString(
      getMessage(messages, "admin.access_tickets.validation.series_required")
    ),
    tenantId: requiredTrimmedString(
      getMessage(messages, "admin.access_tickets.validation.tenant_missing")
    ),
  });

const existingNonActiveTicketMessage = (
  publicId: string,
  status: string,
  messages: SharedMessages
): string => {
  if (status === "expired") {
    return getMessage(messages, "admin.access_tickets.existing_expired", {
      id: publicId,
    });
  }

  return getMessage(messages, "admin.access_tickets.existing_ticket", {
    id: publicId,
  });
};

export const issueAccessTicketAction = async (
  _prevState: IssueAccessTicketActionState,
  formData: FormData
): Promise<IssueAccessTicketActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const messages = sharedCatalog(locale);
  const parsed = issueTicketSchema(messages).safeParse(
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
      message: existingNonActiveTicketMessage(
        result.ticket.publicId,
        result.ticket.status,
        messages
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
  const parsed = listEpisodeOptionsSchema(sharedCatalog(locale)).safeParse({
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
    publicId: { kind: "value", name: "public_id" },
    tenantId: { kind: "value", name: "tenant_id" },
  });
  const parsed = revokeTicketSchema(sharedCatalog(locale)).safeParse(input);
  const publicId =
    typeof input.publicId === "string" ? input.publicId.trim() : "";
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
      publicId,
    };
  }

  const result = await withAdminSessionReauth(() =>
    revokeAccessTicket(parsed.data.tenantId, parsed.data.publicId, locale)
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
    message: getMessage(sharedCatalog(locale), "admin.access_tickets.revoked"),
    ok: true,
    publicId: parsed.data.publicId,
  };
};
