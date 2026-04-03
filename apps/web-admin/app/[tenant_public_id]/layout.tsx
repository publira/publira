import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";

import { getTenantName } from "#lib/public-api";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_public_id");

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ tenant_public_id: string }>;
}): Promise<Metadata> => {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  const tenantName = await getTenantName(tenant_public_id);
  const base = tenantName ? `${tenantName} 管理画面` : "管理画面";

  return {
    title: {
      default: base,
      template: `%s | ${base}`,
    },
  };
};

export default function TenantLayout({
  children,
}: LayoutProps<"/[tenant_public_id]">) {
  return children;
}
