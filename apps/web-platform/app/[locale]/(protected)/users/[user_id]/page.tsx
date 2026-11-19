import * as ConsolePage from "@publira/layouts/admin/console-page";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import { Badge } from "@publira/ui-components/badge";
import { LinkButton } from "@publira/ui-components/button";
import * as ConfirmDialog from "@publira/ui-components/confirm-dialog";
import * as Field from "@publira/ui-components/field";
import * as Identifier from "@publira/ui-components/identifier";
import * as SectionError from "@publira/ui-components/section-error";
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

import * as DangerConfirmButton from "#components/danger-confirm-button";
import { Message } from "#components/message";
import { verifyPlatformSession } from "#lib/auth-session";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getPlatformDisplayTimeZone } from "#lib/platform-settings";
import { canManageEndUsers } from "#lib/roles";
import { getEndUserStatusLabel, getEndUserStatusTone } from "#lib/user-labels";
import { getPlatformEndUser } from "#lib/users";

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
  <ConsolePage.Content>
    <div className="grid gap-10 xl:grid-cols-[minmax(0,1.3fr)_minmax(18rem,1fr)]">
      <ConsoleSection.Root>
        <SkeletonLine className="h-5 w-28" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </ConsoleSection.Root>
      <ConsoleSection.Root>
        <SkeletonLine className="h-5 w-28" />
        <Skeleton className="h-16" />
      </ConsoleSection.Root>
    </div>
  </ConsolePage.Content>
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
  <SectionError.Root>
    <SectionError.Heading>
      <SectionError.Title>{title}</SectionError.Title>
      <SectionError.Description>{message}</SectionError.Description>
    </SectionError.Heading>
    <SectionError.Actions>
      <LinkButton render={<Link href="/users" />} variant="outline">
        {backLabel}
      </LinkButton>
    </SectionError.Actions>
  </SectionError.Root>
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

  const [t, userResult, currentOperator, timeZone] = await Promise.all([
    getMessagesFor(locale),
    getPlatformEndUser(userPublicId),
    verifyPlatformSession(),
    getPlatformDisplayTimeZone(),
  ]);

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

  const canManage = canManageEndUsers(currentOperator.role);
  const canSuspend = canManage && user.status === "active";
  const canUnsuspend = canManage && user.status === "suspended";
  const canDelete = canManage;
  const cancelText = t("platform.common.cancel");

  return (
    <>
      <ConsolePage.Header>
        <ConsolePage.Heading>
          <ConsolePage.Title>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message
                message="platform.users.detail_title"
                values={{
                  name: user.name || user.publicId,
                }}
              />
            </Suspense>
          </ConsolePage.Title>
          <ConsolePage.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="platform.users.detail_description" />
            </Suspense>
          </ConsolePage.Description>
        </ConsolePage.Heading>
        <ConsolePage.Actions>
          <LinkButton render={<Link href="/users" />} variant="outline">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="platform.common.back_to_list" />
            </Suspense>
          </LinkButton>
          {canUnsuspend ? (
            <DangerConfirmButton.Root
              actionArg={user.id}
              actionCreator={unsuspendEndUserAction}
            >
              <DangerConfirmButton.Trigger variant="outline">
                {t("platform.users.unsuspend")}
              </DangerConfirmButton.Trigger>
              <ConfirmDialog.Content>
                <ConfirmDialog.Header>
                  <ConfirmDialog.Title>
                    {t("platform.users.unsuspend_title")}
                  </ConfirmDialog.Title>
                  <ConfirmDialog.Description>
                    {t("platform.users.unsuspend_description")}
                  </ConfirmDialog.Description>
                </ConfirmDialog.Header>
                <ConfirmDialog.Footer>
                  <ConfirmDialog.Cancel>{cancelText}</ConfirmDialog.Cancel>
                  <DangerConfirmButton.Action variant="default">
                    {t("platform.users.unsuspend_action")}
                  </DangerConfirmButton.Action>
                </ConfirmDialog.Footer>
              </ConfirmDialog.Content>
            </DangerConfirmButton.Root>
          ) : null}
          {canSuspend ? (
            <DangerConfirmButton.Root
              actionArg={user.id}
              actionCreator={suspendEndUserAction}
            >
              <DangerConfirmButton.Trigger variant="outline">
                {t("platform.users.suspend")}
              </DangerConfirmButton.Trigger>
              <ConfirmDialog.Content>
                <ConfirmDialog.Header>
                  <ConfirmDialog.Title>
                    {t("platform.users.suspend_title")}
                  </ConfirmDialog.Title>
                  <ConfirmDialog.Description>
                    {t("platform.users.suspend_description")}
                  </ConfirmDialog.Description>
                </ConfirmDialog.Header>
                <ConfirmDialog.Footer>
                  <ConfirmDialog.Cancel>{cancelText}</ConfirmDialog.Cancel>
                  <DangerConfirmButton.Action>
                    {t("platform.users.suspend_action")}
                  </DangerConfirmButton.Action>
                </ConfirmDialog.Footer>
              </ConfirmDialog.Content>
            </DangerConfirmButton.Root>
          ) : null}
          {canDelete ? (
            <DangerConfirmButton.Root
              actionArg={user.id}
              actionCreator={deleteEndUserAction}
            >
              <DangerConfirmButton.Trigger>
                {t("platform.users.delete")}
              </DangerConfirmButton.Trigger>
              <ConfirmDialog.Content>
                <ConfirmDialog.Header>
                  <ConfirmDialog.Title>
                    {t("platform.users.delete_title")}
                  </ConfirmDialog.Title>
                  <ConfirmDialog.Description>
                    {t("platform.users.delete_description")}
                  </ConfirmDialog.Description>
                </ConfirmDialog.Header>
                <ConfirmDialog.Footer>
                  <ConfirmDialog.Cancel>{cancelText}</ConfirmDialog.Cancel>
                  <DangerConfirmButton.Action>
                    {t("platform.users.delete_action")}
                  </DangerConfirmButton.Action>
                </ConfirmDialog.Footer>
              </ConfirmDialog.Content>
            </DangerConfirmButton.Root>
          ) : null}
        </ConsolePage.Actions>
      </ConsolePage.Header>
      <ConsolePage.Content>
        <div className="grid gap-10 xl:grid-cols-[minmax(0,1.3fr)_minmax(18rem,1fr)]">
          <ConsoleSection.Root>
            <ConsoleSection.Header>
              <ConsoleSection.Heading>
                <ConsoleSection.Title>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="platform.users.info_title" />
                  </Suspense>
                </ConsoleSection.Title>
                <ConsoleSection.Description>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="platform.users.info_description" />
                  </Suspense>
                </ConsoleSection.Description>
              </ConsoleSection.Heading>
            </ConsoleSection.Header>
            <Field.Root>
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="platform.users.public_id" />
                </Suspense>
              </Field.Label>
              <Identifier.Root>
                <Identifier.Value>{user.publicId}</Identifier.Value>
                <Identifier.Copy
                  aria-label={t("platform.users.copy_public_id")}
                  value={user.publicId}
                />
              </Identifier.Root>
            </Field.Root>
            <Field.Root>
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="platform.users.columns_name" />
                </Suspense>
              </Field.Label>
              <p className="text-sm">
                {user.name || t("platform.common.unset")}
              </p>
            </Field.Root>
            <Field.Root>
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="platform.common.email" />
                </Suspense>
              </Field.Label>
              <p className="text-sm">{user.email}</p>
            </Field.Root>
            <Field.Root>
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="platform.users.registered_at" />
                </Suspense>
              </Field.Label>
              <p className="text-sm">
                {formatDate(user.createdAt, {
                  fallback: t("platform.common.unset"),
                  locale,
                  timeZone,
                })}
              </p>
            </Field.Root>
            <Field.Root>
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="platform.users.status" />
                </Suspense>
              </Field.Label>
              <p>
                <Badge tone={getEndUserStatusTone(user.status)}>
                  {await getEndUserStatusLabel(user.status, locale)}
                </Badge>
              </p>
            </Field.Root>
          </ConsoleSection.Root>

          <ConsoleSection.Root>
            <ConsoleSection.Header>
              <ConsoleSection.Heading>
                <ConsoleSection.Title>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="platform.users.affiliated_title" />
                  </Suspense>
                </ConsoleSection.Title>
                <ConsoleSection.Description>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="platform.users.affiliated_description" />
                  </Suspense>
                </ConsoleSection.Description>
              </ConsoleSection.Heading>
            </ConsoleSection.Header>
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
          </ConsoleSection.Root>
        </div>
      </ConsolePage.Content>
    </>
  );
};

// `ConsolePage.Root` stays in the static shell so the max width and padding are
// painted before `params` resolves; only the header and body stream in.
const UserDetailPage = ({ params }: UserDetailPageProps) => (
  <ConsolePage.Root>
    <Suspense fallback={<UserDetailSkeleton />}>
      <UserDetailContent params={params} />
    </Suspense>
  </ConsolePage.Root>
);

export default UserDetailPage;
