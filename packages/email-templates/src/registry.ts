import { parseLocale } from "@publira/utils/i18n";
import type { Locale } from "@publira/utils/i18n";
import { createElement } from "react";
import type { ReactElement } from "react";
import type { z } from "zod";

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
  locale?: string;
  template: string;
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

  const locale = parseLocale(input.locale);

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
        }),
        locale,
        ok: true,
        preview: sampleEmailPreview(parsed.data, locale),
        subject: sampleEmailSubject(parsed.data, locale),
        template: "sample",
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
        }),
        locale,
        ok: true,
        preview: tenantAdminInvitationPreview(parsed.data, locale),
        subject: tenantAdminInvitationSubject(parsed.data, locale),
        template: "tenant_admin_invitation",
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
