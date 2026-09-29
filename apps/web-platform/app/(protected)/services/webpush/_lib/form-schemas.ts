import type { Locale } from "@publira/i18n";
import { z } from "zod";

import { revisionFormSchema } from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";

/** Mirrors `webpushsettings.maxSubjectLength`. */
const MAX_SUBJECT_LENGTH = 2048;

/** One bare address, the form `mail.ParseAddress` accepts without a name. */
const BARE_ADDRESS_RE = /^[^\s@<>(),;:"\\[\]]+@[^\s@<>(),;:"\\[\]]+$/u;

/**
 * Mirrors `webpushsettings.ValidateSubject`: a `mailto:` URI naming one bare
 * address, or an absolute `https:` URL without credentials. The server stays
 * the authority; this only lets the form answer before a round trip.
 */
export const isWebPushSubject = (value: string): boolean => {
  if (value.length > MAX_SUBJECT_LENGTH || !URL.canParse(value)) {
    return false;
  }
  const url = new URL(value);
  if (url.protocol === "mailto:") {
    return BARE_ADDRESS_RE.test(url.pathname);
  }
  // A WHATWG parser reads `https:example.com` as absolute; Go does not.
  return (
    url.protocol === "https:" &&
    /^https:\/\//iu.test(value) &&
    url.host !== "" &&
    url.username === "" &&
    url.password === ""
  );
};

export const webPushFormFields = {
  revision: "value",
  subject: "value",
} as const;

export const webPushFormSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    revision: revisionFormSchema(t("platform.policy.revision_invalid")),
    subject: z.preprocess(
      (value) => (typeof value === "string" ? value.trim() : ""),
      z
        .string()
        .min(1, t("platform.webpush.form.subject_required"))
        .refine(
          (value) => value === "" || isWebPushSubject(value),
          t("platform.webpush.form.subject_invalid")
        )
    ),
  });
};
