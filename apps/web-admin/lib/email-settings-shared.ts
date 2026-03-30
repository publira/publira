export const SECRET_UPDATE_MODE_UNCHANGED = 1;
export const SECRET_UPDATE_MODE_REPLACE = 2;

export const TEST_EMAIL_RECIPIENT_TYPE_SELF = 1;
export const TEST_EMAIL_RECIPIENT_TYPE_CUSTOM = 2;

export interface TenantSmtpSettings {
  smtpOverrideEnabled: boolean;
  host: string;
  port: number;
  username: string;
  encryption: string;
  fromName: string;
  fromAddress: string;
  replyTo: string;
  hasPassword: boolean;
}
