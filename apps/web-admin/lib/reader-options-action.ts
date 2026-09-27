"use server";

import type { Locale } from "@publira/i18n";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { z } from "zod";

import { redirectToLoginIfSessionRejected } from "./auth-session";
import { requiredTrimmedString } from "./form-schemas";
import { getMessagesFor } from "./messages";
import { listReaders } from "./reader";
import type { ListReaderOptionsResult } from "./reader-options";

/** An email address is the longest thing an operator types to find a reader. */
const READER_QUERY_MAX_LENGTH = 254;

/** How many readers one search offers; a narrower query finds the rest. */
const READER_OPTION_LIMIT = 20;

const listReaderOptionsSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    query: z
      .string()
      .trim()
      .max(
        READER_QUERY_MAX_LENGTH,
        t("admin.reader_picker.validation.query_too_long", {
          count: String(READER_QUERY_MAX_LENGTH),
        })
      ),
    tenantId: requiredTrimmedString(
      t("admin.reader_picker.validation.tenant_missing")
    ),
  });
};

/**
 * The tenant's active readers whose name or email contains `query`. Only an
 * active reader can be granted a ticket or linked to an author, so the others
 * are never offered.
 */
export const listReaderOptionsAction = async (
  tenantId: string,
  query: string,
  locale: Locale
): Promise<ListReaderOptionsResult> => {
  // This Server Action only reads reader options; the same-origin check
  // applies to mutations.
  const schema = await listReaderOptionsSchema(locale);
  const parsed = schema.safeParse({ query, tenantId });
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
      readers: [],
    };
  }

  const result = await listReaders(parsed.data.tenantId, locale, {
    limit: READER_OPTION_LIMIT,
    query: parsed.data.query,
    status: "active",
  });
  await redirectToLoginIfSessionRejected(result);
  if (!result.ok) {
    return { message: result.message, ok: false, readers: [] };
  }
  return {
    ok: true,
    readers: result.readers.map((reader) => ({
      email: reader.email,
      id: reader.id,
      name: reader.name,
    })),
  };
};
