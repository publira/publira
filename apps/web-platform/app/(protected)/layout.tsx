import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { PlatformLayout } from "../../components/platform-layout";
import {
  PLATFORM_SESSION_COOKIE_NAME,
  getPlatformCurrentOperator,
} from "../../lib/platform-auth";

interface ProtectedLayoutProps {
  children: ReactNode;
}

export default async function ProtectedLayout({
  children,
}: ProtectedLayoutProps) {
  await connection();

  const cookieStore = await cookies();
  const sessionId = cookieStore.get(PLATFORM_SESSION_COOKIE_NAME)?.value ?? "";
  if (!sessionId) {
    redirect("/login");
  }

  const currentOperator = await getPlatformCurrentOperator(sessionId);
  if (!currentOperator) {
    redirect("/login");
  }

  return (
    <PlatformLayout currentOperator={currentOperator}>
      {children}
    </PlatformLayout>
  );
}
