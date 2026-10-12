import type { Locale } from "@publira/i18n";
import { z } from "zod";

import { EmailButton } from "../button";
import { EmailLayout } from "../layout";
import { emailMessage } from "../messages";
import type { Messages } from "../messages";
import { EmailBody, EmailFallbackLink, EmailHeading, EmailMeta } from "../text";
import { httpUrlField } from "./fields";

export const platformConsoleOperatorRoleGrantedDataSchema = z.object({
  sign_in_url: httpUrlField("sign_in_url"),
});

export type PlatformConsoleOperatorRoleGrantedData = z.output<
  typeof platformConsoleOperatorRoleGrantedDataSchema
>;

export interface PlatformConsoleOperatorRoleGrantedEmailProps {
  data: PlatformConsoleOperatorRoleGrantedData;
  locale: Locale;
  messages: Messages;
}

export const platformConsoleOperatorRoleGrantedPreview = (
  _data: PlatformConsoleOperatorRoleGrantedData,
  messages: Messages
): string =>
  emailMessage(
    messages,
    "email.platform_console_operator_role_granted.preview"
  );

export const PlatformConsoleOperatorRoleGrantedEmail = ({
  data,
  locale,
  messages,
}: PlatformConsoleOperatorRoleGrantedEmailProps) => (
  <EmailLayout
    brand={emailMessage(messages, "email.layout.brand")}
    locale={locale}
    messages={messages}
    preview={platformConsoleOperatorRoleGrantedPreview(data, messages)}
  >
    <EmailHeading>
      {emailMessage(
        messages,
        "email.platform_console_operator_role_granted.heading"
      )}
    </EmailHeading>
    <EmailBody>
      {emailMessage(
        messages,
        "email.platform_console_operator_role_granted.body"
      )}
    </EmailBody>
    <EmailButton href={data.sign_in_url}>
      {emailMessage(
        messages,
        "email.platform_console_operator_role_granted.action"
      )}
    </EmailButton>
    <EmailMeta>
      {emailMessage(
        messages,
        "email.platform_console_operator_role_granted.password_help"
      )}
    </EmailMeta>
    <EmailMeta>
      {emailMessage(
        messages,
        "email.platform_console_operator_role_granted.ignore"
      )}
    </EmailMeta>
    <EmailFallbackLink href={data.sign_in_url}>
      {emailMessage(
        messages,
        "email.platform_console_operator_role_granted.fallback_link"
      )}
    </EmailFallbackLink>
  </EmailLayout>
);
