"use client";

import {
  ConsoleLayout,
  ConsoleHeader,
  ConsoleSidebar,
} from "@publira/layouts/admin";
import { StatusChip } from "@publira/ui-components/badge";
import { LinkButton } from "@publira/ui-components/button";
import type { ReactNode } from "react";

import { navigation } from "./platform-navigation";

interface PlatformLayoutCurrentOperator {
  name: string;
  publicId: string;
  role: string;
}

export interface PlatformLayoutProps {
  children: ReactNode;
  currentOperator: PlatformLayoutCurrentOperator;
}

const platformGradient =
  "bg-[radial-gradient(circle_at_top_left,rgba(21,121,194,0.11),transparent_28%),radial-gradient(circle_at_top_right,rgba(24,149,118,0.11),transparent_30%),linear-gradient(180deg,rgba(248,252,255,0.82),rgba(240,247,250,0.96))]";

export const PlatformLayout = ({
  children,
  currentOperator,
}: PlatformLayoutProps) => (
  <ConsoleLayout
    gradient={platformGradient}
    header={
      <ConsoleHeader
        actions={
          <LinkButton href="/tenants/new" size="sm">
            テナント作成
          </LinkButton>
        }
        contextLabel="テナント横断オペレーション"
        currentUser={currentOperator}
        eyebrow="Platform Operations"
        navId="platform-navigation"
      />
    }
    sidebar={
      <ConsoleSidebar
        contextInfo={
          <div className="flex items-start justify-between gap-3">
            <div className="grid gap-1">
              <p className="text-sm font-medium text-foreground">
                運用ステータス
              </p>
              <p className="text-xs leading-5 text-muted-foreground">
                Platform Console は現在利用可能です。
              </p>
            </div>
            <StatusChip status="success">Online</StatusChip>
          </div>
        }
        logoLabel="Platform Console"
        navId="platform-navigation"
        navigation={navigation}
      />
    }
  >
    {children}
  </ConsoleLayout>
);
