import { LinkButton } from "@publira/ui-components/button";
import Link from "next/link";
import type { ReactNode } from "react";

interface TenantSectionNavProps {
  current: "detail" | "members";
  labels: {
    basic: ReactNode;
    members: ReactNode;
  };
  tenantId: string;
}

export const TenantSectionNav = ({
  current,
  labels,
  tenantId,
}: TenantSectionNavProps) => (
  <div className="flex flex-wrap gap-2">
    <LinkButton
      render={<Link href={`/tenants/${tenantId}`} />}
      variant={current === "detail" ? "default" : "outline"}
    >
      {labels.basic}
    </LinkButton>
    <LinkButton
      render={<Link href={`/tenants/${tenantId}/members`} />}
      variant={current === "members" ? "default" : "outline"}
    >
      {labels.members}
    </LinkButton>
  </div>
);
