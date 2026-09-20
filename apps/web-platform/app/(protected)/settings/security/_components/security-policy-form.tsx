import type { PlatformSecurityPolicy } from "#lib/platform-policy";

import { PolicyForm } from "../../_components/policy-form";
import { updatePlatformSecurityPolicyAction } from "../../_lib/policy-actions";

export const SecurityPolicyForm = ({
  values,
  revision,
  loadErrorMessage,
}: {
  values: PlatformSecurityPolicy;
  revision: string;
  loadErrorMessage?: string;
}) => (
  <PolicyForm
    action={updatePlatformSecurityPolicyAction}
    checkbox={{
      defaultChecked: values.mfaRequiredForTenantAdmin,
      label: "platform.policy.security.mfa_required",
      name: "mfa_required_for_tenant_admin",
    }}
    description="platform.policy.security.description"
    fields={[
      {
        defaultValue: values.passwordVerification.perMinute,
        label: "platform.policy.security.password_per_minute",
        name: "password_verification_per_minute",
      },
      {
        defaultValue: values.passwordVerification.perDay,
        label: "platform.policy.security.password_per_day",
        name: "password_verification_per_day",
      },
      {
        defaultValue: values.mailRequestsPerAddress.perHour,
        label: "platform.policy.security.mail_address_per_hour",
        name: "mail_requests_per_address_per_hour",
      },
      {
        defaultValue: values.mailRequestsPerAddress.perDay,
        label: "platform.policy.security.mail_address_per_day",
        name: "mail_requests_per_address_per_day",
      },
      {
        defaultValue: values.mailRequestsPerSource.perHour,
        label: "platform.policy.security.mail_source_per_hour",
        name: "mail_requests_per_source_per_hour",
      },
      {
        defaultValue: values.mailRequestsPerSource.perDay,
        label: "platform.policy.security.mail_source_per_day",
        name: "mail_requests_per_source_per_day",
      },
    ]}
    loadErrorMessage={loadErrorMessage}
    revision={revision}
    submit="platform.policy.security.save"
    title="platform.policy.security.title"
  />
);
