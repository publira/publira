import type { Locale } from "@publira/i18n";
import { render, toPlainText } from "react-email";

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
  subject: string;
  template: TemplateId;
  text: string;
  timeZone: string;
}

export type RenderEmailResult = RenderEmailSuccess | ResolveEmailFailure;

export const renderEmail = async (
  input: ResolveEmailInput
): Promise<RenderEmailResult> => {
  const resolved = resolveEmail(input);
  if (!resolved.ok) {
    return resolved;
  }

  const html = await render(resolved.element);

  return {
    html,
    locale: resolved.locale,
    ok: true,
    subject: resolved.subject,
    template: resolved.template,
    text: toPlainText(html),
    timeZone: resolved.timeZone,
  };
};
