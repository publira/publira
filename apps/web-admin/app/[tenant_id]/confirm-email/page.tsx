import { getMessage } from "@publira/i18n";
import { LinkButton } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { AdminMessageKey } from "#components/message";
import { confirmAdminEmailChange } from "#lib/admin-auth";
import { getLocale, loadAdminMessages } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

import { parseConfirmEmailSearchParams } from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadAdminMessages(locale);

  return { title: getMessage(messages, "admin.auth.confirm_email.title") };
};

interface ConfirmEmailPageProps {
  params: Promise<{ tenant_id: string }>;
  searchParams: Promise<{
    token?: string;
  }>;
}

const ConfirmationBody = ({
  help,
  message,
  variant,
}: {
  help: AdminMessageKey;
  message: AdminMessageKey;
  variant: "destructive" | "success";
}) => (
  <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
    <FormMessage variant={variant}>
      <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
        <Message message={message} />
      </Suspense>
    </FormMessage>
    <p className="text-sm text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
        <Message message={help} />
      </Suspense>
    </p>
    <div className="flex flex-col gap-3 sm:flex-row">
      <LinkButton className="flex-1" render={<Link href="/login" />}>
        <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
          <Message message="admin.auth.confirm_email.to_login" />
        </Suspense>
      </LinkButton>
    </div>
  </div>
);

const ConfirmationResult = async ({ token }: { token: string }) => {
  const tenantId = await getTenantId();
  if (!token) {
    return (
      <ConfirmationBody
        help="admin.auth.confirm_email.failure_help"
        message="admin.auth.confirm_email.invalid_link"
        variant="destructive"
      />
    );
  }

  const result = await confirmAdminEmailChange(tenantId, token);

  if (!result) {
    return (
      <ConfirmationBody
        help="admin.auth.confirm_email.failure_help"
        message="admin.auth.confirm_email.failed"
        variant="destructive"
      />
    );
  }

  if (result.changed) {
    return (
      <ConfirmationBody
        help="admin.auth.confirm_email.changed_help"
        message="admin.auth.confirm_email.changed"
        variant="success"
      />
    );
  }

  if (result.confirmed) {
    return (
      <ConfirmationBody
        help={
          result.pendingConfirmationFor === "current_email"
            ? "admin.auth.confirm_email.pending_current_email"
            : "admin.auth.confirm_email.pending_new_email"
        }
        message="admin.auth.confirm_email.pending"
        variant="success"
      />
    );
  }

  return (
    <ConfirmationBody
      help="admin.auth.confirm_email.failure_help"
      message="admin.auth.confirm_email.failed"
      variant="destructive"
    />
  );
};

const ConfirmEmailFallback = () => (
  <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
    <Skeleton className="h-5 w-full" />
    <Skeleton className="h-5 w-full" />
    <Skeleton className="h-10 w-full" />
  </div>
);

const ConfirmEmailPageContent = async ({
  searchParams,
}: ConfirmEmailPageProps) => {
  const { token } = parseConfirmEmailSearchParams(await searchParams);

  return <ConfirmationResult token={token} />;
};

const ConfirmEmailPage = ({ params, searchParams }: ConfirmEmailPageProps) => (
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <div className="w-full max-w-md space-y-6">
      <div className="text-center">
        <h1 className="font-serif text-2xl font-semibold">
          <Suspense fallback={<SkeletonLine className="mx-auto h-7 w-48" />}>
            <Message message="admin.auth.confirm_email.title" />
          </Suspense>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
            <Message message="admin.auth.confirm_email.processing" />
          </Suspense>
        </p>
      </div>

      <Suspense fallback={<ConfirmEmailFallback />}>
        <ConfirmEmailPageContent params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  </main>
);

export default ConfirmEmailPage;
