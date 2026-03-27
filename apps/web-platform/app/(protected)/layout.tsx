import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { PlatformLayout } from "../../components/platform-layout";
import { getPlatformCurrentOperator } from "../../lib/auth";

const ProtectedLayoutFallback = () => (
  <div className="min-h-dvh bg-[linear-gradient(180deg,rgba(255,253,248,0.72),rgba(246,242,233,0.9))]">
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="h-14 animate-pulse rounded-xl border border-border/70 bg-card/60" />
      <div className="mt-6 grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="h-96 animate-pulse rounded-2xl border border-border/70 bg-card/60" />
        <div className="h-96 animate-pulse rounded-2xl border border-border/70 bg-card/60" />
      </div>
    </div>
  </div>
);

export const ProtectedLayoutContent = async ({
  children,
}: LayoutProps<"/">) => {
  await connection();

  const currentOperator = await getPlatformCurrentOperator();
  if (!currentOperator) {
    redirect("/login");
  }

  return (
    <PlatformLayout currentOperator={currentOperator}>
      {children}
    </PlatformLayout>
  );
};

export default function ProtectedLayout(props: LayoutProps<"/">) {
  return (
    <Suspense fallback={<ProtectedLayoutFallback />}>
      <ProtectedLayoutContent {...props} />
    </Suspense>
  );
}
