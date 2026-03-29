export const SECRET_UPDATE_MODE_UNCHANGED = 1;
export const SECRET_UPDATE_MODE_REPLACE = 2;
export const TEST_EMAIL_RECIPIENT_TYPE_SELF = 1;
export const TEST_EMAIL_RECIPIENT_TYPE_CUSTOM = 2;

export interface PlatformSmtpSettings {
  encryption: string;
  fromAddress: string;
  hasPassword: boolean;
  host: string;
  port: number;
  replyTo: string;
  username: string;
}
