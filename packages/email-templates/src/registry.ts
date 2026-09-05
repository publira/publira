import { parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { isValidTimeZone } from "@publira/utils";
import { createElement } from "react";
import type { ReactElement } from "react";
import type { z } from "zod";

import type { Messages } from "./messages";
import {
  AdminConsoleEmailChangeConfirmationEmail,
  adminConsoleEmailChangeConfirmationDataSchema,
  adminConsoleEmailChangeConfirmationPreview,
  adminConsoleEmailChangeConfirmationSubject,
} from "./templates/admin-console-email-change-confirmation";
import {
  AdminConsoleEmailChangedNoticeEmail,
  adminConsoleEmailChangedNoticeDataSchema,
  adminConsoleEmailChangedNoticePreview,
  adminConsoleEmailChangedNoticeSubject,
} from "./templates/admin-console-email-changed-notice";
import {
  AdminConsolePasswordResetEmail,
  adminConsolePasswordResetDataSchema,
  adminConsolePasswordResetPreview,
  adminConsolePasswordResetSubject,
} from "./templates/admin-console-password-reset";
import {
  PlatformConsoleEmailChangeConfirmationEmail,
  platformConsoleEmailChangeConfirmationDataSchema,
  platformConsoleEmailChangeConfirmationPreview,
  platformConsoleEmailChangeConfirmationSubject,
} from "./templates/platform-console-email-change-confirmation";
import {
  PlatformConsoleEmailChangedNoticeEmail,
  platformConsoleEmailChangedNoticeDataSchema,
  platformConsoleEmailChangedNoticePreview,
  platformConsoleEmailChangedNoticeSubject,
} from "./templates/platform-console-email-changed-notice";
import {
  PlatformConsolePasswordResetEmail,
  platformConsolePasswordResetDataSchema,
  platformConsolePasswordResetPreview,
  platformConsolePasswordResetSubject,
} from "./templates/platform-console-password-reset";
import {
  ReaderEmailChangeConfirmationEmail,
  readerEmailChangeConfirmationDataSchema,
  readerEmailChangeConfirmationPreview,
  readerEmailChangeConfirmationSubject,
} from "./templates/reader-email-change-confirmation";
import {
  ReaderEmailChangedNoticeEmail,
  readerEmailChangedNoticeDataSchema,
  readerEmailChangedNoticePreview,
  readerEmailChangedNoticeSubject,
} from "./templates/reader-email-changed-notice";
import {
  ReaderEmailVerificationEmail,
  readerEmailVerificationDataSchema,
  readerEmailVerificationPreview,
  readerEmailVerificationSubject,
} from "./templates/reader-email-verification";
import {
  ReaderPasswordResetEmail,
  readerPasswordResetDataSchema,
  readerPasswordResetPreview,
  readerPasswordResetSubject,
} from "./templates/reader-password-reset";
import {
  ReaderSignupAttemptNoticeEmail,
  readerSignupAttemptNoticeDataSchema,
  readerSignupAttemptNoticePreview,
  readerSignupAttemptNoticeSubject,
} from "./templates/reader-signup-attempt-notice";
import {
  SampleEmail,
  sampleEmailDataSchema,
  sampleEmailPreview,
  sampleEmailSubject,
} from "./templates/sample";
import {
  TenantAdminInvitationEmail,
  tenantAdminInvitationDataSchema,
  tenantAdminInvitationPreview,
  tenantAdminInvitationSubject,
} from "./templates/tenant-admin-invitation";

export const TEMPLATE_IDS = [
  "sample",
  "tenant_admin_invitation",
  "reader_email_verification",
  "reader_email_change_confirmation",
  "reader_email_changed_notice",
  "reader_password_reset",
  "reader_signup_attempt_notice",
  "admin_console_email_change_confirmation",
  "admin_console_email_changed_notice",
  "admin_console_password_reset",
  "platform_console_email_change_confirmation",
  "platform_console_email_changed_notice",
  "platform_console_password_reset",
] as const;

export type TemplateId = (typeof TEMPLATE_IDS)[number];

const TEMPLATE_ID_SET: ReadonlySet<string> = new Set(TEMPLATE_IDS);

export const isTemplateId = (value: unknown): value is TemplateId =>
  typeof value === "string" && TEMPLATE_ID_SET.has(value);

export interface ResolveEmailInput {
  data: unknown;
  locale: string;
  messages: Messages;
  template: string;
  timeZone: string;
}

export interface ResolveEmailFailure {
  message: string;
  ok: false;
  reason: "invalid_data" | "unknown_template" | "unsupported_locale";
}

export interface ResolveEmailSuccess {
  element: ReactElement;
  locale: Locale;
  ok: true;
  preview: string;
  subject: string;
  template: TemplateId;
  timeZone: string;
}

export type ResolveEmailResult = ResolveEmailFailure | ResolveEmailSuccess;

const firstIssueMessage = (error: z.ZodError): string =>
  error.issues[0]?.message ?? "invalid template data";

interface TemplateContext<TData> {
  data: TData;
  locale: Locale;
  messages: Messages;
  timeZone: string;
}

interface TemplateDefinition<TData> {
  element: (context: TemplateContext<TData>) => ReactElement;
  preview: (data: TData, messages: Messages) => string;
  schema: z.ZodType<TData>;
  subject: (data: TData, messages: Messages) => string;
}

type TemplateResolver = (
  context: TemplateContext<unknown>
) =>
  | ResolveEmailFailure
  | Omit<ResolveEmailSuccess, "locale" | "template" | "timeZone">;

/**
 * Bind one template's schema to the three things a caller gets out of it. The
 * generic is what keeps a template's `data` type flowing into its own subject,
 * preview, and component, so the table below can hold templates whose `data`
 * shapes have nothing in common.
 */
const defineTemplate =
  <TData>(definition: TemplateDefinition<TData>): TemplateResolver =>
  (context) => {
    const parsed = definition.schema.safeParse(context.data);
    if (!parsed.success) {
      return {
        message: firstIssueMessage(parsed.error),
        ok: false,
        reason: "invalid_data",
      };
    }

    const { data } = parsed;

    return {
      element: definition.element({ ...context, data }),
      ok: true,
      preview: definition.preview(data, context.messages),
      subject: definition.subject(data, context.messages),
    };
  };

const TEMPLATES: Record<TemplateId, TemplateResolver> = {
  admin_console_email_change_confirmation: defineTemplate({
    element: ({ data, locale, messages, timeZone }) =>
      createElement(AdminConsoleEmailChangeConfirmationEmail, {
        data,
        locale,
        messages,
        timeZone,
      }),
    preview: adminConsoleEmailChangeConfirmationPreview,
    schema: adminConsoleEmailChangeConfirmationDataSchema,
    subject: adminConsoleEmailChangeConfirmationSubject,
  }),
  admin_console_email_changed_notice: defineTemplate({
    element: ({ data, locale, messages }) =>
      createElement(AdminConsoleEmailChangedNoticeEmail, {
        data,
        locale,
        messages,
      }),
    preview: adminConsoleEmailChangedNoticePreview,
    schema: adminConsoleEmailChangedNoticeDataSchema,
    subject: adminConsoleEmailChangedNoticeSubject,
  }),
  admin_console_password_reset: defineTemplate({
    element: ({ data, locale, messages, timeZone }) =>
      createElement(AdminConsolePasswordResetEmail, {
        data,
        locale,
        messages,
        timeZone,
      }),
    preview: adminConsolePasswordResetPreview,
    schema: adminConsolePasswordResetDataSchema,
    subject: adminConsolePasswordResetSubject,
  }),
  platform_console_email_change_confirmation: defineTemplate({
    element: ({ data, locale, messages, timeZone }) =>
      createElement(PlatformConsoleEmailChangeConfirmationEmail, {
        data,
        locale,
        messages,
        timeZone,
      }),
    preview: platformConsoleEmailChangeConfirmationPreview,
    schema: platformConsoleEmailChangeConfirmationDataSchema,
    subject: platformConsoleEmailChangeConfirmationSubject,
  }),
  platform_console_email_changed_notice: defineTemplate({
    element: ({ data, locale, messages }) =>
      createElement(PlatformConsoleEmailChangedNoticeEmail, {
        data,
        locale,
        messages,
      }),
    preview: platformConsoleEmailChangedNoticePreview,
    schema: platformConsoleEmailChangedNoticeDataSchema,
    subject: platformConsoleEmailChangedNoticeSubject,
  }),
  platform_console_password_reset: defineTemplate({
    element: ({ data, locale, messages, timeZone }) =>
      createElement(PlatformConsolePasswordResetEmail, {
        data,
        locale,
        messages,
        timeZone,
      }),
    preview: platformConsolePasswordResetPreview,
    schema: platformConsolePasswordResetDataSchema,
    subject: platformConsolePasswordResetSubject,
  }),
  reader_email_change_confirmation: defineTemplate({
    element: ({ data, locale, messages, timeZone }) =>
      createElement(ReaderEmailChangeConfirmationEmail, {
        data,
        locale,
        messages,
        timeZone,
      }),
    preview: readerEmailChangeConfirmationPreview,
    schema: readerEmailChangeConfirmationDataSchema,
    subject: readerEmailChangeConfirmationSubject,
  }),
  reader_email_changed_notice: defineTemplate({
    element: ({ data, locale, messages }) =>
      createElement(ReaderEmailChangedNoticeEmail, { data, locale, messages }),
    preview: readerEmailChangedNoticePreview,
    schema: readerEmailChangedNoticeDataSchema,
    subject: readerEmailChangedNoticeSubject,
  }),
  reader_email_verification: defineTemplate({
    element: ({ data, locale, messages, timeZone }) =>
      createElement(ReaderEmailVerificationEmail, {
        data,
        locale,
        messages,
        timeZone,
      }),
    preview: readerEmailVerificationPreview,
    schema: readerEmailVerificationDataSchema,
    subject: readerEmailVerificationSubject,
  }),
  reader_password_reset: defineTemplate({
    element: ({ data, locale, messages, timeZone }) =>
      createElement(ReaderPasswordResetEmail, {
        data,
        locale,
        messages,
        timeZone,
      }),
    preview: readerPasswordResetPreview,
    schema: readerPasswordResetDataSchema,
    subject: readerPasswordResetSubject,
  }),
  reader_signup_attempt_notice: defineTemplate({
    element: ({ data, locale, messages }) =>
      createElement(ReaderSignupAttemptNoticeEmail, {
        data,
        locale,
        messages,
      }),
    preview: readerSignupAttemptNoticePreview,
    schema: readerSignupAttemptNoticeDataSchema,
    subject: readerSignupAttemptNoticeSubject,
  }),
  sample: defineTemplate({
    element: ({ data, locale, messages }) =>
      createElement(SampleEmail, { data, locale, messages }),
    preview: sampleEmailPreview,
    schema: sampleEmailDataSchema,
    subject: sampleEmailSubject,
  }),
  tenant_admin_invitation: defineTemplate({
    element: ({ data, locale, messages, timeZone }) =>
      createElement(TenantAdminInvitationEmail, {
        data,
        locale,
        messages,
        timeZone,
      }),
    preview: tenantAdminInvitationPreview,
    schema: tenantAdminInvitationDataSchema,
    subject: tenantAdminInvitationSubject,
  }),
};

export const resolveEmail = (input: ResolveEmailInput): ResolveEmailResult => {
  if (!isTemplateId(input.template)) {
    return {
      message: `unknown template: ${input.template}`,
      ok: false,
      reason: "unknown_template",
    };
  }

  if (!isValidTimeZone(input.timeZone)) {
    return {
      message: "time_zone must be an IANA time zone",
      ok: false,
      reason: "invalid_data",
    };
  }

  const locale = parseLocale(input.locale);
  if (locale === undefined) {
    return {
      message: `unsupported locale: ${input.locale}`,
      ok: false,
      reason: "unsupported_locale",
    };
  }

  const { messages, template, timeZone } = input;
  const resolved = TEMPLATES[template]({
    data: input.data,
    locale,
    messages,
    timeZone,
  });
  if (!resolved.ok) {
    return resolved;
  }

  return {
    element: resolved.element,
    locale,
    ok: true,
    preview: resolved.preview,
    subject: resolved.subject,
    template,
    timeZone,
  };
};
