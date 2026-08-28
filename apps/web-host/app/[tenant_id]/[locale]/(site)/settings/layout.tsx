import { getMessage } from "@publira/i18n";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { Message } from "#components/message";
import { getLocale, loadHostMessages } from "#lib/locale";

import { parseSettingsFlashSearchParams } from "./_lib/search-params";
import { SettingsTabs } from "./settings-tabs";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return { title: getMessage(messages, "host.settings.title") };
};

const FlashMessage = async ({
  searchParams,
}: {
  searchParams: Promise<
    | {
        message?: string | string[];
        status?: string | string[];
      }
    | undefined
  >;
}) => {
  const { message, status } = parseSettingsFlashSearchParams(
    (await searchParams) ?? {}
  );

  if (!message) {
    return null;
  }

  return (
    <p
      className={`rounded-md border px-4 py-3 text-sm ${
        status === "success"
          ? "border-success/30 bg-success/10 text-success"
          : "border-destructive/30 bg-destructive/10 text-destructive"
      }`}
      role={status === "success" ? "status" : "alert"}
    >
      {message}
    </p>
  );
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
  params: _params,
  searchParams,
}: {
  children: ReactNode;
  params: Promise<{ locale: string; tenant_id: string }>;
  searchParams: Promise<
    | {
        message?: string | string[];
        status?: string | string[];
      }
    | undefined
  >;
}) => (
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

    <FlashMessage searchParams={searchParams} />

    {children}
  </main>
);

export default SettingsLayout;
