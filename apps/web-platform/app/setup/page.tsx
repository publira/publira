import { FormMessage } from "@publira/ui-components/form-message";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { getMessage } from "@publira/utils/i18n";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";
import { isSetupCompleted } from "#lib/setup";

import { SetupForm } from "./_components/setup-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  return { title: getMessage(messages, "platform.auth.setup.title") };
};

/** The setup-status RPC decides between the form, a warning, and a redirect. */
const SetupContent = async () => {
  const setupStatus = await isSetupCompleted();

  if (setupStatus === true) {
    redirect("/login");
  }

  if (setupStatus === null) {
    return (
      <FormMessage variant="destructive">
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="platform.auth.setup.api_unavailable" />
        </Suspense>
      </FormMessage>
    );
  }

  return (
    <>
      <p className="text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="platform.auth.setup.description" />
        </Suspense>
      </p>

      <Suspense fallback={<Skeleton className="h-10 w-full" />}>
        <SetupForm />
      </Suspense>
    </>
  );
};

const SetupContentSkeleton = () => (
  <div className="space-y-4">
    <Skeleton className="h-5 w-3/4" />
    <Skeleton className="h-5 w-1/2" />
    <Skeleton className="h-5 w-1/2" />
    <Skeleton className="h-5 w-1/2" />
    <Skeleton className="h-5 w-1/2" />
    <Skeleton className="h-5 w-full" />
  </div>
);

const SetupPage = () => (
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="font-serif text-2xl font-semibold">Publira</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="platform.auth.setup.title" />
          </Suspense>
        </p>
      </div>

      <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
        <Suspense fallback={<SetupContentSkeleton />}>
          <SetupContent />
        </Suspense>
      </div>
    </div>
  </main>
);

export default SetupPage;
