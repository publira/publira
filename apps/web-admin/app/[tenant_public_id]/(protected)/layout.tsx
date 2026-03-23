import {
  guardPlaceholder,
  createPlaceholderStaticParams,
} from "@publira/utils/next-static-params";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { AdminLayout } from "../../../components/admin-layout";
import {
  ADMIN_SESSION_COOKIE_NAME,
  getAdminCurrentUser,
} from "../../../lib/admin-auth";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_public_id");

interface ProtectedLayoutProps {
  children: ReactNode;
  params: Promise<{ tenant_public_id: string }>;
}

export default async function ProtectedLayout({
  children,
  params,
}: ProtectedLayoutProps) {
  await connection();

  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  const cookieStore = await cookies();
  const sessionId = cookieStore.get(ADMIN_SESSION_COOKIE_NAME)?.value ?? "";
  if (!sessionId) {
    redirect("/login");
  }

  const currentUser = await getAdminCurrentUser(sessionId, tenant_public_id);
  if (!currentUser) {
    redirect("/login");
  }

  return <AdminLayout currentUser={currentUser}>{children}</AdminLayout>;
}
