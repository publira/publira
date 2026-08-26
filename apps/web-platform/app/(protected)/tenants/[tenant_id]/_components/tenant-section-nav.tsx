import { LinkButton } from "@publira/ui-components/button";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";

interface TenantSectionNavProps {
  current: "detail" | "members";
  tenantId: string;
}

export const TenantSectionNav = ({
  current,
  tenantId,
}: TenantSectionNavProps) => (
  <div className="flex flex-wrap gap-2">
    <LinkButton
      render={<Link href={`/tenants/${tenantId}`} />}
      variant={current === "detail" ? "default" : "outline"}
    >
      <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
        <Message message="platform.tenants.section_basic" />
      </Suspense>
    </LinkButton>
    <LinkButton
      render={<Link href={`/tenants/${tenantId}/members`} />}
      variant={current === "members" ? "default" : "outline"}
    >
      <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
        <Message message="platform.tenants.members_nav" />
      </Suspense>
    </LinkButton>
  </div>
);
