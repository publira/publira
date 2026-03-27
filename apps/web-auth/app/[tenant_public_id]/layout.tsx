import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { getTenantSiteInfo } from "../../lib/tenant";

const buildAuthTitleBase = (siteLabel: string): string => siteLabel;

const AuthFooter = ({
  copyrightText,
}: {
  copyrightText?: string;
}) => {
  const normalizedCopyrightText = copyrightText?.trim() ?? "";

  if (!normalizedCopyrightText) {
    return null;
  }

  return (
    <footer className="border-t border-border/70 bg-surface">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-6 text-center text-sm text-muted-foreground">
        <p>{normalizedCopyrightText}</p>
      </div>
    </footer>
  );
};

const AuthShell = ({
  children,
  copyrightText,
}: {
  children: ReactNode;
  copyrightText?: string;
}) => (
  <div className="flex min-h-dvh flex-col bg-background text-foreground">
    <div className="flex-1">{children}</div>
    <AuthFooter copyrightText={copyrightText} />
  </div>
);

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_public_id");

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ tenant_public_id: string }>;
}): Promise<Metadata> => {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  const info = await getTenantSiteInfo(tenant_public_id);
  const siteLabel = info?.siteLabel ?? "サイト";
  const base = buildAuthTitleBase(siteLabel);

  return {
    title: {
      default: base,
      template: `%s | ${base}`,
    },
  };
};

export default async function TenantLayout({
  children,
  params,
}: LayoutProps<"/[tenant_public_id]">) {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  const info = await getTenantSiteInfo(tenant_public_id);
  const copyrightText = info?.copyrightText;

  return (
    <AuthShell copyrightText={copyrightText}>
      {children}
    </AuthShell>
  );
}
