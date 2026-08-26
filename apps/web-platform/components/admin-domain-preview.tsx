import { SkeletonLine } from "@publira/ui-components/skeleton";
import { cn } from "@publira/utils";
import { Suspense } from "react";

import { Message } from "./message";

export const AdminDomainPreview = ({
  adminDomain = "",
  className,
  domain = "",
  showCurrentDomain = false,
}: {
  adminDomain?: string;
  className?: string;
  domain?: string;
  showCurrentDomain?: boolean;
}) => {
  const trimmedAdminDomain = adminDomain.trim();
  const trimmedDomain = domain.trim();

  if (trimmedAdminDomain) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message
            message="platform.tenants.admin_domain_preview_set"
            values={{ domain: trimmedAdminDomain }}
          />
        </Suspense>
      </p>
    );
  }

  const prefixedDomain = `admin.${trimmedDomain || "example.com"}`;

  if (showCurrentDomain && trimmedDomain) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message
            message="platform.tenants.admin_domain_preview_current"
            values={{ domain: prefixedDomain }}
          />
        </Suspense>
      </p>
    );
  }

  return (
    <p className={cn("text-sm text-muted-foreground", className)}>
      <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
        <Message
          message="platform.tenants.admin_domain_preview_prefix"
          values={{ domain: prefixedDomain }}
        />
      </Suspense>
    </p>
  );
};
