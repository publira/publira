import { getMessage } from "@publira/i18n";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getLocale, loadHostMessages } from "#lib/locale";

import { SettingsFlash } from "./settings-flash";
import { SettingsTabs } from "./settings-tabs";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return { title: getMessage(messages, "host.settings.title") };
};

const SettingsTabsSection = async () => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return (
    <SettingsTabs
      labels={{
        basic: getMessage(messages, "host.settings.tab_basic"),
        follows: getMessage(messages, "host.settings.tab_follows"),
        notifications: getMessage(messages, "host.settings.tab_notifications"),
        security: getMessage(messages, "host.settings.tab_security"),
      }}
    />
  );
};

const SettingsTabsSkeleton = () => (
  <div className="flex gap-4 px-4 py-3">
    <SkeletonLine className="h-4 w-16" />
    <SkeletonLine className="h-4 w-16" />
    <SkeletonLine className="h-4 w-16" />
    <SkeletonLine className="h-4 w-20" />
  </div>
);

const SettingsLayout = ({
  children,
}: LayoutProps<"/[tenant_id]/[locale]/settings">) => (
  // No session check here: `/settings` is a member path the proxy already
  // gates, and awaiting one in a layout body would keep the segment out of its
  // static shell. Each section re-authenticates its own read instead.
  <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
    <header className="space-y-4 border-b border-border/50 pb-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">
          <Suspense fallback={<SkeletonLine className="h-7 w-48" />}>
            <Message message="host.settings.heading" />
          </Suspense>
        </h1>
        <p className="text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="host.settings.description" />
          </Suspense>
        </p>
      </div>
      <Suspense fallback={<SettingsTabsSkeleton />}>
        <SettingsTabsSection />
      </Suspense>
    </header>

    <Suspense fallback={null}>
      <SettingsFlash />
    </Suspense>

    {children}
  </main>
);

export default SettingsLayout;
