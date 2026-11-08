import type { Locale } from "@publira/i18n";
import { formatDateTime } from "@publira/utils";
import type { JSX } from "react";
import { z } from "zod";

import { EmailButton } from "../button";
import { EmailLayout } from "../layout";
import { emailMessage } from "../messages";
import "../temporal";
import type { Messages } from "../messages";
import {
  EmailBody,
  EmailFallbackLink,
  EmailHeading,
  EmailIntro,
  EmailMeta,
} from "../text";
import {
  displayNameField,
  httpUrlField,
  instantField,
  tenantRoleField,
} from "./fields";

export const tenantAdminInvitationDataSchema: z.ZodObject<
  {
    expires_at: z.ZodString;
    invite_url: z.ZodString;
    role: z.ZodEnum<{
      tenant_admin: "tenant_admin";
      tenant_auditor: "tenant_auditor";
      tenant_editor: "tenant_editor";
    }>;
    tenant_name: z.ZodString;
  },
  z.core.$strip
> = z.object({
  expires_at: instantField("expires_at"),
  invite_url: httpUrlField("invite_url"),
  role: tenantRoleField(),
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

export const tenantAdminInvitationPreview = (
  data: TenantAdminInvitationData,
  messages: Messages
): string =>
  emailMessage(messages, "email.tenant_admin_invitation.preview", {
    tenant_name: data.tenant_name,
  });

export const TenantAdminInvitationEmail = ({
  data,
  locale,
  messages,
  timeZone,
}: TenantAdminInvitationEmailProps): JSX.Element => (
  <EmailLayout
    brand={data.tenant_name}
    locale={locale}
    messages={messages}
    preview={tenantAdminInvitationPreview(data, messages)}
  >
    <EmailHeading>
      {emailMessage(messages, "email.tenant_admin_invitation.heading", {
        role: data.role,
      })}
    </EmailHeading>
    <EmailIntro>
      {emailMessage(messages, "email.tenant_admin_invitation.intro", {
        tenant_name: data.tenant_name,
      })}
    </EmailIntro>
    <EmailBody>
      {emailMessage(messages, "email.tenant_admin_invitation.body", {
        role: data.role,
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
