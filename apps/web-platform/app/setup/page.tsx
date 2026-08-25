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
  const messages = await loadPlatformMessages(await getPlatformLocale());

  return { title: getMessage(messages, "platform.auth.setup.title") };
};

/**
 * Nothing inside the card can render before the setup-status RPC answers — it
 * decides between the form, the unreachable-API message, and a redirect — so
 * this section resolves its copy as strings instead of giving each string a
 * boundary that would never buy the reader anything.
 */
const SetupContent = async () => {
  const setupStatus = await isSetupCompleted();

  if (setupStatus === true) {
    redirect("/login");
  }

  const messages = await loadPlatformMessages(await getPlatformLocale());

  if (setupStatus === null) {
    return (
      <FormMessage variant="destructive">
        {getMessage(messages, "platform.auth.setup.api_unavailable")}
      </FormMessage>
    );
  }

  return (
    <>
      <p className="text-sm text-muted-foreground">
        {getMessage(messages, "platform.auth.setup.description")}
      </p>

      <SetupForm
        copy={{
          confirmPasswordLabel: getMessage(
            messages,
            "platform.auth.setup.confirm_password_label"
          ),
          emailLabel: getMessage(messages, "platform.auth.fields.email_label"),
          nameLabel: getMessage(messages, "platform.auth.setup.name_label"),
          namePlaceholder: getMessage(
            messages,
            "platform.auth.setup.name_placeholder"
          ),
          passwordLabel: getMessage(
            messages,
            "platform.auth.fields.password_label"
          ),
          pendingLabel: getMessage(messages, "platform.auth.setup.pending"),
          submitLabel: getMessage(messages, "platform.auth.setup.submit"),
        }}
      />
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
