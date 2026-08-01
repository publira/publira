import type { Metadata } from "next";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { getTenantSiteInfo } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

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

const AuthFooterContent = async () => {
  const tenantId = await getTenantId();
  const info = await getTenantSiteInfo(tenantId);
  return <AuthFooter copyrightText={info?.copyrightText} />;
};

const AuthShell = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-dvh flex-col bg-background text-foreground">
    <div className="flex-1">{children}</div>
    <Suspense fallback={null}>
      <AuthFooterContent />
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

export default function TenantLayout({
  children,
}: LayoutProps<"/[tenant_id]">) {
  return (
    <Suspense fallback={<AuthShellFallback>{children}</AuthShellFallback>}>
      <AuthShell>{children}</AuthShell>
    </Suspense>
  );
}
