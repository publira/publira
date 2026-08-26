import { SkeletonLine } from "@publira/ui-components/skeleton";
import { cn } from "@publira/utils";
import { Suspense } from "react";

import { Message } from "./message";

export const TenantDomainCautions = ({
  className,
  showUpdateCaution = false,
}: {
  className?: string;
  showUpdateCaution?: boolean;
}) => (
  <section className={cn("grid gap-2 rounded-md border px-3 py-2", className)}>
    <p className="text-sm font-medium">
      <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
        <Message message="platform.tenants.caution_title" />
      </Suspense>
    </p>
    <ul className="list-disc space-y-1 pl-5 text-sm">
      <li>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="platform.tenants.caution_cache" />
        </Suspense>
      </li>
      <li>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="platform.tenants.caution_unique" />
        </Suspense>
      </li>
      <li>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="platform.tenants.caution_dns" />
        </Suspense>
      </li>
      {showUpdateCaution ? (
        <li>
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="platform.tenants.caution_update" />
          </Suspense>
        </li>
      ) : null}
    </ul>
  </section>
);
