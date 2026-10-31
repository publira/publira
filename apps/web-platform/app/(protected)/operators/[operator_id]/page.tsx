import * as ConsolePage from "@publira/layouts/admin/console-page";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import { Badge, StatusChip } from "@publira/ui-components/badge";
import { LinkButton } from "@publira/ui-components/button";
import * as ConfirmDialog from "@publira/ui-components/confirm-dialog";
import * as Field from "@publira/ui-components/field";
import * as SectionError from "@publira/ui-components/section-error";
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

import * as DangerConfirmButton from "#components/danger-confirm-button";
import { Message } from "#components/message";
import { verifyPlatformSession } from "#lib/auth-session";
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
  <ConsolePage.Content>
    <div className="grid gap-10 xl:grid-cols-[minmax(0,1.45fr)_minmax(18rem,1fr)]">
      <ConsoleSection.Root>
        <SkeletonLine className="h-5 w-28" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </ConsoleSection.Root>
      <ConsoleSection.Root>
        <SkeletonLine className="h-5 w-28" />
        <Skeleton className="h-20" />
      </ConsoleSection.Root>
    </div>
  </ConsolePage.Content>
);

/**
 * A read that failed is not an operator that is missing. Collapsing the two
 * into `notFound()` would tell the operator to stop looking for an account
 * that is still there, so an outage keeps the console's own wording and a way
 * back.
 */
const OperatorLoadError = ({ message }: { message: string }) => (
  <SectionError.Root>
    <SectionError.Heading>
      <SectionError.Title>
        <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
          <Message message="platform.operators.load_one_failed" />
        </Suspense>
      </SectionError.Title>
      <SectionError.Description>{message}</SectionError.Description>
    </SectionError.Heading>
    <SectionError.Actions>
      <LinkButton render={<Link href="/operators" />} variant="outline">
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="platform.common.back_to_list" />
        </Suspense>
      </LinkButton>
    </SectionError.Actions>
  </SectionError.Root>
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

  const [t, operatorResult, currentOperator, timeZone] = await Promise.all([
    getMessagesFor(locale),
    getPlatformOperator(operatorPublicId),
    verifyPlatformSession(),
    getPlatformDisplayTimeZone(),
  ]);

  if (!operatorResult.ok) {
    return <OperatorLoadError message={operatorResult.message} />;
  }

  const { operator } = operatorResult;

  if (!operator) {
    notFound();
  }

  const isSelf = currentOperator.publicId === operator.publicId;
  const isSuperAdmin = isPlatformSuperAdmin(currentOperator.role);
  const isDeactivated = operator.status === "inactive";
  const canModify = isSuperAdmin && !isSelf && !isDeactivated;
  const canSuspend = isSuperAdmin && !isSelf && operator.status === "active";

  const canUnsuspend =
    isSuperAdmin && !isSelf && operator.status === "suspended";

  const cancelText = t("platform.common.cancel");

  return (
    <>
      <ConsolePage.Header>
        <ConsolePage.Heading>
          <ConsolePage.Title>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message
                message="platform.operators.detail_title"
                values={{
                  name: operator.name,
                }}
              />
            </Suspense>
          </ConsolePage.Title>
          <ConsolePage.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="platform.operators.detail_description" />
            </Suspense>
          </ConsolePage.Description>
        </ConsolePage.Heading>
        <ConsolePage.Actions>
          <LinkButton render={<Link href="/operators" />} variant="outline">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="platform.common.back_to_list" />
            </Suspense>
          </LinkButton>
          {canUnsuspend ? (
            <DangerConfirmButton.Root
              actionArg={{ id: operator.id, publicId: operator.publicId }}
              actionCreator={unsuspendOperatorAction}
            >
              <DangerConfirmButton.Trigger variant="outline">
                {t("platform.operators.resume")}
              </DangerConfirmButton.Trigger>
              <ConfirmDialog.Content>
                <ConfirmDialog.Header>
                  <ConfirmDialog.Title>
                    {t("platform.operators.resume_title")}
                  </ConfirmDialog.Title>
                  <ConfirmDialog.Description>
                    {t("platform.operators.resume_description")}
                  </ConfirmDialog.Description>
                </ConfirmDialog.Header>
                <ConfirmDialog.Footer>
                  <ConfirmDialog.Cancel>{cancelText}</ConfirmDialog.Cancel>
                  <DangerConfirmButton.Action variant="default">
                    {t("platform.operators.resume_action")}
                  </DangerConfirmButton.Action>
                </ConfirmDialog.Footer>
              </ConfirmDialog.Content>
            </DangerConfirmButton.Root>
          ) : null}
          {canSuspend ? (
            <DangerConfirmButton.Root
              actionArg={{ id: operator.id, publicId: operator.publicId }}
              actionCreator={suspendOperatorAction}
            >
              <DangerConfirmButton.Trigger variant="outline">
                {t("platform.operators.suspend")}
              </DangerConfirmButton.Trigger>
              <ConfirmDialog.Content>
                <ConfirmDialog.Header>
                  <ConfirmDialog.Title>
                    {t("platform.operators.suspend_title")}
                  </ConfirmDialog.Title>
                  <ConfirmDialog.Description>
                    {t("platform.operators.suspend_description")}
                  </ConfirmDialog.Description>
                </ConfirmDialog.Header>
                <ConfirmDialog.Footer>
                  <ConfirmDialog.Cancel>{cancelText}</ConfirmDialog.Cancel>
                  <DangerConfirmButton.Action>
                    {t("platform.operators.suspend_action")}
                  </DangerConfirmButton.Action>
                </ConfirmDialog.Footer>
              </ConfirmDialog.Content>
            </DangerConfirmButton.Root>
          ) : null}
          {canModify ? (
            <DangerConfirmButton.Root
              actionArg={{ id: operator.id, publicId: operator.publicId }}
              actionCreator={deactivateOperatorAction}
            >
              <DangerConfirmButton.Trigger>
                {t("platform.operators.deactivate")}
              </DangerConfirmButton.Trigger>
              <ConfirmDialog.Content>
                <ConfirmDialog.Header>
                  <ConfirmDialog.Title>
                    {t("platform.operators.deactivate_title")}
                  </ConfirmDialog.Title>
                  <ConfirmDialog.Description>
                    {t("platform.operators.deactivate_description")}
                  </ConfirmDialog.Description>
                </ConfirmDialog.Header>
                <ConfirmDialog.Footer>
                  <ConfirmDialog.Cancel>{cancelText}</ConfirmDialog.Cancel>
                  <DangerConfirmButton.Action>
                    {t("platform.operators.deactivate_action")}
                  </DangerConfirmButton.Action>
                </ConfirmDialog.Footer>
              </ConfirmDialog.Content>
            </DangerConfirmButton.Root>
          ) : null}
        </ConsolePage.Actions>
      </ConsolePage.Header>
      <ConsolePage.Content>
        <div className="grid gap-10 xl:grid-cols-[minmax(0,1.45fr)_minmax(18rem,1fr)]">
          <ConsoleSection.Root>
            <ConsoleSection.Header>
              <ConsoleSection.Heading>
                <ConsoleSection.Title>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="platform.operators.info_title" />
                  </Suspense>
                </ConsoleSection.Title>
                <ConsoleSection.Description>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="platform.operators.info_description" />
                  </Suspense>
                </ConsoleSection.Description>
              </ConsoleSection.Heading>
            </ConsoleSection.Header>
            <div className="grid gap-4">
              <Field.Root>
                <Field.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="platform.common.name" />
                  </Suspense>
                </Field.Label>
                <p className="text-sm">{operator.name}</p>
              </Field.Root>
              <Field.Root>
                <Field.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="platform.common.email" />
                  </Suspense>
                </Field.Label>
                <p className="text-sm">{operator.email}</p>
              </Field.Root>
              <Field.Root>
                <Field.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="platform.operators.current_role" />
                  </Suspense>
                </Field.Label>
                <p>
                  <Badge tone="info">
                    {await getOperatorRoleLabel(operator.role, locale)}
                  </Badge>
                </p>
              </Field.Root>
              <Field.Root>
                <Field.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="platform.common.status" />
                  </Suspense>
                </Field.Label>
                <p>
                  <StatusChip
                    status={
                      operator.status === "active" ? "success" : "warning"
                    }
                  >
                    {await getOperatorStatusLabel(operator.status, locale)}
                  </StatusChip>
                </p>
              </Field.Root>
              <Field.Root>
                <Field.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="platform.common.created_at" />
                  </Suspense>
                </Field.Label>
                <p className="text-sm">
                  {formatDateTime(operator.createdAt, {
                    fallback: t("platform.common.unset"),
                    locale,
                    timeZone,
                  })}
                </p>
              </Field.Root>
              <Field.Root>
                <Field.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="platform.operators.last_login" />
                  </Suspense>
                </Field.Label>
                <p className="text-sm text-muted-foreground">
                  <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
                    <Message message="platform.operators.not_fetched" />
                  </Suspense>
                </p>
              </Field.Root>
            </div>
          </ConsoleSection.Root>

          {isDeactivated ? null : (
            <ConsoleSection.Root>
              <ConsoleSection.Header>
                <ConsoleSection.Heading>
                  <ConsoleSection.Title>
                    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                      <Message message="platform.operators.change_role" />
                    </Suspense>
                  </ConsoleSection.Title>
                  <ConsoleSection.Description>
                    {await getOperatorRoleCardDescription(
                      { isSelf, isSuperAdmin },
                      locale
                    )}
                  </ConsoleSection.Description>
                </ConsoleSection.Heading>
              </ConsoleSection.Header>
              <OperatorRoleForm
                currentRole={operator.role}
                disabled={!canModify}
                operatorId={operator.id}
                operatorPublicId={operator.publicId}
              />
            </ConsoleSection.Root>
          )}
        </div>
      </ConsolePage.Content>
    </>
  );
};

// `ConsolePage.Root` stays in the static shell so the max width and padding are
// painted before `params` resolves; only the header and body stream in.
const OperatorDetailPage = ({ params }: OperatorDetailPageProps) => (
  <ConsolePage.Root>
    <Suspense fallback={<OperatorDetailSkeleton />}>
      <OperatorDetailContent params={params} />
    </Suspense>
  </ConsolePage.Root>
);

export default OperatorDetailPage;
