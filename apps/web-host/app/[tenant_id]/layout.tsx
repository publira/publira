import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { ReactNode } from "react";

import "../globals.css";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const TenantRootLayout = ({ children }: { children: ReactNode }) => (
  <html lang="ja">
    <head>
      {/* Dynamic per-tenant overrides from GET /theme.css (short Cache-Control). */}
      {/* oxlint-disable-next-line next/no-css-tags -- not a static import; tenant theme route */}
      <link href="/theme.css" rel="stylesheet" />
    </head>
    <body className="min-h-dvh bg-background text-foreground antialiased">
      {children}
    </body>
  </html>
);

export default TenantRootLayout;
