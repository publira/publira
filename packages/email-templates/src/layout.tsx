import type { Locale } from "@publira/i18n";
import type { CSSProperties, ReactNode } from "react";
import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Text,
} from "react-email";

import { emailColors, emailFonts } from "./colors";
import { emailMessage } from "./messages";
import type { Messages } from "./messages";

const bodyStyle: CSSProperties = {
  backgroundColor: emailColors.background,
  fontFamily: emailFonts.sans,
  margin: 0,
  padding: "32px 16px",
};

const containerStyle: CSSProperties = {
  margin: "0 auto",
  maxWidth: "560px",
  width: "100%",
};

const brandStyle: CSSProperties = {
  color: emailColors.brand,
  fontFamily: emailFonts.serif,
  fontSize: "22px",
  fontWeight: 600,
  letterSpacing: "0.04em",
  margin: "0 0 20px",
};

const cardStyle: CSSProperties = {
  backgroundColor: emailColors.card,
  border: `1px solid ${emailColors.border}`,
  borderRadius: "8px",
  padding: "28px 24px",
};

const footerStyle: CSSProperties = {
  color: emailColors.muted,
  fontSize: "12px",
  lineHeight: "20px",
  margin: "20px 0 0",
};

export interface EmailLayoutProps {
  /**
   * Who the mail is from, as the recipient knows them. A reader signed up on a
   * tenant's site and never met the platform, so a tenant's mail is branded
   * with the tenant name; only mail to a platform operator names Publira.
   */
  brand: string;
  children: ReactNode;
  locale: Locale;
  messages: Messages;
  preview: string;
}

export const EmailLayout = ({
  brand,
  children,
  locale,
  messages,
  preview,
}: EmailLayoutProps) => (
  <Html dir="ltr" lang={locale}>
    <Head />
    <Preview>{preview}</Preview>
    <Body lang={locale} style={bodyStyle}>
      <Container style={containerStyle}>
        <Text style={brandStyle}>{brand}</Text>
        <Section style={cardStyle}>{children}</Section>
        <Text style={footerStyle}>
          {emailMessage(messages, "email.layout.footer", { brand })}
        </Text>
      </Container>
    </Body>
  </Html>
);
