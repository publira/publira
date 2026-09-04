import type { Locale } from "@publira/i18n";
import type { CSSProperties } from "react";
import { Text } from "react-email";
import { z } from "zod";

import { EmailButton } from "../button";
import { emailColors, emailFonts } from "../colors";
import { isHttpUrl } from "../http-url";
import { EmailLayout } from "../layout";
import { emailMessage } from "../messages";
import type { Messages } from "../messages";
import { hasNoLineBreaks } from "../single-line";

const headingStyle: CSSProperties = {
  color: emailColors.foreground,
  fontFamily: emailFonts.serif,
  fontSize: "22px",
  fontWeight: 600,
  lineHeight: "30px",
  margin: "0 0 16px",
};

const bodyStyle: CSSProperties = {
  color: emailColors.foreground,
  fontSize: "15px",
  lineHeight: "24px",
  margin: "0 0 24px",
};

export const sampleEmailDataSchema = z.object({
  action_label: z.string().trim().min(1).max(100),
  action_url: z
    .string()
    .trim()
    .refine(isHttpUrl, { error: "action_url must be an http(s) URL" }),
  body: z.string().trim().min(1).max(2000),
  title: z.string().trim().min(1).max(200).refine(hasNoLineBreaks, {
    error: "title must not contain CR or LF",
  }),
});

export type SampleEmailData = z.output<typeof sampleEmailDataSchema>;

export interface SampleEmailProps {
  data: SampleEmailData;
  locale: Locale;
  messages: Messages;
}

export const sampleEmailSubject = (
  data: SampleEmailData,
  messages: Messages
): string =>
  emailMessage(messages, "email.sample.subject", { title: data.title });

export const sampleEmailPreview = (
  data: SampleEmailData,
  messages: Messages
): string =>
  emailMessage(messages, "email.sample.preview", { body: data.body });

export const SampleEmail = ({ data, locale, messages }: SampleEmailProps) => (
  <EmailLayout
    brand={emailMessage(messages, "email.layout.brand")}
    locale={locale}
    messages={messages}
    preview={sampleEmailPreview(data, messages)}
  >
    <Text style={headingStyle}>{data.title}</Text>
    <Text style={bodyStyle}>{data.body}</Text>
    <EmailButton href={data.action_url}>{data.action_label}</EmailButton>
  </EmailLayout>
);
