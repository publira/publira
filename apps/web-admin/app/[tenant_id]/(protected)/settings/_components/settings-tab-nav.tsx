import { LinkButton } from "@publira/ui-components/button";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";

interface SettingsTabNavProps {
  current: "basic" | "email" | "payment" | "theme";
}

export const SettingsTabNav = ({ current }: SettingsTabNavProps) => (
  <div className="flex flex-wrap gap-2">
    <LinkButton
      render={<Link href="/settings" />}
      variant={current === "basic" ? "default" : "outline"}
    >
      <Suspense fallback={<SkeletonLine className="h-5 w-16" />}>
        <Message message="admin.settings.tabs.basic" />
      </Suspense>
    </LinkButton>
    <LinkButton
      render={<Link href="/settings/theme" />}
      variant={current === "theme" ? "default" : "outline"}
    >
      <Suspense fallback={<SkeletonLine className="h-5 w-12" />}>
        <Message message="admin.settings.tabs.theme" />
      </Suspense>
    </LinkButton>
    <LinkButton
      render={<Link href="/settings/email" />}
      variant={current === "email" ? "default" : "outline"}
    >
      <Suspense fallback={<SkeletonLine className="h-5 w-16" />}>
        <Message message="admin.settings.tabs.email" />
      </Suspense>
    </LinkButton>
    <LinkButton
      render={<Link href="/settings/payment" />}
      variant={current === "payment" ? "default" : "outline"}
    >
      <Suspense fallback={<SkeletonLine className="h-5 w-12" />}>
        <Message message="admin.settings.tabs.payment" />
      </Suspense>
    </LinkButton>
  </div>
);
