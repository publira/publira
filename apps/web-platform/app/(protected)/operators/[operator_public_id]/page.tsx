import { Badge, StatusChip } from "@publira/ui-components/badge";
import { LinkButton } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { Field, FieldLabel } from "@publira/ui-components/field";
import { formatDateTime } from "@publira/utils";
import { getMessage } from "@publira/utils/i18n";
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
  PlatformPage,
  PlatformPageActions,
  PlatformPageContent,
  PlatformPageDescription,
  PlatformPageEyebrow,
  PlatformPageHeader,
  PlatformPageHeading,
  PlatformPageTitle,
} from "#components/platform-page";
import { getPlatformCurrentOperator } from "#lib/auth";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";
import {
  getOperatorRoleCardDescription,
  getOperatorRoleLabel,
  getOperatorStatusLabel,
} from "#lib/operator-labels";
import { getPlatformOperator } from "#lib/operators";
import { getPlatformDisplayTimeZone } from "#lib/platform-settings";
import { isPlatformSuperAdmin } from "#lib/roles";

import { DangerConfirmButton } from "./_components/danger-confirm-button";
import { OperatorRoleForm } from "./_components/operator-role-form";
import {
  deactivateOperatorAction,
  suspendOperatorAction,
  unsuspendOperatorAction,
} from "./_lib/actions";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  return { title: getMessage(messages, "platform.operators.detail_metadata") };
};

interface OperatorDetailPageProps {
  params: Promise<{
    operator_public_id: string;
  }>;
}

const operatorDetailParamsSchema = z.object({
  operator_public_id: routeParamString(),
});

const OperatorDetailSkeleton = () => (
  <PlatformPageContent>
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(18rem,1fr)]">
      <Card>
        <CardHeader>
          <div className="h-5 w-28 animate-pulse rounded bg-muted" />
          <div className="h-4 w-64 animate-pulse rounded bg-muted/70" />
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <div className="h-16 animate-pulse rounded bg-muted/70" />
            <div className="h-16 animate-pulse rounded bg-muted/70" />
            <div className="h-16 animate-pulse rounded bg-muted/70" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div className="h-5 w-28 animate-pulse rounded bg-muted" />
        </CardHeader>
        <CardContent>
          <div className="h-20 animate-pulse rounded bg-muted/70" />
        </CardContent>
      </Card>
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
  const { operator_public_id: operatorPublicId } = parsedParams;

  const locale = await getPlatformLocale();
  const [messages, operator, currentOperatorResult, timeZone] =
    await Promise.all([
      loadPlatformMessages(locale),
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
  const cancelText = getMessage(messages, "platform.common.cancel");

  return (
    <>
      <PlatformPageHeader>
        <PlatformPageHeading>
          <PlatformPageEyebrow>Platform Governance</PlatformPageEyebrow>
          <PlatformPageTitle>
            {getMessage(messages, "platform.operators.detail_title", {
              name: operator.name,
            })}
          </PlatformPageTitle>
          <PlatformPageDescription>
            {getMessage(messages, "platform.operators.detail_description")}
          </PlatformPageDescription>
        </PlatformPageHeading>
        <PlatformPageActions>
          <LinkButton render={<Link href="/operators" />} variant="outline">
            {getMessage(messages, "platform.common.back_to_list")}
          </LinkButton>
          {canUnsuspend ? (
            <DangerConfirmButton
              actionArg={operator.publicId}
              actionCreator={unsuspendOperatorAction}
              actionText={getMessage(
                messages,
                "platform.operators.resume_action"
              )}
              actionVariant="default"
              cancelText={cancelText}
              description={getMessage(
                messages,
                "platform.operators.resume_description"
              )}
              title={getMessage(messages, "platform.operators.resume_title")}
              triggerLabel={getMessage(messages, "platform.operators.resume")}
              triggerVariant="outline"
            />
          ) : null}
          {canSuspend ? (
            <DangerConfirmButton
              actionArg={operator.publicId}
              actionCreator={suspendOperatorAction}
              actionText={getMessage(
                messages,
                "platform.operators.suspend_action"
              )}
              cancelText={cancelText}
              description={getMessage(
                messages,
                "platform.operators.suspend_description"
              )}
              title={getMessage(messages, "platform.operators.suspend_title")}
              triggerLabel={getMessage(messages, "platform.operators.suspend")}
              triggerVariant="outline"
            />
          ) : null}
          {canModify ? (
            <DangerConfirmButton
              actionArg={operator.publicId}
              actionCreator={deactivateOperatorAction}
              actionText={getMessage(
                messages,
                "platform.operators.deactivate_action"
              )}
              cancelText={cancelText}
              description={getMessage(
                messages,
                "platform.operators.deactivate_description"
              )}
              title={getMessage(
                messages,
                "platform.operators.deactivate_title"
              )}
              triggerLabel={getMessage(
                messages,
                "platform.operators.deactivate"
              )}
            />
          ) : null}
        </PlatformPageActions>
      </PlatformPageHeader>
      <PlatformPageContent>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(18rem,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>
                {getMessage(messages, "platform.operators.info_title")}
              </CardTitle>
              <CardDescription>
                {getMessage(messages, "platform.operators.info_description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-4">
                <Field>
                  <FieldLabel>
                    {getMessage(messages, "platform.common.name")}
                  </FieldLabel>
                  <p className="text-sm">{operator.name}</p>
                </Field>
                <Field>
                  <FieldLabel>
                    {getMessage(messages, "platform.common.email")}
                  </FieldLabel>
                  <p className="text-sm">{operator.email}</p>
                </Field>
                <Field>
                  <FieldLabel>
                    {getMessage(messages, "platform.operators.current_role")}
                  </FieldLabel>
                  <p>
                    <Badge tone="info">
                      {getOperatorRoleLabel(operator.role, messages)}
                    </Badge>
                  </p>
                </Field>
                <Field>
                  <FieldLabel>
                    {getMessage(messages, "platform.common.status")}
                  </FieldLabel>
                  <p>
                    <StatusChip
                      status={
                        operator.status === "active" ? "success" : "warning"
                      }
                    >
                      {getOperatorStatusLabel(operator.status, messages)}
                    </StatusChip>
                  </p>
                </Field>
                <Field>
                  <FieldLabel>
                    {getMessage(messages, "platform.common.created_at")}
                  </FieldLabel>
                  <p className="text-sm">
                    {formatDateTime(operator.createdAt, {
                      fallback: getMessage(messages, "platform.common.unset"),
                      locale,
                      timeZone,
                    })}
                  </p>
                </Field>
                <Field>
                  <FieldLabel>
                    {getMessage(messages, "platform.operators.last_login")}
                  </FieldLabel>
                  <p className="text-sm text-muted-foreground">
                    {getMessage(messages, "platform.operators.not_fetched")}
                  </p>
                </Field>
              </div>
            </CardContent>
          </Card>

          {isDeactivated ? null : (
            <Card>
              <CardHeader>
                <CardTitle>
                  {getMessage(messages, "platform.operators.change_role")}
                </CardTitle>
                <CardDescription>
                  {getOperatorRoleCardDescription(
                    { isSelf, isSuperAdmin },
                    messages
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <OperatorRoleForm
                  currentRole={operator.role}
                  disabled={!canModify}
                  operatorPublicId={operator.publicId}
                />
              </CardContent>
            </Card>
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
