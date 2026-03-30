import { guardPlaceholder } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { getTenantSiteInfo } from "../../lib/tenant";

const AuthFooter = ({ copyrightText }: { copyrightText?: string }) => {
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

const AuthFooterContent = async ({
  tenantPublicId,
}: {
  tenantPublicId: string;
}) => {
  const info = await getTenantSiteInfo(tenantPublicId);
  return <AuthFooter copyrightText={info?.copyrightText} />;
};

const AuthShell = ({
  children,
  tenantPublicId,
}: {
  children: ReactNode;
  tenantPublicId: string;
}) => (
  <div className="flex min-h-dvh flex-col bg-background text-foreground">
    <div className="flex-1">{children}</div>
    <Suspense fallback={null}>
      <AuthFooterContent tenantPublicId={tenantPublicId} />
    </Suspense>
  </div>
);

const AuthShellFallback = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-dvh flex-col bg-background text-foreground">
    <div className="flex-1">{children}</div>
  </div>
);

export const metadata: Metadata = {
  title: {
    default: "Publira",
    template: "%s | Publira",
  },
};

const TenantLayoutContent = async ({
  children,
  params,
}: LayoutProps<"/[tenant_public_id]">) => {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  return <AuthShell tenantPublicId={tenant_public_id}>{children}</AuthShell>;
};

export default function TenantLayout({
  children,
  params,
}: LayoutProps<"/[tenant_public_id]">) {
  return (
    <Suspense fallback={<AuthShellFallback>{children}</AuthShellFallback>}>
      <TenantLayoutContent params={params}>{children}</TenantLayoutContent>
    </Suspense>
  );
}
