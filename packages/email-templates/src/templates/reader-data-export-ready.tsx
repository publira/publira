import type { Locale } from "@publira/i18n";
import { formatDateTime } from "@publira/utils";
import type { JSX } from "react";
import { z } from "zod";

import { EmailButton } from "../button";
import { EmailLayout } from "../layout";
import { emailMessage } from "../messages";
import type { Messages } from "../messages";
import {
  EmailBody,
  EmailDetail,
  EmailFallbackLink,
  EmailHeading,
} from "../text";
import { displayNameField, httpUrlField, instantField } from "./fields";

export const readerDataExportReadyDataSchema: z.ZodObject<
  {
    expires_at: z.ZodString;
    settings_url: z.ZodString;
    tenant_name: z.ZodString;
  },
  z.core.$strip
> = z.object({
  /** When the archive is deleted. */
  expires_at: instantField("expires_at"),
  /** The storefront's account settings, where the archive is downloaded. */
  settings_url: httpUrlField("settings_url"),
  tenant_name: displayNameField("tenant_name"),
});

export type ReaderDataExportReadyData = z.output<
  typeof readerDataExportReadyDataSchema
>;

export interface ReaderDataExportReadyEmailProps {
  data: ReaderDataExportReadyData;
  locale: Locale;
  messages: Messages;
  timeZone: string;
}

export const readerDataExportReadyPreview = (
  _data: ReaderDataExportReadyData,
  messages: Messages
): string => emailMessage(messages, "email.reader_data_export_ready.preview");

/**
 * The mail that tells a reader the archive of their data they asked for is
 * ready, and until when they can download it. It links no notification
 * settings: the reader asked for it, and none of them could have kept it out.
 */
export const ReaderDataExportReadyEmail = ({
  data,
  locale,
  messages,
  timeZone,
}: ReaderDataExportReadyEmailProps): JSX.Element => (
  <EmailLayout
    brand={data.tenant_name}
    locale={locale}
    messages={messages}
    preview={readerDataExportReadyPreview(data, messages)}
  >
    <EmailHeading>
      {emailMessage(messages, "email.reader_data_export_ready.heading")}
    </EmailHeading>
    <EmailBody>
      {emailMessage(messages, "email.reader_data_export_ready.body", {
        tenant_name: data.tenant_name,
      })}
    </EmailBody>
    <EmailDetail>
      {emailMessage(messages, "email.reader_data_export_ready.expires_at", {
        expires_at: formatDateTime(data.expires_at, { locale, timeZone }),
      })}
    </EmailDetail>
    <EmailButton href={data.settings_url}>
      {emailMessage(messages, "email.reader_data_export_ready.action")}
    </EmailButton>
    <EmailFallbackLink href={data.settings_url}>
      {emailMessage(messages, "email.reader_data_export_ready.fallback_link")}
    </EmailFallbackLink>
  </EmailLayout>
);
