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
} from "./templates/admin-console-email-change-confirmation";
import {
  AdminConsoleEmailChangedNoticeEmail,
  adminConsoleEmailChangedNoticeDataSchema,
  adminConsoleEmailChangedNoticePreview,
} from "./templates/admin-console-email-changed-notice";
import {
  AdminConsolePasswordResetEmail,
  adminConsolePasswordResetDataSchema,
  adminConsolePasswordResetPreview,
} from "./templates/admin-console-password-reset";
import {
  PlatformConsoleEmailChangeConfirmationEmail,
  platformConsoleEmailChangeConfirmationDataSchema,
  platformConsoleEmailChangeConfirmationPreview,
} from "./templates/platform-console-email-change-confirmation";
import {
  PlatformConsoleEmailChangedNoticeEmail,
  platformConsoleEmailChangedNoticeDataSchema,
  platformConsoleEmailChangedNoticePreview,
} from "./templates/platform-console-email-changed-notice";
import {
  PlatformConsolePasswordResetEmail,
  platformConsolePasswordResetDataSchema,
  platformConsolePasswordResetPreview,
} from "./templates/platform-console-password-reset";
import {
  ReaderEmailChangeConfirmationEmail,
  readerEmailChangeConfirmationDataSchema,
  readerEmailChangeConfirmationPreview,
} from "./templates/reader-email-change-confirmation";
import {
  ReaderEmailChangedNoticeEmail,
  readerEmailChangedNoticeDataSchema,
  readerEmailChangedNoticePreview,
} from "./templates/reader-email-changed-notice";
import {
  ReaderEmailVerificationEmail,
  readerEmailVerificationDataSchema,
  readerEmailVerificationPreview,
} from "./templates/reader-email-verification";
import {
  ReaderPasswordChangedNoticeEmail,
  readerPasswordChangedNoticeDataSchema,
  readerPasswordChangedNoticePreview,
} from "./templates/reader-password-changed-notice";
import {
  ReaderPasswordResetEmail,
  readerPasswordResetDataSchema,
  readerPasswordResetPreview,
} from "./templates/reader-password-reset";
import {
  ReaderSignupAttemptNoticeEmail,
  readerSignupAttemptNoticeDataSchema,
  readerSignupAttemptNoticePreview,
} from "./templates/reader-signup-attempt-notice";
import {
  SampleEmail,
  sampleEmailDataSchema,
  sampleEmailPreview,
} from "./templates/sample";
import {
  TenantAdminInvitationEmail,
  tenantAdminInvitationDataSchema,
  tenantAdminInvitationPreview,
} from "./templates/tenant-admin-invitation";

export const TEMPLATE_IDS = [
  "sample",
  "tenant_admin_invitation",
  "reader_email_verification",
  "reader_email_change_confirmation",
  "reader_email_changed_notice",
  "reader_password_reset",
  "reader_password_changed_notice",
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
}

type TemplateResolver = (
  context: TemplateContext<unknown>
) =>
  | ResolveEmailFailure
  | Omit<ResolveEmailSuccess, "locale" | "template" | "timeZone">;

/**
 * Bind one template's schema to what a caller gets out of it. The generic is
 * what keeps a template's `data` type flowing into its own preview and
 * component, so the table below can hold templates whose `data` shapes have
 * nothing in common.
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
  }),
  reader_email_changed_notice: defineTemplate({
    element: ({ data, locale, messages }) =>
      createElement(ReaderEmailChangedNoticeEmail, { data, locale, messages }),
    preview: readerEmailChangedNoticePreview,
    schema: readerEmailChangedNoticeDataSchema,
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
  }),
  reader_password_changed_notice: defineTemplate({
    element: ({ data, locale, messages }) =>
      createElement(ReaderPasswordChangedNoticeEmail, {
        data,
        locale,
        messages,
      }),
    preview: readerPasswordChangedNoticePreview,
    schema: readerPasswordChangedNoticeDataSchema,
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
  }),
  sample: defineTemplate({
    element: ({ data, locale, messages }) =>
      createElement(SampleEmail, { data, locale, messages }),
    preview: sampleEmailPreview,
    schema: sampleEmailDataSchema,
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
    template,
    timeZone,
  };
};
