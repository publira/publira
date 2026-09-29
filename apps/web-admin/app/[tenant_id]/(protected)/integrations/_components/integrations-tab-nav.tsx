import { LinkButton } from "@publira/ui-components/button";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";

interface IntegrationsTabNavProps {
  current: "app-links" | "email" | "mobile-push" | "payment";
}

export const IntegrationsTabNav = ({ current }: IntegrationsTabNavProps) => (
  <div className="flex flex-wrap gap-2">
    <LinkButton
      render={<Link href="/integrations/email" />}
      variant={current === "email" ? "default" : "outline"}
    >
      <Suspense fallback={<SkeletonLine className="h-5 w-16" />}>
        <Message message="admin.integrations.tabs.email" />
      </Suspense>
    </LinkButton>
    <LinkButton
      render={<Link href="/integrations/payment" />}
      variant={current === "payment" ? "default" : "outline"}
    >
      <Suspense fallback={<SkeletonLine className="h-5 w-12" />}>
        <Message message="admin.integrations.tabs.payment" />
      </Suspense>
    </LinkButton>
    <LinkButton
      render={<Link href="/integrations/mobile-push" />}
      variant={current === "mobile-push" ? "default" : "outline"}
    >
      <Suspense fallback={<SkeletonLine className="h-5 w-24" />}>
        <Message message="admin.integrations.tabs.mobile_push" />
      </Suspense>
    </LinkButton>
    <LinkButton
      render={<Link href="/integrations/app-links" />}
      variant={current === "app-links" ? "default" : "outline"}
    >
      <Suspense fallback={<SkeletonLine className="h-5 w-20" />}>
        <Message message="admin.integrations.tabs.app_links" />
      </Suspense>
    </LinkButton>
  </div>
);
