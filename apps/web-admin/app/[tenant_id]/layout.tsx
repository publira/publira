import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { tenant_id } from "next/root-params";
import type { ReactNode } from "react";

import { getTenantName } from "#lib/public-api";

import "../globals.css";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await tenant_id();
  if (typeof tenantId !== "string") {
    return { title: "管理画面" };
  }
  guardPlaceholder(tenantId);

  const tenantName = await getTenantName(tenantId);
  const base = tenantName ? `${tenantName} 管理画面` : "管理画面";

  return {
    title: {
      default: base,
      template: `%s | ${base}`,
    },
  };
};

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
