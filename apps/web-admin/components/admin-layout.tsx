"use client";

import {
  ConsoleLayout,
  ConsoleHeader,
  ConsoleSidebar,
} from "@publira/layouts/admin";
import { StatusChip } from "@publira/ui-components/badge";
import { Button } from "@publira/ui-components/button";
import type { ReactNode } from "react";

import { navigation } from "./admin-navigation";

interface AdminLayoutCurrentUser {
  name: string;
  publicId: string;
  role: string;
}

interface AdminLayoutTenant {
  adminDomain: string;
  domain: string;
  name: string;
  publicId: string;
}

export interface AdminLayoutProps {
  children: ReactNode;
  currentUser: AdminLayoutCurrentUser;
  tenant: AdminLayoutTenant;
}

const adminGradient =
  "bg-[radial-gradient(circle_at_top_left,rgba(15,124,130,0.12),transparent_28%),radial-gradient(circle_at_top_right,rgba(217,111,74,0.13),transparent_30%),linear-gradient(180deg,rgba(255,253,248,0.78),rgba(246,242,233,0.98))]";

export const AdminLayout = ({
  children,
  currentUser,
  tenant,
}: AdminLayoutProps) => (
  <ConsoleLayout
    gradient={adminGradient}
    header={
      <ConsoleHeader
        actions={
          <Button size="sm" type="button" variant="outline">
            プレビュー
          </Button>
        }
        contextLabel={tenant.name}
        currentUser={currentUser}
        eyebrow="現在の運用先"
        navId="admin-navigation"
      />
    }
    sidebar={
      <ConsoleSidebar
        contextInfo={
          <div className="flex items-start justify-between gap-3">
            <div className="grid gap-1">
              <p className="text-sm font-medium text-foreground">
                {tenant.name}
              </p>
              <p className="text-xs leading-5 text-muted-foreground">
                ドメイン: {tenant.domain || "-"}
              </p>
            </div>
            <StatusChip status="success">Online</StatusChip>
          </div>
        }
        footerNote={
          <>
            <p className="text-sm font-medium text-foreground">
              モバイル切り替え対応
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              サイドバーは小さい画面ではドロワーに切り替わり、将来の管理画面でも同じナビゲーション構造を再利用できます。
            </p>
          </>
        }
        logoLabel="Admin Console"
        navId="admin-navigation"
        navigation={navigation}
      />
    }
  >
    {children}
  </ConsoleLayout>
);
