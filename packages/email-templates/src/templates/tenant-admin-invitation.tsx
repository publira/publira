import {
  DEFAULT_TIME_ZONE,
  formatDateTime,
  parseInstant,
} from "@publira/utils";
import type { Locale } from "@publira/utils/i18n";
import type { CSSProperties } from "react";
import { Link, Text } from "react-email";
import { z } from "zod";

import { EmailButton } from "../button";
import { emailColors, emailFonts } from "../colors";
import { isHttpUrl } from "../http-url";
import { EmailLayout } from "../layout";
import { emailMessage } from "../messages";
import "../temporal";

const headingStyle: CSSProperties = {
  color: emailColors.foreground,
  fontFamily: emailFonts.serif,
  fontSize: "22px",
  fontWeight: 600,
  lineHeight: "30px",
  margin: "0 0 8px",
};

const introStyle: CSSProperties = {
  color: emailColors.muted,
  fontSize: "13px",
  lineHeight: "20px",
  margin: "0 0 16px",
};

const bodyStyle: CSSProperties = {
  color: emailColors.foreground,
  fontSize: "15px",
  lineHeight: "24px",
  margin: "0 0 24px",
};

const metaStyle: CSSProperties = {
  color: emailColors.muted,
  fontSize: "13px",
  lineHeight: "20px",
  margin: "24px 0 0",
};

const fallbackStyle: CSSProperties = {
  color: emailColors.muted,
  fontSize: "12px",
  lineHeight: "20px",
  margin: "16px 0 0",
  wordBreak: "break-all",
};

const fallbackLinkStyle: CSSProperties = {
  color: emailColors.brand,
};

const isRfc3339Instant = (value: string): boolean =>
  parseInstant(value) !== null;

export const tenantAdminInvitationDataSchema = z.object({
  expires_at: z.string().trim().refine(isRfc3339Instant, {
    error: "expires_at must be an RFC3339 timestamp",
  }),
  invite_url: z
    .string()
    .trim()
    .refine(isHttpUrl, { error: "invite_url must be an http(s) URL" }),
  tenant_name: z.string().trim().min(1).max(255),
});

export type TenantAdminInvitationData = z.output<
  typeof tenantAdminInvitationDataSchema
>;

export interface TenantAdminInvitationEmailProps {
  data: TenantAdminInvitationData;
  locale?: Locale | string;
}

export const tenantAdminInvitationSubject = (
  data: TenantAdminInvitationData,
  locale?: Locale | string
): string =>
  emailMessage(locale ?? "", "tenant_admin_invitation.subject", {
    tenant_name: data.tenant_name,
  });

export const tenantAdminInvitationPreview = (
  _data: TenantAdminInvitationData,
  locale?: Locale | string
): string => emailMessage(locale ?? "", "tenant_admin_invitation.preview");

const formatExpiry = (expiresAt: string, locale?: Locale | string): string =>
  // Invitation payload has no tenant zone (#285). Asia/Tokyo stands in, same
  // as DEFAULT_TIME_ZONE when a tenant read is unavailable.
  formatDateTime(expiresAt, { locale, timeZone: DEFAULT_TIME_ZONE });

export const TenantAdminInvitationEmail = ({
  data,
  locale,
}: TenantAdminInvitationEmailProps) => (
  <EmailLayout
    locale={locale}
    preview={tenantAdminInvitationPreview(data, locale)}
  >
    <Text style={headingStyle}>
      {emailMessage(locale ?? "", "tenant_admin_invitation.heading")}
    </Text>
    <Text style={introStyle}>
      {emailMessage(locale ?? "", "tenant_admin_invitation.intro")}
    </Text>
    <Text style={bodyStyle}>
      {emailMessage(locale ?? "", "tenant_admin_invitation.body", {
        tenant_name: data.tenant_name,
      })}
    </Text>
    <EmailButton href={data.invite_url}>
      {emailMessage(locale ?? "", "tenant_admin_invitation.action")}
    </EmailButton>
    <Text style={metaStyle}>
      {emailMessage(locale ?? "", "tenant_admin_invitation.expires", {
        expires_at: formatExpiry(data.expires_at, locale),
      })}
    </Text>
    <Text style={metaStyle}>
      {emailMessage(locale ?? "", "tenant_admin_invitation.ignore")}
    </Text>
    <Text style={fallbackStyle}>
      {emailMessage(locale ?? "", "tenant_admin_invitation.fallback_link")}{" "}
      <Link href={data.invite_url} style={fallbackLinkStyle}>
        {data.invite_url}
      </Link>
    </Text>
  </EmailLayout>
);
