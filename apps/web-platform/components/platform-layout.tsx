import {
  ConsoleHeader,
  ConsoleHeaderUser,
  ConsoleHeaderUserSkeleton,
  ConsoleLayout,
  ConsoleLayoutContent,
  ConsoleLayoutMain,
  ConsoleSidebar,
} from "@publira/layouts/admin";
import { StatusChip } from "@publira/ui-components/badge";
import { LinkButton } from "@publira/ui-components/button";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { getPlatformCurrentOperator } from "../lib/auth";
import { navigation } from "./platform-navigation";

const platformGradient =
  "bg-[radial-gradient(circle_at_top_left,rgba(21,121,194,0.11),transparent_28%),radial-gradient(circle_at_top_right,rgba(24,149,118,0.11),transparent_30%),linear-gradient(180deg,rgba(248,252,255,0.82),rgba(240,247,250,0.96))]";

export const PlatformUser = async () => {
  const currentOperator = await getPlatformCurrentOperator();
  if (!currentOperator) {
    redirect("/login");
  }

  return <ConsoleHeaderUser currentUser={currentOperator} />;
};

export const PlatformLayout = ({ children }: { children: ReactNode }) => (
  <ConsoleLayout gradient={platformGradient}>
    <ConsoleSidebar logoLabel="Platform Console" navigation={navigation}>
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <p className="text-sm font-medium text-foreground">運用ステータス</p>
          <p className="text-xs leading-5 text-muted-foreground">
            Platform Console は現在利用可能です。
          </p>
        </div>
        <StatusChip status="success">Online</StatusChip>
      </div>
    </ConsoleSidebar>

    <ConsoleLayoutContent>
      <ConsoleHeader
        contextLabel="テナント横断オペレーション"
        eyebrow="Platform Operations"
      >
        <Suspense fallback={<ConsoleHeaderUserSkeleton />}>
          <PlatformUser />
        </Suspense>
        <LinkButton href="/tenants/new" size="sm">
          テナント作成
        </LinkButton>
      </ConsoleHeader>
      <ConsoleLayoutMain>{children}</ConsoleLayoutMain>
    </ConsoleLayoutContent>
  </ConsoleLayout>
);
