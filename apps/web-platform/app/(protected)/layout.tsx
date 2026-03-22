import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { PlatformLayout } from "../../components/platform-layout";
import { getPlatformCurrentOperator } from "../../lib/auth";

interface ProtectedLayoutProps {
  children: ReactNode;
}

export default async function ProtectedLayout({
  children,
}: ProtectedLayoutProps) {
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
}
