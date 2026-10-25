import { SkeletonLine } from "@publira/ui-components/skeleton";
import { cn } from "@publira/utils";
import { Suspense } from "react";

import { Message } from "./message";

export const ImageDomainPreview = ({
  className,
  domain = "",
  imageDomain = "",
}: {
  className?: string;
  domain?: string;
  imageDomain?: string;
}) => {
  const trimmedImageDomain = imageDomain.trim();
  const trimmedDomain = domain.trim();

  if (trimmedImageDomain) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message
            message="platform.tenants.image_domain_preview_set"
            values={{ domain: trimmedImageDomain }}
          />
        </Suspense>
      </p>
    );
  }

  if (trimmedDomain) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message
            message="platform.tenants.image_domain_preview_current"
            values={{ domain: trimmedDomain }}
          />
        </Suspense>
      </p>
    );
  }

  return (
    <p className={cn("text-sm text-muted-foreground", className)}>
      <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
        <Message message="platform.tenants.image_domain_preview_default" />
      </Suspense>
    </p>
  );
};
