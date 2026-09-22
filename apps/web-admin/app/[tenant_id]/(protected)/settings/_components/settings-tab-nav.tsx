import { LinkButton } from "@publira/ui-components/button";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";

interface SettingsTabNavProps {
  current:
    | "app-links"
    | "basic"
    | "creator-roles"
    | "email"
    | "mobile-push"
    | "payment"
    | "policy"
    | "royalties"
    | "theme";
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
      render={<Link href="/settings/creator-roles" />}
      variant={current === "creator-roles" ? "default" : "outline"}
    >
      <Suspense fallback={<SkeletonLine className="h-5 w-24" />}>
        <Message message="admin.settings.tabs.creator_roles" />
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
    <LinkButton
      render={<Link href="/settings/royalties" />}
      variant={current === "royalties" ? "default" : "outline"}
    >
      <Suspense fallback={<SkeletonLine className="h-5 w-16" />}>
        <Message message="admin.settings.tabs.royalties" />
      </Suspense>
    </LinkButton>
    <LinkButton
      render={<Link href="/settings/mobile-push" />}
      variant={current === "mobile-push" ? "default" : "outline"}
    >
      <Suspense fallback={<SkeletonLine className="h-5 w-24" />}>
        <Message message="admin.settings.tabs.mobile_push" />
      </Suspense>
    </LinkButton>
    <LinkButton
      render={<Link href="/settings/app-links" />}
      variant={current === "app-links" ? "default" : "outline"}
    >
      <Suspense fallback={<SkeletonLine className="h-5 w-20" />}>
        <Message message="admin.settings.tabs.app_links" />
      </Suspense>
    </LinkButton>
    <LinkButton
      render={<Link href="/settings/policy" />}
      variant={current === "policy" ? "default" : "outline"}
    >
      <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
        <Message message="admin.settings.tabs.policy" />
      </Suspense>
    </LinkButton>
  </div>
);
