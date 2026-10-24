import * as AuthScreen from "@publira/layouts/auth-screen";
import { FormMessage } from "@publira/ui-components/form-message";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getTenantAdminInvitationState } from "#lib/admin-auth";
import type { TenantAdminInvitationState } from "#lib/admin-auth";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantId } from "#lib/tenant-id";

import { AcceptInviteForm } from "./_components/accept-invite-form";
import { parseAcceptInviteSearchParams } from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.auth.accept_invite.title") };
};

interface AcceptInvitePageProps {
  params: Promise<{ tenant_id: string }>;
  searchParams: Promise<{
    token?: string;
  }>;
}

/**
 * An invitation that cannot be used, and the one way on from it. Every such
 * ending on this screen — no invitation, a spent or cancelled one, a link with
 * no token at all — reads the same way, so they share one body.
 */
const AcceptInviteDeadEnd = ({ children }: { children: ReactNode }) => (
  <>
    <AuthScreen.Body>
      <FormMessage variant="destructive">{children}</FormMessage>
    </AuthScreen.Body>
    <AuthScreen.Footer>
      <p>
        <Link
          className="text-primary underline underline-offset-4"
          href="/login"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <Message message="admin.auth.confirm_email.to_login" />
          </Suspense>
        </Link>
      </p>
    </AuthScreen.Footer>
  </>
);

/**
 * Why an invitation cannot be used. The status decides which sentence is
 * rendered; each branch carries its own key, so none of them is assembled.
 */
const AcceptInviteUnusable = ({
  status,
}: {
  status: TenantAdminInvitationState["status"];
}) => {
  switch (status) {
    case "accepted": {
      return <Message message="admin.auth.accept_invite.accepted" />;
    }
    case "canceled": {
      return <Message message="admin.auth.accept_invite.canceled" />;
    }
    default: {
      return <Message message="admin.auth.accept_invite.expired" />;
    }
  }
};

const AcceptInviteFormContent = async ({ token }: { token: string }) => {
  const tenantId = await getTenantId();
  const invitation = await getTenantAdminInvitationState(tenantId, token);

  if (!invitation) {
    return (
      <AcceptInviteDeadEnd>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="admin.auth.accept_invite.not_found" />
        </Suspense>
      </AcceptInviteDeadEnd>
    );
  }

  if (invitation.status !== "pending") {
    return (
      <AcceptInviteDeadEnd>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <AcceptInviteUnusable status={invitation.status} />
        </Suspense>
      </AcceptInviteDeadEnd>
    );
  }

  return (
    <AuthScreen.Body>
      <AuthScreen.Note>
        <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
          <Message
            message="admin.auth.accept_invite.email_invited"
            values={{ email: invitation.email, role: invitation.role }}
          />
        </Suspense>
      </AuthScreen.Note>

      <AcceptInviteForm
        accountExists={invitation.accountExists}
        email={invitation.email}
        tenantId={tenantId}
        token={token}
      />
    </AuthScreen.Body>
  );
};

const AcceptInvitePageContent = async ({
  searchParams,
}: Pick<AcceptInvitePageProps, "searchParams">) => {
  const { token } = parseAcceptInviteSearchParams(await searchParams);

  if (!token) {
    return (
      <AcceptInviteDeadEnd>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="admin.auth.accept_invite.invalid_token" />
        </Suspense>
      </AcceptInviteDeadEnd>
    );
  }

  return <AcceptInviteFormContent token={token} />;
};

const AcceptInviteFallback = () => (
  <AuthScreen.Body>
    <Skeleton className="h-40 w-full" />
  </AuthScreen.Body>
);

const AcceptInvitePage = ({ searchParams }: AcceptInvitePageProps) => (
  <AuthScreen.Root>
    <AuthScreen.Main>
      <AuthScreen.Header>
        <AuthScreen.Title>
          <Suspense fallback={<SkeletonLine className="h-7 w-48" />}>
            <Message message="admin.auth.accept_invite.title" />
          </Suspense>
        </AuthScreen.Title>
        <AuthScreen.Tagline>
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="admin.auth.accept_invite.description" />
          </Suspense>
        </AuthScreen.Tagline>
      </AuthScreen.Header>

      <Suspense fallback={<AcceptInviteFallback />}>
        <AcceptInvitePageContent searchParams={searchParams} />
      </Suspense>
    </AuthScreen.Main>

    <AuthScreen.Panel>
      <AuthScreen.Pattern />
    </AuthScreen.Panel>
  </AuthScreen.Root>
);

export default AcceptInvitePage;
