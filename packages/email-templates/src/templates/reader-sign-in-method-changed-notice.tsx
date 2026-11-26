import type { Locale } from "@publira/i18n";
import type { JSX } from "react";
import { z } from "zod";

import { EmailButton } from "../button";
import { EmailLayout } from "../layout";
import { emailMessage } from "../messages";
import type { EmailMessageKey, Messages } from "../messages";
import {
  EmailBody,
  EmailDetail,
  EmailFallbackLink,
  EmailHeading,
  EmailMeta,
} from "../text";
import {
  displayNameField,
  emailAddressField,
  httpUrlField,
  optionalSingleLineField,
} from "./fields";

export const readerSignInMethodChangedNoticeDataSchema: z.ZodObject<
  {
    change: z.ZodEnum<{
      identity_unlinked: "identity_unlinked";
      passkey_added: "passkey_added";
      passkey_removed: "passkey_removed";
    }>;
    email: z.ZodString;
    provider_name: z.ZodString;
    settings_url: z.ZodString;
    tenant_name: z.ZodString;
  },
  z.core.$strip
> = z.object({
  change: z.enum(["passkey_added", "passkey_removed", "identity_unlinked"]),
  email: emailAddressField("email"),
  // The provider's own name for identity_unlinked, and empty for a passkey.
  provider_name: optionalSingleLineField("provider_name", 32),
  settings_url: httpUrlField("settings_url"),
  tenant_name: displayNameField("tenant_name"),
});

export type ReaderSignInMethodChangedNoticeData = z.output<
  typeof readerSignInMethodChangedNoticeDataSchema
>;

export interface ReaderSignInMethodChangedNoticeEmailProps {
  data: ReaderSignInMethodChangedNoticeData;
  locale: Locale;
  messages: Messages;
}

const changeKeys = {
  identity_unlinked: {
    body: "email.reader_sign_in_method_changed_notice.identity_unlinked.body",
    heading:
      "email.reader_sign_in_method_changed_notice.identity_unlinked.heading",
    preview:
      "email.reader_sign_in_method_changed_notice.identity_unlinked.preview",
  },
  passkey_added: {
    body: "email.reader_sign_in_method_changed_notice.passkey_added.body",
    heading: "email.reader_sign_in_method_changed_notice.passkey_added.heading",
    preview: "email.reader_sign_in_method_changed_notice.passkey_added.preview",
  },
  passkey_removed: {
    body: "email.reader_sign_in_method_changed_notice.passkey_removed.body",
    heading:
      "email.reader_sign_in_method_changed_notice.passkey_removed.heading",
    preview:
      "email.reader_sign_in_method_changed_notice.passkey_removed.preview",
  },
} as const satisfies Record<
  ReaderSignInMethodChangedNoticeData["change"],
  Record<"body" | "heading" | "preview", EmailMessageKey>
>;

export const readerSignInMethodChangedNoticePreview = (
  data: ReaderSignInMethodChangedNoticeData,
  messages: Messages
): string =>
  emailMessage(messages, changeKeys[data.change].preview, {
    provider_name: data.provider_name,
  });

export const ReaderSignInMethodChangedNoticeEmail = ({
  data,
  locale,
  messages,
}: ReaderSignInMethodChangedNoticeEmailProps): JSX.Element => {
  const keys = changeKeys[data.change];
  const provider = { provider_name: data.provider_name };

  return (
    <EmailLayout
      brand={data.tenant_name}
      locale={locale}
      messages={messages}
      preview={readerSignInMethodChangedNoticePreview(data, messages)}
    >
      <EmailHeading>
        {emailMessage(messages, keys.heading, provider)}
      </EmailHeading>
      <EmailBody>{emailMessage(messages, keys.body, provider)}</EmailBody>
      <EmailDetail>
        {emailMessage(
          messages,
          "email.reader_sign_in_method_changed_notice.email",
          { email: data.email }
        )}
      </EmailDetail>
      <EmailMeta>
        {emailMessage(
          messages,
          "email.reader_sign_in_method_changed_notice.warning"
        )}
      </EmailMeta>
      <EmailButton href={data.settings_url}>
        {emailMessage(
          messages,
          "email.reader_sign_in_method_changed_notice.action"
        )}
      </EmailButton>
      <EmailFallbackLink href={data.settings_url}>
        {emailMessage(
          messages,
          "email.reader_sign_in_method_changed_notice.fallback_link"
        )}
      </EmailFallbackLink>
    </EmailLayout>
  );
};
