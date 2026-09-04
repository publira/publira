import "./temporal";

export { EmailButton } from "./button";
export type { EmailButtonProps } from "./button";
export { EmailLayout } from "./layout";
export type { EmailLayoutProps } from "./layout";
export { emailMessage, loadEmailMessages } from "./messages";
export type { EmailMessageKey, Messages } from "./messages";
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
  EmailBody,
  EmailDetail,
  EmailFallbackLink,
  EmailHeading,
  EmailIntro,
  EmailMeta,
} from "./text";
export type { EmailFallbackLinkProps, EmailTextProps } from "./text";
