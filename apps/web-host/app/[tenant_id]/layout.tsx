import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { getTenantSiteInfo } from "#lib/tenant";
import { resolveTenantIcons } from "#lib/tenant-icon";
import { getTenantId } from "#lib/tenant-id";

import "../globals.css";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

/**
 * Icons live on the root layout rather than on `(site)`, so a reader sees the
 * tenant's own icon on the auth screens too — those are the pages a browser is
 * most likely to bookmark.
 */
export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const info = await getTenantSiteInfo(tenantId);

  return { icons: resolveTenantIcons(info) };
};

const TenantRootLayout = ({ children }: { children: ReactNode }) => (
  <html lang="ja">
    <head>
      {/* Dynamic per-tenant overrides from GET /theme.css (short Cache-Control). */}
      {/* oxlint-disable-next-line next/no-css-tags, react-doctor/nextjs-no-css-link -- runtime tenant theme route */}
      <link href="/theme.css" rel="stylesheet" />
    </head>
    <body className="min-h-dvh bg-background text-foreground antialiased">
      {children}
    </body>
  </html>
);

export default TenantRootLayout;
