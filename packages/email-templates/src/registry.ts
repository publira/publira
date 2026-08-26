import { parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { isValidTimeZone } from "@publira/utils";
import { createElement } from "react";
import type { ReactElement } from "react";
import type { z } from "zod";

import type { Messages } from "./messages";
import {
  SampleEmail,
  sampleEmailDataSchema,
  sampleEmailPreview,
  sampleEmailSubject,
} from "./templates/sample";
import type { SampleEmailData } from "./templates/sample";
import {
  TenantAdminInvitationEmail,
  tenantAdminInvitationDataSchema,
  tenantAdminInvitationPreview,
  tenantAdminInvitationSubject,
} from "./templates/tenant-admin-invitation";
import type { TenantAdminInvitationData } from "./templates/tenant-admin-invitation";

export const TEMPLATE_IDS = ["sample", "tenant_admin_invitation"] as const;

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
  reason: "invalid_data" | "unknown_template";
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

const parseData = <T>(
  schema: z.ZodType<T>,
  data: unknown
): { data: T; ok: true } | ResolveEmailFailure => {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    return {
      message: firstIssueMessage(parsed.error),
      ok: false,
      reason: "invalid_data",
    };
  }

  return { data: parsed.data, ok: true };
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
  const { messages, timeZone } = input;

  switch (input.template) {
    case "sample": {
      const parsed = parseData<SampleEmailData>(
        sampleEmailDataSchema,
        input.data
      );
      if (!parsed.ok) {
        return parsed;
      }

      return {
        element: createElement(SampleEmail, {
          data: parsed.data,
          locale,
          messages,
        }),
        locale,
        ok: true,
        preview: sampleEmailPreview(parsed.data, messages),
        subject: sampleEmailSubject(parsed.data, messages),
        template: "sample",
        timeZone,
      };
    }
    case "tenant_admin_invitation": {
      const parsed = parseData<TenantAdminInvitationData>(
        tenantAdminInvitationDataSchema,
        input.data
      );
      if (!parsed.ok) {
        return parsed;
      }

      return {
        element: createElement(TenantAdminInvitationEmail, {
          data: parsed.data,
          locale,
          messages,
          timeZone,
        }),
        locale,
        ok: true,
        preview: tenantAdminInvitationPreview(parsed.data, messages),
        subject: tenantAdminInvitationSubject(parsed.data, messages),
        template: "tenant_admin_invitation",
        timeZone,
      };
    }
    default: {
      return {
        message: `unknown template: ${input.template}`,
        ok: false,
        reason: "unknown_template",
      };
    }
  }
};
