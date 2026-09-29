import { SkeletonLine } from "@publira/ui-components/skeleton";
import { cn } from "@publira/utils";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { PlatformAuditLogSummary } from "#lib/audit-logs";

const linkClassName = cn(
  "text-sm font-medium text-primary underline-offset-4 hover:underline"
);

const buildTargetLabel = (targetType: string, targetId: string): string => {
  if (targetType && targetId) {
    return `${targetType}: ${targetId}`;
  }
  return targetId || targetType || "-";
};

/**
 * The name of a platform-wide setting target. Each is recorded with the fixed
 * target ID `platform`, so the name alone says what the entry touched.
 */
const settingsTargetName = (targetType: string) => {
  switch (targetType) {
    case "platform_config": {
      return <Message message="platform.audit.targets.platform_config" />;
    }
    case "platform_policy": {
      return <Message message="platform.audit.targets.platform_policy" />;
    }
    case "platform_retention": {
      return <Message message="platform.audit.targets.platform_retention" />;
    }
    case "smtp_config": {
      return <Message message="platform.audit.targets.smtp_config" />;
    }
    case "storage_config": {
      return <Message message="platform.audit.targets.storage_config" />;
    }
    case "webpush_config": {
      return <Message message="platform.audit.targets.webpush_config" />;
    }
    default: {
      return null;
    }
  }
};

/**
 * A tenant admin invitation. The API names the invited address as the target
 * name, or leaves it as the target ID when the entry names no invitation row.
 */
const InvitationTarget = ({ log }: { log: PlatformAuditLogSummary }) => (
  <>
    <p>
      <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
        <Message
          message="platform.audit.targets.tenant_admin_invitation"
          values={{ email: log.targetName || log.targetId }}
        />
      </Suspense>
    </p>
    {log.tenantId ? (
      <Link className={linkClassName} href={`/tenants/${log.tenantId}`}>
        {log.tenantName || log.tenantId}
      </Link>
    ) : null}
  </>
);

/** What an audit entry acted on, linked to its page when it has one. */
export const AuditLogTarget = ({ log }: { log: PlatformAuditLogSummary }) => {
  if (log.targetPublicId && log.targetType === "operator") {
    return (
      <Link className={linkClassName} href={`/operators/${log.targetPublicId}`}>
        {log.targetName || log.targetPublicId}
      </Link>
    );
  }

  if (log.targetPublicId && log.targetType === "user") {
    return (
      <Link className={linkClassName} href={`/users/${log.targetPublicId}`}>
        {log.targetName || log.targetPublicId}
      </Link>
    );
  }

  if (log.targetType === "tenant_admin_invitation") {
    return <InvitationTarget log={log} />;
  }

  if (log.tenantId) {
    return (
      <Link className={linkClassName} href={`/tenants/${log.tenantId}`}>
        {log.targetName || log.tenantName || log.tenantId}
      </Link>
    );
  }

  if (log.targetPublicId && log.targetType === "tenant") {
    return (
      <Link className={linkClassName} href={`/tenants/${log.targetPublicId}`}>
        {log.targetName || log.targetPublicId}
      </Link>
    );
  }

  const settingsTarget = settingsTargetName(log.targetType);
  if (settingsTarget) {
    return (
      <p>
        <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
          {settingsTarget}
        </Suspense>
      </p>
    );
  }

  return <p>{buildTargetLabel(log.targetType, log.targetId)}</p>;
};
