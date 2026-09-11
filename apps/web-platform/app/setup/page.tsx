import { getMessage } from "@publira/i18n";
import {
  AuthScreen,
  AuthScreenBody,
  AuthScreenHeader,
  AuthScreenNote,
  AuthScreenTagline,
  AuthScreenTitle,
} from "@publira/layouts/auth-screen";
import { FormMessage } from "@publira/ui-components/form-message";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getInitialLocaleCandidate } from "#lib/initial-locale";
import { loadPlatformMessages } from "#lib/locale";
import { isSetupCompleted } from "#lib/setup";

import { SetupForm } from "./_components/setup-form";
import { SetupMessage } from "./_components/setup-message";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getInitialLocaleCandidate();
  const messages = await loadPlatformMessages(locale);

  return { title: getMessage(messages, "platform.auth.setup.title") };
};

/** The setup-status RPC decides between the form, a warning, and a redirect. */
const SetupContent = async () => {
  const setupStatus = await isSetupCompleted();

  if (!setupStatus.available) {
    return (
      <FormMessage variant="destructive">
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <SetupMessage message="platform.auth.setup.api_unavailable" />
        </Suspense>
      </FormMessage>
    );
  }

  if (setupStatus.completed === true) {
    redirect("/login");
  }

  return (
    <>
      <AuthScreenNote>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <SetupMessage message="platform.auth.setup.description" />
        </Suspense>
      </AuthScreenNote>

      <Suspense fallback={<Skeleton className="h-10 w-full" />}>
        <SetupForm />
      </Suspense>
    </>
  );
};

const SetupContentSkeleton = () => (
  <div className="grid gap-4">
    <Skeleton className="h-5 w-3/4" />
    <Skeleton className="h-5 w-1/2" />
    <Skeleton className="h-5 w-1/2" />
    <Skeleton className="h-5 w-1/2" />
    <Skeleton className="h-5 w-1/2" />
    <Skeleton className="h-5 w-full" />
  </div>
);

const SetupPage = () => (
  <AuthScreen>
    <AuthScreenHeader>
      <AuthScreenTitle>Publira</AuthScreenTitle>
      <AuthScreenTagline>
        <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
          <SetupMessage message="platform.auth.setup.title" />
        </Suspense>
      </AuthScreenTagline>
    </AuthScreenHeader>

    <AuthScreenBody>
      <Suspense fallback={<SetupContentSkeleton />}>
        <SetupContent />
      </Suspense>
    </AuthScreenBody>
  </AuthScreen>
);

export default SetupPage;
