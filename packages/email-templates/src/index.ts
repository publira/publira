import "./temporal";

export { EmailButton } from "./button";
export type { EmailButtonProps } from "./button";
export { EmailLayout } from "./layout";
export type { EmailLayoutProps } from "./layout";
export { isTemplateId, resolveEmail, TEMPLATE_IDS } from "./registry";
export type {
  ResolveEmailFailure,
  ResolveEmailInput,
  ResolveEmailResult,
  ResolveEmailSuccess,
  TemplateId,
} from "./registry";
export { renderEmail } from "./render";
export type { RenderEmailResult, RenderEmailSuccess } from "./render";
export {
  SampleEmail,
  sampleEmailDataSchema,
  sampleEmailPreview,
  sampleEmailSubject,
} from "./templates/sample";
export type { SampleEmailData, SampleEmailProps } from "./templates/sample";
export {
  TenantAdminInvitationEmail,
  tenantAdminInvitationDataSchema,
  tenantAdminInvitationPreview,
  tenantAdminInvitationSubject,
} from "./templates/tenant-admin-invitation";
export type {
  TenantAdminInvitationData,
  TenantAdminInvitationEmailProps,
} from "./templates/tenant-admin-invitation";
