import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { ReactNode } from "react";

import "../globals.css";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

export default function TenantRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
