import { Badge, StatusChip } from "@publira/ui-components/badge";
import { LinkButton } from "@publira/ui-components/button";
import {
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from "@publira/ui-components/dialog";
import { Field, FieldLabel } from "@publira/ui-components/field";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDateTime } from "@publira/utils";
import {
  parseRouteParams,
  routeParamString,
} from "@publira/utils/route-params";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

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
import {
  getOperatorRoleCardDescription,
  getOperatorRoleLabel,
  getOperatorStatusLabel,
} from "#lib/operator-labels";
import { getPlatformOperator } from "#lib/operators";
import { getPlatformDisplayTimeZone } from "#lib/platform-settings";
import { isPlatformSuperAdmin } from "#lib/roles";

import {
  DangerConfirmButton,
  DangerConfirmButtonAction,
  DangerConfirmButtonTrigger,
} from "./_components/danger-confirm-button";
import { OperatorRoleForm } from "./_components/operator-role-form";
import {
  deactivateOperatorAction,
  suspendOperatorAction,
  unsuspendOperatorAction,
} from "./_lib/actions";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const t = await getMessagesFor(locale);

  return { title: t("platform.operators.detail_metadata") };
};

interface OperatorDetailPageProps {
  params: Promise<{
    operator_id: string;
  }>;
}

const operatorDetailParamsSchema = z.object({
  operator_id: routeParamString(),
});

const OperatorDetailSkeleton = () => (
  <PlatformPageContent>
    <div className="grid gap-10 xl:grid-cols-[minmax(0,1.45fr)_minmax(18rem,1fr)]">
      <PlatformSection>
        <SkeletonLine className="h-5 w-28" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </PlatformSection>
      <PlatformSection>
        <SkeletonLine className="h-5 w-28" />
        <Skeleton className="h-20" />
      </PlatformSection>
    </div>
  </PlatformPageContent>
);

const OperatorDetailContent = async ({
  params,
}: Pick<OperatorDetailPageProps, "params">) => {
  const parsedParams = parseRouteParams(
    operatorDetailParamsSchema,
    await params
  );
  if (!parsedParams) {
    notFound();
  }
  const { operator_id: operatorPublicId } = parsedParams;

  const locale = await getPlatformLocale();
  const [t, operator, currentOperatorResult, timeZone] = await Promise.all([
    getMessagesFor(locale),
    getPlatformOperator(operatorPublicId, locale),
    getPlatformCurrentOperator(),
    getPlatformDisplayTimeZone(),
  ]);

  // Before `notFound()`: a rejected session reads every record as missing, and
  // a 404 would hide that the operator only needs to sign in again.
  await redirectToLoginIfSessionRejected(currentOperatorResult);

  if (!operator) {
    notFound();
  }

  const currentOperator = currentOperatorResult.ok
    ? currentOperatorResult.operator
    : null;
  const isSelf = currentOperator?.publicId === operator.publicId;
  const isSuperAdmin = isPlatformSuperAdmin(currentOperator?.role);
  const isDeactivated = operator.status === "inactive";
  const canModify = isSuperAdmin && !isSelf && !isDeactivated;
  const canSuspend = isSuperAdmin && !isSelf && operator.status === "active";
  const canUnsuspend =
    isSuperAdmin && !isSelf && operator.status === "suspended";
  const cancelText = t("platform.common.cancel");

  return (
    <>
      <PlatformPageHeader>
        <PlatformPageHeading>
          <PlatformPageTitle>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message
                message="platform.operators.detail_title"
                values={{
                  name: operator.name,
                }}
              />
            </Suspense>
          </PlatformPageTitle>
          <PlatformPageDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="platform.operators.detail_description" />
            </Suspense>
          </PlatformPageDescription>
        </PlatformPageHeading>
        <PlatformPageActions>
          <LinkButton render={<Link href="/operators" />} variant="outline">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="platform.common.back_to_list" />
            </Suspense>
          </LinkButton>
          {canUnsuspend ? (
            <DangerConfirmButton
              actionArg={operator.publicId}
              actionCreator={unsuspendOperatorAction}
            >
              <DangerConfirmButtonTrigger variant="outline">
                {t("platform.operators.resume")}
              </DangerConfirmButtonTrigger>
              <ConfirmDialogContent>
                <ConfirmDialogHeader>
                  <ConfirmDialogTitle>
                    {t("platform.operators.resume_title")}
                  </ConfirmDialogTitle>
                  <ConfirmDialogDescription>
                    {t("platform.operators.resume_description")}
                  </ConfirmDialogDescription>
                </ConfirmDialogHeader>
                <ConfirmDialogFooter>
                  <ConfirmDialogCancel>{cancelText}</ConfirmDialogCancel>
                  <DangerConfirmButtonAction variant="default">
                    {t("platform.operators.resume_action")}
                  </DangerConfirmButtonAction>
                </ConfirmDialogFooter>
              </ConfirmDialogContent>
            </DangerConfirmButton>
          ) : null}
          {canSuspend ? (
            <DangerConfirmButton
              actionArg={operator.publicId}
              actionCreator={suspendOperatorAction}
            >
              <DangerConfirmButtonTrigger variant="outline">
                {t("platform.operators.suspend")}
              </DangerConfirmButtonTrigger>
              <ConfirmDialogContent>
                <ConfirmDialogHeader>
                  <ConfirmDialogTitle>
                    {t("platform.operators.suspend_title")}
                  </ConfirmDialogTitle>
                  <ConfirmDialogDescription>
                    {t("platform.operators.suspend_description")}
                  </ConfirmDialogDescription>
                </ConfirmDialogHeader>
                <ConfirmDialogFooter>
                  <ConfirmDialogCancel>{cancelText}</ConfirmDialogCancel>
                  <DangerConfirmButtonAction>
                    {t("platform.operators.suspend_action")}
                  </DangerConfirmButtonAction>
                </ConfirmDialogFooter>
              </ConfirmDialogContent>
            </DangerConfirmButton>
          ) : null}
          {canModify ? (
            <DangerConfirmButton
              actionArg={operator.publicId}
              actionCreator={deactivateOperatorAction}
            >
              <DangerConfirmButtonTrigger>
                {t("platform.operators.deactivate")}
              </DangerConfirmButtonTrigger>
              <ConfirmDialogContent>
                <ConfirmDialogHeader>
                  <ConfirmDialogTitle>
                    {t("platform.operators.deactivate_title")}
                  </ConfirmDialogTitle>
                  <ConfirmDialogDescription>
                    {t("platform.operators.deactivate_description")}
                  </ConfirmDialogDescription>
                </ConfirmDialogHeader>
                <ConfirmDialogFooter>
                  <ConfirmDialogCancel>{cancelText}</ConfirmDialogCancel>
                  <DangerConfirmButtonAction>
                    {t("platform.operators.deactivate_action")}
                  </DangerConfirmButtonAction>
                </ConfirmDialogFooter>
              </ConfirmDialogContent>
            </DangerConfirmButton>
          ) : null}
        </PlatformPageActions>
      </PlatformPageHeader>
      <PlatformPageContent>
        <div className="grid gap-10 xl:grid-cols-[minmax(0,1.45fr)_minmax(18rem,1fr)]">
          <PlatformSection>
            <PlatformSectionHeader>
              <PlatformSectionHeading>
                <PlatformSectionTitle>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="platform.operators.info_title" />
                  </Suspense>
                </PlatformSectionTitle>
                <PlatformSectionDescription>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="platform.operators.info_description" />
                  </Suspense>
                </PlatformSectionDescription>
              </PlatformSectionHeading>
            </PlatformSectionHeader>
            <div className="grid gap-4">
              <Field>
                <FieldLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="platform.common.name" />
                  </Suspense>
                </FieldLabel>
                <p className="text-sm">{operator.name}</p>
              </Field>
              <Field>
                <FieldLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="platform.common.email" />
                  </Suspense>
                </FieldLabel>
                <p className="text-sm">{operator.email}</p>
              </Field>
              <Field>
                <FieldLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="platform.operators.current_role" />
                  </Suspense>
                </FieldLabel>
                <p>
                  <Badge tone="info">
                    {await getOperatorRoleLabel(operator.role, locale)}
                  </Badge>
                </p>
              </Field>
              <Field>
                <FieldLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="platform.common.status" />
                  </Suspense>
                </FieldLabel>
                <p>
                  <StatusChip
                    status={
                      operator.status === "active" ? "success" : "warning"
                    }
                  >
                    {await getOperatorStatusLabel(operator.status, locale)}
                  </StatusChip>
                </p>
              </Field>
              <Field>
                <FieldLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="platform.common.created_at" />
                  </Suspense>
                </FieldLabel>
                <p className="text-sm">
                  {formatDateTime(operator.createdAt, {
                    fallback: t("platform.common.unset"),
                    locale,
                    timeZone,
                  })}
                </p>
              </Field>
              <Field>
                <FieldLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="platform.operators.last_login" />
                  </Suspense>
                </FieldLabel>
                <p className="text-sm text-muted-foreground">
                  <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
                    <Message message="platform.operators.not_fetched" />
                  </Suspense>
                </p>
              </Field>
            </div>
          </PlatformSection>

          {isDeactivated ? null : (
            <PlatformSection>
              <PlatformSectionHeader>
                <PlatformSectionHeading>
                  <PlatformSectionTitle>
                    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                      <Message message="platform.operators.change_role" />
                    </Suspense>
                  </PlatformSectionTitle>
                  <PlatformSectionDescription>
                    {await getOperatorRoleCardDescription(
                      { isSelf, isSuperAdmin },
                      locale
                    )}
                  </PlatformSectionDescription>
                </PlatformSectionHeading>
              </PlatformSectionHeader>
              <OperatorRoleForm
                currentRole={operator.role}
                disabled={!canModify}
                operatorPublicId={operator.publicId}
              />
            </PlatformSection>
          )}
        </div>
      </PlatformPageContent>
    </>
  );
};

// `PlatformPage` stays in the static shell so the max width and padding are
// painted before `params` resolves; only the header and body stream in.
const OperatorDetailPage = ({ params }: OperatorDetailPageProps) => (
  <PlatformPage>
    <Suspense fallback={<OperatorDetailSkeleton />}>
      <OperatorDetailContent params={params} />
    </Suspense>
  </PlatformPage>
);

export default OperatorDetailPage;
