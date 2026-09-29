import { Message } from "#components/message";

/** An action on an operator. */
const operatorActionName = (action: string) => {
  switch (action) {
    case "operator_created": {
      return <Message message="platform.audit.actions.operator_created" />;
    }
    case "operator_deleted": {
      return <Message message="platform.audit.actions.operator_deleted" />;
    }
    case "operator_resumed": {
      return <Message message="platform.audit.actions.operator_resumed" />;
    }
    case "operator_suspended": {
      return <Message message="platform.audit.actions.operator_suspended" />;
    }
    case "operator_updated": {
      return <Message message="platform.audit.actions.operator_updated" />;
    }
    default: {
      return null;
    }
  }
};

/** An action on the platform-wide settings. */
const platformActionName = (action: string) => {
  switch (action) {
    case "platform_email_settings_updated": {
      return (
        <Message message="platform.audit.actions.platform_email_settings_updated" />
      );
    }
    case "platform_policy_updated": {
      return (
        <Message message="platform.audit.actions.platform_policy_updated" />
      );
    }
    case "platform_retention_defaults_updated": {
      return (
        <Message message="platform.audit.actions.platform_retention_defaults_updated" />
      );
    }
    case "platform_settings_updated": {
      return (
        <Message message="platform.audit.actions.platform_settings_updated" />
      );
    }
    case "platform_smtp_test_email_sent": {
      return (
        <Message message="platform.audit.actions.platform_smtp_test_email_sent" />
      );
    }
    case "platform_storage_connection_tested": {
      return (
        <Message message="platform.audit.actions.platform_storage_connection_tested" />
      );
    }
    case "platform_storage_settings_updated": {
      return (
        <Message message="platform.audit.actions.platform_storage_settings_updated" />
      );
    }
    case "platform_webpush_subject_updated": {
      return (
        <Message message="platform.audit.actions.platform_webpush_subject_updated" />
      );
    }
    default: {
      return null;
    }
  }
};

/** An action on a tenant, its members, or its admin invitations. */
const tenantActionName = (action: string) => {
  switch (action) {
    case "tenant_admin_invite_canceled": {
      return (
        <Message message="platform.audit.actions.tenant_admin_invite_canceled" />
      );
    }
    case "tenant_admin_invite_resent": {
      return (
        <Message message="platform.audit.actions.tenant_admin_invite_resent" />
      );
    }
    case "tenant_admin_invited": {
      return <Message message="platform.audit.actions.tenant_admin_invited" />;
    }
    case "tenant_created": {
      return <Message message="platform.audit.actions.tenant_created" />;
    }
    case "tenant_info_updated": {
      return <Message message="platform.audit.actions.tenant_info_updated" />;
    }
    case "tenant_member_added": {
      return <Message message="platform.audit.actions.tenant_member_added" />;
    }
    case "tenant_member_created": {
      return <Message message="platform.audit.actions.tenant_member_created" />;
    }
    case "tenant_member_removed": {
      return <Message message="platform.audit.actions.tenant_member_removed" />;
    }
    case "tenant_member_role_updated": {
      return (
        <Message message="platform.audit.actions.tenant_member_role_updated" />
      );
    }
    case "tenant_resumed": {
      return <Message message="platform.audit.actions.tenant_resumed" />;
    }
    case "tenant_suspended": {
      return <Message message="platform.audit.actions.tenant_suspended" />;
    }
    default: {
      return null;
    }
  }
};

/** An action on a user. */
const userActionName = (action: string) => {
  switch (action) {
    case "user_deleted": {
      return <Message message="platform.audit.actions.user_deleted" />;
    }
    case "user_suspended": {
      return <Message message="platform.audit.actions.user_suspended" />;
    }
    case "user_unsuspended": {
      return <Message message="platform.audit.actions.user_unsuspended" />;
    }
    default: {
      return null;
    }
  }
};

/** An audit action's name, or the action itself when the console has none. */
export const AuditActionName = ({ action }: { action: string }) => {
  const normalized = action.trim();
  if (!normalized) {
    return <Message message="platform.audit.unset" />;
  }

  return (
    operatorActionName(normalized) ??
    platformActionName(normalized) ??
    tenantActionName(normalized) ??
    userActionName(normalized) ??
    normalized
  );
};
