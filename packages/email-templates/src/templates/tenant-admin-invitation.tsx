import type { Locale } from "@publira/i18n";
import { formatDateTime } from "@publira/utils";
import { z } from "zod";

import { EmailButton } from "../button";
import { EmailLayout } from "../layout";
import { emailMessage } from "../messages";
import type { Messages } from "../messages";
import "../temporal";
import {
  EmailBody,
  EmailFallbackLink,
  EmailHeading,
  EmailIntro,
  EmailMeta,
} from "../text";
import { displayNameField, httpUrlField, instantField } from "./fields";

export const tenantAdminInvitationDataSchema = z.object({
  expires_at: instantField("expires_at"),
  invite_url: httpUrlField("invite_url"),
  tenant_name: displayNameField("tenant_name"),
});

export type TenantAdminInvitationData = z.output<
  typeof tenantAdminInvitationDataSchema
>;

export interface TenantAdminInvitationEmailProps {
  data: TenantAdminInvitationData;
  locale: Locale;
  messages: Messages;
  timeZone: string;
}

export const tenantAdminInvitationSubject = (
  data: TenantAdminInvitationData,
  messages: Messages
): string =>
  emailMessage(messages, "email.tenant_admin_invitation.subject", {
    tenant_name: data.tenant_name,
  });

export const tenantAdminInvitationPreview = (
  _data: TenantAdminInvitationData,
  messages: Messages
): string => emailMessage(messages, "email.tenant_admin_invitation.preview");

export const TenantAdminInvitationEmail = ({
  data,
  locale,
  messages,
  timeZone,
}: TenantAdminInvitationEmailProps) => (
  <EmailLayout
    locale={locale}
    messages={messages}
    preview={tenantAdminInvitationPreview(data, messages)}
  >
    <EmailHeading>
      {emailMessage(messages, "email.tenant_admin_invitation.heading")}
    </EmailHeading>
    <EmailIntro>
      {emailMessage(messages, "email.tenant_admin_invitation.intro")}
    </EmailIntro>
    <EmailBody>
      {emailMessage(messages, "email.tenant_admin_invitation.body", {
        tenant_name: data.tenant_name,
      })}
    </EmailBody>
    <EmailButton href={data.invite_url}>
      {emailMessage(messages, "email.tenant_admin_invitation.action")}
    </EmailButton>
    <EmailMeta>
      {emailMessage(messages, "email.tenant_admin_invitation.expires", {
        expires_at: formatDateTime(data.expires_at, { locale, timeZone }),
      })}
    </EmailMeta>
    <EmailMeta>
      {emailMessage(messages, "email.tenant_admin_invitation.ignore")}
    </EmailMeta>
    <EmailFallbackLink href={data.invite_url}>
      {emailMessage(messages, "email.tenant_admin_invitation.fallback_link")}
    </EmailFallbackLink>
  </EmailLayout>
);
