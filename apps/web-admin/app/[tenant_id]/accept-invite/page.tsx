import { getMessage } from "@publira/i18n";
import { FormMessage } from "@publira/ui-components/form-message";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getTenantAdminInvitationState } from "#lib/admin-auth";
import { getLocale, loadAdminMessages } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

import { AcceptInviteForm } from "./_components/accept-invite-form";
import { parseAcceptInviteSearchParams } from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadAdminMessages(locale);

  return { title: getMessage(messages, "admin.auth.accept_invite.title") };
};

interface AcceptInvitePageProps {
  params: Promise<{ tenant_id: string }>;
  searchParams: Promise<{
    token?: string;
  }>;
}

const AcceptInviteFormContent = async ({ token }: { token: string }) => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const messages = await loadAdminMessages(locale);
  const invitation = await getTenantAdminInvitationState(tenantId, token);

  if (!invitation) {
    return (
      <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
        <FormMessage variant="destructive">
          {getMessage(messages, "admin.auth.accept_invite.not_found")}
        </FormMessage>
        <div className="text-center text-sm">
          <Link
            className="font-medium text-primary hover:underline"
            href="/login"
          >
            {getMessage(messages, "admin.auth.confirm_email.to_login")}
          </Link>
        </div>
      </div>
    );
  }

  if (invitation.status !== "pending") {
    let statusMessage:
      | "admin.auth.accept_invite.accepted"
      | "admin.auth.accept_invite.canceled"
      | "admin.auth.accept_invite.expired" = "admin.auth.accept_invite.expired";
    if (invitation.status === "canceled") {
      statusMessage = "admin.auth.accept_invite.canceled";
    } else if (invitation.status === "accepted") {
      statusMessage = "admin.auth.accept_invite.accepted";
    }

    return (
      <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
        <FormMessage variant="destructive">
          {getMessage(messages, statusMessage)}
        </FormMessage>
        <div className="text-center text-sm">
          <Link
            className="font-medium text-primary hover:underline"
            href="/login"
          >
            {getMessage(messages, "admin.auth.confirm_email.to_login")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <p className="text-sm text-muted-foreground">
        {getMessage(messages, "admin.auth.accept_invite.email_invited", {
          email: invitation.email,
        })}
      </p>

      <AcceptInviteForm
        accountExists={invitation.accountExists}
        email={invitation.email}
        tenantId={tenantId}
        token={token}
      />
    </div>
  );
};

const AcceptInvitePageContent = async ({
  searchParams,
}: Pick<AcceptInvitePageProps, "searchParams">) => {
  const { token } = parseAcceptInviteSearchParams(await searchParams);

  if (!token) {
    return (
      <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
        <FormMessage variant="destructive">
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="admin.auth.accept_invite.invalid_token" />
          </Suspense>
        </FormMessage>
        <div className="text-center text-sm">
          <Link
            className="font-medium text-primary hover:underline"
            href="/login"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message message="admin.auth.confirm_email.to_login" />
            </Suspense>
          </Link>
        </div>
      </div>
    );
  }

  return <AcceptInviteFormContent token={token} />;
};

const AcceptInviteFallback = () => <Skeleton className="h-40 w-full" />;

const AcceptInvitePage = ({ searchParams }: AcceptInvitePageProps) => (
  <main className="flex min-h-dvh items-center justify-center px-4 py-10">
    <div className="w-full max-w-md space-y-6">
      <div className="text-center">
        <h1 className="font-serif text-2xl font-semibold">
          <Suspense fallback={<SkeletonLine className="mx-auto h-7 w-48" />}>
            <Message message="admin.auth.accept_invite.title" />
          </Suspense>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="admin.auth.accept_invite.description" />
          </Suspense>
        </p>
      </div>

      <Suspense fallback={<AcceptInviteFallback />}>
        <AcceptInvitePageContent searchParams={searchParams} />
      </Suspense>
    </div>
  </main>
);

export default AcceptInvitePage;
