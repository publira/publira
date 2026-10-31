/**
 * How the settings card reads a search engine verification code. The Go server
 * stores the bare `content` value of the service's `<meta>` tag
 * (`server/internal/siteverification`) and refuses anything else, the whole
 * element included, while each service tells the publisher to copy the whole
 * element. So the card takes either, and sends the `content` value alone: the
 * field is checked once the operator leaves it, and the Server Action reads it
 * again before it is sent. The server stays the authority.
 *
 * Kept apart from `tenant-site-verification.ts` because the settings card is a
 * Client Component: importing from the module that reads the session would
 * pull `next/headers` into the browser graph.
 */

import type { AdminClientMessageAccessor } from "./messages";

/** The `name` of each service's `<meta>` tag. */
export const SITE_VERIFICATION_META_NAMES = {
  bing: "msvalidate.01",
  google: "google-site-verification",
} as const;

export type SiteVerificationService = keyof typeof SITE_VERIFICATION_META_NAMES;

/** `siteverification.codePattern`, which the columns' CHECK holds as well. */
const CODE = /^[\w-]{1,128}$/u;

/** A whole `<meta>` element, which is what each service shows. */
const META_ELEMENT = /^<meta\s[^<>]*>$/iu;

/** A token of the element: a name or a bare value, `=`, or a quoted value. */
const TOKEN = /[^\s"'=>]+|=|"[^"]*"|'[^']*'/gu;

const unquote = (value: string): string =>
  /^(?:"[^"]*"|'[^']*')$/u.test(value) ? value.slice(1, -1) : value;

/**
 * The element's attributes that have a value, by lowercased name. The first of
 * a repeated name wins, as it does for a browser. One without a value names
 * neither the service nor the code, so it is passed over.
 */
const metaAttributes = (element: string): Map<string, string> => {
  const inner = element.slice("<meta".length, element.endsWith("/>") ? -2 : -1);
  const tokens = Array.from(inner.matchAll(TOKEN), ([token]) => token);
  const attributes = new Map<string, string>();

  for (let index = 0; index + 2 < tokens.length; index += 1) {
    const [name = "", equals, value = ""] = tokens.slice(index, index + 3);

    if (equals !== "=" || name === "=") {
      continue;
    }

    const key = name.toLowerCase();

    if (!attributes.has(key)) {
      attributes.set(key, unquote(value));
    }

    index += 2;
  }

  return attributes;
};

/** Why a value cannot be saved as a code. */
export type SiteVerificationCodeRefusal = "invalid" | "other_service";

export type SiteVerificationCodeResult =
  | {
      ok: true;
      /** The code to send, empty to clear it. */
      code: string;
    }
  | { ok: false; reason: SiteVerificationCodeRefusal };

/**
 * The code a field's value holds for `service`: the value itself when it is a
 * bare code, the `content` value when it is the service's `<meta>` element,
 * and empty when it is blank. An element naming another service is refused
 * rather than read, since its code proves nothing to this one.
 */
export const parseSiteVerificationCode = (
  service: SiteVerificationService,
  value: string
): SiteVerificationCodeResult => {
  const trimmed = value.trim();

  if (trimmed === "") {
    return { code: "", ok: true };
  }

  if (!META_ELEMENT.test(trimmed)) {
    return CODE.test(trimmed)
      ? { code: trimmed, ok: true }
      : { ok: false, reason: "invalid" };
  }

  const attributes = metaAttributes(trimmed);
  const name = attributes.get("name")?.trim().toLowerCase();

  if (name !== undefined && name !== SITE_VERIFICATION_META_NAMES[service]) {
    return { ok: false, reason: "other_service" };
  }

  const content = attributes.get("content")?.trim() ?? "";

  return CODE.test(content)
    ? { code: content, ok: true }
    : { ok: false, reason: "invalid" };
};

/** What the card and the Action say about a value that is not a code. */
export const siteVerificationCodeMessage = (
  t: AdminClientMessageAccessor,
  service: SiteVerificationService,
  reason: SiteVerificationCodeRefusal
): string =>
  reason === "other_service"
    ? t("admin.settings.site_verification.validation.other_service", {
        name: SITE_VERIFICATION_META_NAMES[service],
      })
    : t("admin.settings.site_verification.validation.invalid");
