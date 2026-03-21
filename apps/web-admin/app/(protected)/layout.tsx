import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { AdminLayout } from "../../components/admin-layout";
import {
  ADMIN_SESSION_COOKIE_NAME,
  getAdminCurrentUser,
} from "../../lib/admin-auth";

interface ProtectedLayoutProps {
  children: ReactNode;
}

export default async function ProtectedLayout({
  children,
}: ProtectedLayoutProps) {
  await connection();

  const cookieStore = await cookies();
  const sessionId = cookieStore.get(ADMIN_SESSION_COOKIE_NAME)?.value ?? "";
  if (!sessionId) {
    redirect("/login");
  }

  const currentUser = await getAdminCurrentUser(sessionId);
  if (!currentUser) {
    redirect("/login");
  }

  return <AdminLayout currentUser={currentUser}>{children}</AdminLayout>;
}
