import { getMessage } from "@publira/utils/i18n";
import type { Metadata } from "next";

import { Message } from "#components/message";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";

import { ResetPasswordForm } from "./_components/reset-password-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const messages = await loadPlatformMessages(await getPlatformLocale());

  return { title: getMessage(messages, "platform.auth.reset_password.title") };
};

const ResetPasswordPage = () => (
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="font-serif text-2xl font-semibold">Publira</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          <Message
            message="platform.auth.reset_password.description"
            skeletonClassName="w-full"
          />
        </p>
      </div>

      <ResetPasswordForm
        copy={{
          emailLabel: (
            <Message
              message="platform.auth.fields.email_label"
              skeletonClassName="w-28"
            />
          ),
          pendingLabel: (
            <Message
              message="platform.auth.reset_password.pending"
              skeletonClassName="w-16"
            />
          ),
          submitLabel: (
            <Message
              message="platform.auth.reset_password.submit"
              skeletonClassName="w-32"
            />
          ),
          toLogin: (
            <Message
              message="platform.auth.reset_password.to_login"
              skeletonClassName="w-32"
            />
          ),
        }}
      />
    </div>
  </main>
);

export default ResetPasswordPage;
