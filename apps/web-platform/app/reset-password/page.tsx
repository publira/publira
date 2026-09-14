import {
  AuthScreen,
  AuthScreenHeader,
  AuthScreenTagline,
  AuthScreenTitle,
} from "@publira/layouts/auth-screen";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";

import { ResetPasswordForm } from "./_components/reset-password-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const t = await getMessagesFor(locale);

  return { title: t("platform.auth.reset_password.title") };
};

const ResetPasswordPage = () => (
  <AuthScreen>
    <AuthScreenHeader>
      <AuthScreenTitle>Publira</AuthScreenTitle>
      <AuthScreenTagline>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="platform.auth.reset_password.description" />
        </Suspense>
      </AuthScreenTagline>
    </AuthScreenHeader>

    <ResetPasswordForm />
  </AuthScreen>
);

export default ResetPasswordPage;
