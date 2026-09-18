import { Badge } from "@publira/ui-components/badge";
import { LinkButton } from "@publira/ui-components/button";
import { Field, FieldLabel } from "@publira/ui-components/field";
import {
  SectionError,
  SectionErrorActions,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDate } from "@publira/utils";
import {
  parseRouteParams,
  routeParamString,
} from "@publira/utils/route-params";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import {
  Identifier,
  IdentifierCopy,
  IdentifierValue,
} from "#components/identifier";
import { Message } from "#components/message";
import {
  PlatformPage,
  PlatformPageActions,
  PlatformPageContent,
  PlatformPageDescription,
  PlatformPageHeader,
  PlatformPageHeading,
  PlatformPageTitle,
  PlatformSection,
  PlatformSectionDescription,
  PlatformSectionHeader,
  PlatformSectionHeading,
  PlatformSectionTitle,
} from "#components/platform-page";
import { getPlatformCurrentOperator } from "#lib/auth";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getPlatformDisplayTimeZone } from "#lib/platform-settings";
import { canManageEndUsers } from "#lib/roles";
import { getEndUserStatusLabel, getEndUserStatusTone } from "#lib/user-labels";
import { getPlatformEndUser } from "#lib/users";

import { DangerConfirmButton } from "./_components/danger-confirm-button";
import {
  deleteEndUserAction,
  suspendEndUserAction,
  unsuspendEndUserAction,
} from "./_lib/actions";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const t = await getMessagesFor(locale);

  return { title: t("platform.users.detail_metadata") };
};

interface UserDetailPageProps {
  params: Promise<{
    user_id: string;
  }>;
}

const userDetailParamsSchema = z.object({
  user_id: routeParamString(),
});

const UserDetailSkeleton = () => (
  <PlatformPageContent>
    <div className="grid gap-10 xl:grid-cols-[minmax(0,1.3fr)_minmax(18rem,1fr)]">
      <PlatformSection>
        <SkeletonLine className="h-5 w-28" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </PlatformSection>
      <PlatformSection>
        <SkeletonLine className="h-5 w-28" />
        <Skeleton className="h-16" />
      </PlatformSection>
    </div>
  </PlatformPageContent>
);

/**
 * A read that failed is not a user that is missing. Collapsing the two into
 * `notFound()` would tell the operator to stop looking for an account that is
 * still there, so an outage keeps the console's own wording and a way back.
 */
const UserLoadError = ({
  backLabel,
  message,
  title,
}: {
  backLabel: string;
  message: string;
  title: string;
}) => (
  <SectionError>
    <SectionErrorHeading>
      <SectionErrorTitle>{title}</SectionErrorTitle>
      <SectionErrorDescription>{message}</SectionErrorDescription>
    </SectionErrorHeading>
    <SectionErrorActions>
      <LinkButton render={<Link href="/users" />} variant="outline">
        {backLabel}
      </LinkButton>
    </SectionErrorActions>
  </SectionError>
);

const UserDetailContent = async ({
  params,
}: Pick<UserDetailPageProps, "params">) => {
  const parsedParams = parseRouteParams(userDetailParamsSchema, await params);
  if (!parsedParams) {
    notFound();
  }
  const { user_id: userPublicId } = parsedParams;
  const locale = await getPlatformLocale();
  const [t, userResult, currentOperatorResult, timeZone] = await Promise.all([
    getMessagesFor(locale),
    getPlatformEndUser(userPublicId, locale),
    getPlatformCurrentOperator(),
    getPlatformDisplayTimeZone(),
  ]);

  // Before both branches below: a rejected session reads every record as
  // missing, and a 404 would hide that the operator only needs to sign in again.
  await redirectToLoginIfSessionRejected(userResult, currentOperatorResult);

  if (!userResult.ok) {
    return (
      <UserLoadError
        backLabel={t("platform.common.back_to_list")}
        message={userResult.message}
        title={t("platform.users.load_one_failed")}
      />
    );
  }

  const { user } = userResult;
  if (!user) {
    notFound();
  }
  const canManage = canManageEndUsers(
    currentOperatorResult.ok ? currentOperatorResult.operator.role : undefined
  );
  const canSuspend = canManage && user.status === "active";
  const canUnsuspend = canManage && user.status === "suspended";
  const canDelete = canManage;
  const cancelText = t("platform.common.cancel");

  return (
    <>
      <PlatformPageHeader>
        <PlatformPageHeading>
          <PlatformPageTitle>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message
                message="platform.users.detail_title"
                values={{
                  name: user.name || user.publicId,
                }}
              />
            </Suspense>
          </PlatformPageTitle>
          <PlatformPageDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="platform.users.detail_description" />
            </Suspense>
          </PlatformPageDescription>
        </PlatformPageHeading>
        <PlatformPageActions>
          <LinkButton render={<Link href="/users" />} variant="outline">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="platform.common.back_to_list" />
            </Suspense>
          </LinkButton>
          {canUnsuspend ? (
            <DangerConfirmButton
              actionArg={user.publicId}
              actionCreator={unsuspendEndUserAction}
              actionText={t("platform.users.unsuspend_action")}
              actionVariant="default"
              cancelText={cancelText}
              description={t("platform.users.unsuspend_description")}
              title={t("platform.users.unsuspend_title")}
              triggerLabel={t("platform.users.unsuspend")}
              triggerVariant="outline"
            />
          ) : null}
          {canSuspend ? (
            <DangerConfirmButton
              actionArg={user.publicId}
              actionCreator={suspendEndUserAction}
              actionText={t("platform.users.suspend_action")}
              cancelText={cancelText}
              description={t("platform.users.suspend_description")}
              title={t("platform.users.suspend_title")}
              triggerLabel={t("platform.users.suspend")}
              triggerVariant="outline"
            />
          ) : null}
          {canDelete ? (
            <DangerConfirmButton
              actionArg={user.publicId}
              actionCreator={deleteEndUserAction}
              actionText={t("platform.users.delete_action")}
              cancelText={cancelText}
              description={t("platform.users.delete_description")}
              title={t("platform.users.delete_title")}
              triggerLabel={t("platform.users.delete")}
            />
          ) : null}
        </PlatformPageActions>
      </PlatformPageHeader>
      <PlatformPageContent>
        <div className="grid gap-10 xl:grid-cols-[minmax(0,1.3fr)_minmax(18rem,1fr)]">
          <PlatformSection>
            <PlatformSectionHeader>
              <PlatformSectionHeading>
                <PlatformSectionTitle>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="platform.users.info_title" />
                  </Suspense>
                </PlatformSectionTitle>
                <PlatformSectionDescription>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="platform.users.info_description" />
                  </Suspense>
                </PlatformSectionDescription>
              </PlatformSectionHeading>
            </PlatformSectionHeader>
            <Field>
              <FieldLabel>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="platform.users.public_id" />
                </Suspense>
              </FieldLabel>
              <Identifier>
                <IdentifierValue>{user.publicId}</IdentifierValue>
                <IdentifierCopy
                  aria-label={t("platform.users.copy_public_id")}
                  value={user.publicId}
                />
              </Identifier>
            </Field>
            <Field>
              <FieldLabel>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="platform.users.columns_name" />
                </Suspense>
              </FieldLabel>
              <p className="text-sm">
                {user.name || t("platform.common.unset")}
              </p>
            </Field>
            <Field>
              <FieldLabel>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="platform.common.email" />
                </Suspense>
              </FieldLabel>
              <p className="text-sm">{user.email}</p>
            </Field>
            <Field>
              <FieldLabel>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="platform.users.registered_at" />
                </Suspense>
              </FieldLabel>
              <p className="text-sm">
                {formatDate(user.createdAt, {
                  fallback: t("platform.common.unset"),
                  locale,
                  timeZone,
                })}
              </p>
            </Field>
            <Field>
              <FieldLabel>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="platform.users.status" />
                </Suspense>
              </FieldLabel>
              <p>
                <Badge tone={getEndUserStatusTone(user.status)}>
                  {await getEndUserStatusLabel(user.status, locale)}
                </Badge>
              </p>
            </Field>
          </PlatformSection>

          <PlatformSection>
            <PlatformSectionHeader>
              <PlatformSectionHeading>
                <PlatformSectionTitle>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="platform.users.affiliated_title" />
                  </Suspense>
                </PlatformSectionTitle>
                <PlatformSectionDescription>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="platform.users.affiliated_description" />
                  </Suspense>
                </PlatformSectionDescription>
              </PlatformSectionHeading>
            </PlatformSectionHeader>
            {user.tenantIds.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
                  <Message message="platform.users.affiliated_empty" />
                </Suspense>
              </p>
            ) : (
              <ul className="grid gap-2">
                {user.tenantIds.map((tenantId) => (
                  <li key={tenantId}>
                    <Link
                      className="text-sm text-primary underline-offset-4 hover:underline"
                      href={`/tenants/${tenantId}`}
                    >
                      {tenantId === user.primaryTenantPublicId
                        ? user.primaryTenantName || tenantId
                        : tenantId}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </PlatformSection>
        </div>
      </PlatformPageContent>
    </>
  );
};

// `PlatformPage` stays in the static shell so the max width and padding are
// painted before `params` resolves; only the header and body stream in.
const UserDetailPage = ({ params }: UserDetailPageProps) => (
  <PlatformPage>
    <Suspense fallback={<UserDetailSkeleton />}>
      <UserDetailContent params={params} />
    </Suspense>
  </PlatformPage>
);

export default UserDetailPage;
