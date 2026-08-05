import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { ReactNode } from "react";

import "../globals.css";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const TenantRootLayout = ({ children }: { children: ReactNode }) => (
  <html lang="ja">
    <body>{children}</body>
  </html>
);

export default TenantRootLayout;
