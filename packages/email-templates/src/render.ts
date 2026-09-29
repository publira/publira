import type { Locale } from "@publira/i18n";
import { render } from "react-email";

import { resolveEmail } from "./registry";
import type {
  ResolveEmailFailure,
  ResolveEmailInput,
  TemplateId,
} from "./registry";

export interface RenderEmailSuccess {
  html: string;
  locale: Locale;
  ok: true;
  template: TemplateId;
  timeZone: string;
}

export type RenderEmailResult = RenderEmailSuccess | ResolveEmailFailure;

/**
 * The HTML part of one mail. Its subject line and its plain-text alternative
 * are composed from the same catalogs by the server that sends it, which is
 * what keeps a mail sendable without this package.
 */
export const renderEmail = async (
  input: ResolveEmailInput
): Promise<RenderEmailResult> => {
  const resolved = resolveEmail(input);
  if (!resolved.ok) {
    return resolved;
  }

  return {
    html: await render(resolved.element),
    locale: resolved.locale,
    ok: true,
    template: resolved.template,
    timeZone: resolved.timeZone,
  };
};
