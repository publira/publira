import * as AuthScreen from "@publira/layouts/auth-screen";
import { FormMessage } from "@publira/ui-components/form-message";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getInitialLocaleCandidate } from "#lib/initial-locale";
import { getMessagesFor } from "#lib/messages";
import { isSetupCompleted } from "#lib/setup";

import { SetupForm } from "./_components/setup-form";
import { SetupMessage } from "./_components/setup-message";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getInitialLocaleCandidate();
  const t = await getMessagesFor(locale);

  return { title: t("platform.auth.setup.title") };
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
      <AuthScreen.Note>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <SetupMessage message="platform.auth.setup.description" />
        </Suspense>
      </AuthScreen.Note>

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
  <AuthScreen.Root>
    <AuthScreen.Main>
      <AuthScreen.Header>
        <AuthScreen.Title>Publira</AuthScreen.Title>
        <AuthScreen.Tagline>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <SetupMessage message="platform.auth.setup.title" />
          </Suspense>
        </AuthScreen.Tagline>
      </AuthScreen.Header>

      <AuthScreen.Body>
        <Suspense fallback={<SetupContentSkeleton />}>
          <SetupContent />
        </Suspense>
      </AuthScreen.Body>
    </AuthScreen.Main>

    <AuthScreen.Panel>
      <AuthScreen.Pattern />
    </AuthScreen.Panel>
  </AuthScreen.Root>
);

export default SetupPage;
