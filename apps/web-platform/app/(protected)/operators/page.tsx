import { getMessage } from "@publira/i18n";
import { Badge, StatusChip } from "@publira/ui-components/badge";
import { LinkButton } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { SectionError } from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@publira/ui-components/table";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import { PaginationControls } from "#components/pagination-controls";
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
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";
import {
  getOperatorRoleLabel,
  getOperatorStatusLabel,
} from "#lib/operator-labels";
import { listPlatformOperators } from "#lib/operators";

import {
  buildOperatorsPath,
  parseOperatorsSearchParams,
} from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  return { title: getMessage(messages, "platform.operators.title") };
};

const pageSize = 20;

const OperatorsTableSkeleton = () => (
  <Card>
    <CardHeader>
      <div className="h-5 w-36 animate-pulse rounded bg-muted" />
      <div className="h-4 w-80 animate-pulse rounded bg-muted/70" />
    </CardHeader>
    <CardContent>
      <div className="grid gap-3">
        <div className="h-10 animate-pulse rounded bg-muted/70" />
        <div className="h-10 animate-pulse rounded bg-muted/70" />
        <div className="h-10 animate-pulse rounded bg-muted/70" />
      </div>
    </CardContent>
  </Card>
);

type OperatorsPageProps = PageProps<"/operators">;

const OperatorsContent = async ({
  searchParams,
}: Pick<OperatorsPageProps, "searchParams">) => {
  const [locale, rawSearchParams] = await Promise.all([
    getPlatformLocale(),
    searchParams,
  ]);
  const { token } = parseOperatorsSearchParams(rawSearchParams);
  const [messages, result] = await Promise.all([
    loadPlatformMessages(locale),
    listPlatformOperators({
      limit: pageSize,
      locale,
      token,
    }),
  ]);

  await redirectToLoginIfSessionRejected(result);

  const previousHref = result.previousToken
    ? buildOperatorsPath({ token: result.previousToken })
    : undefined;
  const nextHref = result.nextToken
    ? buildOperatorsPath({ token: result.nextToken })
    : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {getMessage(messages, "platform.operators.list_card_title")}
        </CardTitle>
        <CardDescription>
          {getMessage(messages, "platform.operators.list_card_description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {result.ok ? null : (
          <SectionError
            description={result.message}
            title={getMessage(messages, "platform.operators.load_failed")}
          />
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                {getMessage(messages, "platform.operators.columns_name")}
              </TableHead>
              <TableHead>
                {getMessage(messages, "platform.operators.columns_email")}
              </TableHead>
              <TableHead className="w-48">
                {getMessage(messages, "platform.operators.columns_role")}
              </TableHead>
              <TableHead className="w-36">
                {getMessage(messages, "platform.operators.columns_status")}
              </TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.ok && result.operators.length === 0 ? (
              <TableRow>
                <TableCell className="text-muted-foreground" colSpan={5}>
                  {getMessage(messages, "platform.operators.empty")}
                </TableCell>
              </TableRow>
            ) : null}
            {result.ok &&
              result.operators.map((operator) => (
                <TableRow key={operator.publicId || operator.email}>
                  <TableCell>
                    <div className="grid gap-1">
                      <p className="font-medium text-foreground">
                        {operator.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {operator.publicId}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>{operator.email}</TableCell>
                  <TableCell>
                    <Badge tone="info">
                      {getOperatorRoleLabel(operator.role, messages)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <StatusChip
                      status={
                        operator.status === "active" ? "success" : "warning"
                      }
                    >
                      {getOperatorStatusLabel(operator.status, messages)}
                    </StatusChip>
                  </TableCell>
                  <TableCell>
                    <LinkButton
                      render={<Link href={`/operators/${operator.publicId}`} />}
                      size="sm"
                      variant="outline"
                    >
                      {getMessage(messages, "platform.common.detail")}
                    </LinkButton>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>

        <PaginationControls
          ariaLabel={getMessage(messages, "platform.operators.pagination_aria")}
          nextHref={nextHref}
          nextLabel={getMessage(messages, "platform.common.next")}
          previousHref={previousHref}
          previousLabel={getMessage(messages, "platform.common.previous")}
        />
      </CardContent>
    </Card>
  );
};

const OperatorsPage = ({ searchParams }: OperatorsPageProps) => (
  <PlatformPage>
    <PlatformPageHeader>
      <PlatformPageHeading>
        <PlatformPageEyebrow>Platform Governance</PlatformPageEyebrow>
        <PlatformPageTitle>
          <Suspense fallback={<SkeletonLine className="h-8 w-40" />}>
            <Message message="platform.operators.title" />
          </Suspense>
        </PlatformPageTitle>
        <PlatformPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
            <Message message="platform.operators.page_description" />
          </Suspense>
        </PlatformPageDescription>
      </PlatformPageHeading>
      <PlatformPageActions>
        <LinkButton render={<Link href="/operators/new" />}>
          <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
            <Message message="platform.operators.add" />
          </Suspense>
        </LinkButton>
      </PlatformPageActions>
    </PlatformPageHeader>
    <PlatformPageContent>
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
            <Message message="platform.operators.load_failed" />
          </Suspense>
        }
      >
        <Suspense fallback={<OperatorsTableSkeleton />}>
          <OperatorsContent searchParams={searchParams} />
        </Suspense>
      </SectionErrorBoundary>
    </PlatformPageContent>
  </PlatformPage>
);

export default OperatorsPage;
