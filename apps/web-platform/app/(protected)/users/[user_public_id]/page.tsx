import { getMessage } from "@publira/i18n";
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
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";
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
  const messages = await loadPlatformMessages(locale);

  return { title: getMessage(messages, "platform.users.detail_metadata") };
};

interface UserDetailPageProps {
  params: Promise<{
    user_public_id: string;
  }>;
}

const userDetailParamsSchema = z.object({
  user_public_id: routeParamString(),
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
  const { user_public_id: userPublicId } = parsedParams;
  const locale = await getPlatformLocale();
  const [messages, userResult, currentOperatorResult, timeZone] =
    await Promise.all([
      loadPlatformMessages(locale),
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
        backLabel={getMessage(messages, "platform.common.back_to_list")}
        message={userResult.message}
        title={getMessage(messages, "platform.users.load_one_failed")}
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
  const cancelText = getMessage(messages, "platform.common.cancel");

  return (
    <>
      <PlatformPageHeader>
        <PlatformPageHeading>
          <PlatformPageTitle>
            {getMessage(messages, "platform.users.detail_title", {
              name: user.name || user.publicId,
            })}
          </PlatformPageTitle>
          <PlatformPageDescription>
            {getMessage(messages, "platform.users.detail_description")}
          </PlatformPageDescription>
        </PlatformPageHeading>
        <PlatformPageActions>
          <LinkButton render={<Link href="/users" />} variant="outline">
            {getMessage(messages, "platform.common.back_to_list")}
          </LinkButton>
          {canUnsuspend ? (
            <DangerConfirmButton
              actionArg={user.publicId}
              actionCreator={unsuspendEndUserAction}
              actionText={getMessage(
                messages,
                "platform.users.unsuspend_action"
              )}
              actionVariant="default"
              cancelText={cancelText}
              description={getMessage(
                messages,
                "platform.users.unsuspend_description"
              )}
              title={getMessage(messages, "platform.users.unsuspend_title")}
              triggerLabel={getMessage(messages, "platform.users.unsuspend")}
              triggerVariant="outline"
            />
          ) : null}
          {canSuspend ? (
            <DangerConfirmButton
              actionArg={user.publicId}
              actionCreator={suspendEndUserAction}
              actionText={getMessage(messages, "platform.users.suspend_action")}
              cancelText={cancelText}
              description={getMessage(
                messages,
                "platform.users.suspend_description"
              )}
              title={getMessage(messages, "platform.users.suspend_title")}
              triggerLabel={getMessage(messages, "platform.users.suspend")}
              triggerVariant="outline"
            />
          ) : null}
          {canDelete ? (
            <DangerConfirmButton
              actionArg={user.publicId}
              actionCreator={deleteEndUserAction}
              actionText={getMessage(messages, "platform.users.delete_action")}
              cancelText={cancelText}
              description={getMessage(
                messages,
                "platform.users.delete_description"
              )}
              title={getMessage(messages, "platform.users.delete_title")}
              triggerLabel={getMessage(messages, "platform.users.delete")}
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
                  {getMessage(messages, "platform.users.info_title")}
                </PlatformSectionTitle>
                <PlatformSectionDescription>
                  {getMessage(messages, "platform.users.info_description")}
                </PlatformSectionDescription>
              </PlatformSectionHeading>
            </PlatformSectionHeader>
            <Field>
              <FieldLabel>
                {getMessage(messages, "platform.users.public_id")}
              </FieldLabel>
              <Identifier>
                <IdentifierValue>{user.publicId}</IdentifierValue>
                <IdentifierCopy
                  aria-label={getMessage(
                    messages,
                    "platform.users.copy_public_id"
                  )}
                  value={user.publicId}
                />
              </Identifier>
            </Field>
            <Field>
              <FieldLabel>
                {getMessage(messages, "platform.users.columns_name")}
              </FieldLabel>
              <p className="text-sm">
                {user.name || getMessage(messages, "platform.common.unset")}
              </p>
            </Field>
            <Field>
              <FieldLabel>
                {getMessage(messages, "platform.common.email")}
              </FieldLabel>
              <p className="text-sm">{user.email}</p>
            </Field>
            <Field>
              <FieldLabel>
                {getMessage(messages, "platform.users.registered_at")}
              </FieldLabel>
              <p className="text-sm">
                {formatDate(user.createdAt, {
                  fallback: getMessage(messages, "platform.common.unset"),
                  locale,
                  timeZone,
                })}
              </p>
            </Field>
            <Field>
              <FieldLabel>
                {getMessage(messages, "platform.users.status")}
              </FieldLabel>
              <p>
                <Badge tone={getEndUserStatusTone(user.status)}>
                  {getEndUserStatusLabel(user.status, messages)}
                </Badge>
              </p>
            </Field>
          </PlatformSection>

          <PlatformSection>
            <PlatformSectionHeader>
              <PlatformSectionHeading>
                <PlatformSectionTitle>
                  {getMessage(messages, "platform.users.affiliated_title")}
                </PlatformSectionTitle>
                <PlatformSectionDescription>
                  {getMessage(
                    messages,
                    "platform.users.affiliated_description"
                  )}
                </PlatformSectionDescription>
              </PlatformSectionHeading>
            </PlatformSectionHeader>
            {user.tenantIds.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {getMessage(messages, "platform.users.affiliated_empty")}
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
