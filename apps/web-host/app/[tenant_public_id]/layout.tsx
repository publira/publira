import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { ReactNode } from "react";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_public_id");

export default function TenantLayout({ children }: { children: ReactNode }) {
  return children;
}
