import { LinkButton } from "@publira/ui-components/button";
import Link from "next/link";

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
      基本情報
    </LinkButton>
    <LinkButton
      render={<Link href={`/tenants/${tenantId}/members`} />}
      variant={current === "members" ? "default" : "outline"}
    >
      メンバー管理
    </LinkButton>
  </div>
);
