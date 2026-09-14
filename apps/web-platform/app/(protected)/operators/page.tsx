import type { Locale } from "@publira/i18n";
import { StatusChip } from "@publira/ui-components/badge";
import { LinkButton } from "@publira/ui-components/button";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeleton,
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
  PlatformPageHeader,
  PlatformPageHeading,
  PlatformPageTitle,
} from "#components/platform-page";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
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
  const t = await getMessagesFor(locale);

  return { title: t("platform.operators.title") };
};

const pageSize = 20;

type OperatorsPageProps = PageProps<"/operators">;

/**
 * One operator's role and status, each as its own async component: the label
 * is a string the catalog resolves, and a row rendered inside `.map()` cannot
 * await.
 */
const OperatorRoleCell = async ({
  locale,
  role,
}: {
  locale: Locale;
  role: string;
}) => await getOperatorRoleLabel(role, locale);

const OperatorStatusCell = async ({
  locale,
  status,
}: {
  locale: Locale;
  status: string;
}) => await getOperatorStatusLabel(status, locale);

const OperatorsContent = async ({
  searchParams,
}: Pick<OperatorsPageProps, "searchParams">) => {
  const [locale, rawSearchParams] = await Promise.all([
    getPlatformLocale(),
    searchParams,
  ]);
  const { token } = parseOperatorsSearchParams(rawSearchParams);
  const [t, result] = await Promise.all([
    getMessagesFor(locale),
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
    <div className="grid gap-4">
      {result.ok ? null : (
        <SectionError>
          <SectionErrorHeading>
            <SectionErrorTitle>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="platform.operators.load_failed" />
              </Suspense>
            </SectionErrorTitle>
            <SectionErrorDescription>{result.message}</SectionErrorDescription>
          </SectionErrorHeading>
        </SectionError>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="platform.operators.columns_name" />
              </Suspense>
            </TableHead>
            <TableHead>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="platform.operators.columns_email" />
              </Suspense>
            </TableHead>
            <TableHead className="w-48">
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="platform.operators.columns_role" />
              </Suspense>
            </TableHead>
            <TableHead className="w-36">
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="platform.operators.columns_status" />
              </Suspense>
            </TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.ok && result.operators.length === 0 ? (
            <TableRow>
              <TableCell className="text-muted-foreground" colSpan={5}>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="platform.operators.empty" />
                </Suspense>
              </TableCell>
            </TableRow>
          ) : null}
          {result.ok &&
            result.operators.map((operator) => (
              <TableRow key={operator.publicId || operator.email}>
                <TableCell className="font-medium">{operator.name}</TableCell>
                <TableCell>{operator.email}</TableCell>
                <TableCell>
                  <OperatorRoleCell locale={locale} role={operator.role} />
                </TableCell>
                <TableCell>
                  <StatusChip
                    status={
                      operator.status === "active" ? "success" : "warning"
                    }
                    variant="outline"
                  >
                    <OperatorStatusCell
                      locale={locale}
                      status={operator.status}
                    />
                  </StatusChip>
                </TableCell>
                <TableCell>
                  <LinkButton
                    render={<Link href={`/operators/${operator.publicId}`} />}
                    size="sm"
                    variant="outline"
                  >
                    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                      <Message message="platform.common.detail" />
                    </Suspense>
                  </LinkButton>
                </TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>

      <PaginationControls
        ariaLabel={t("platform.operators.pagination_aria")}
        nextHref={nextHref}
        nextLabel={t("platform.common.next")}
        previousHref={previousHref}
        previousLabel={t("platform.common.previous")}
      />
    </div>
  );
};

const OperatorsPage = ({ searchParams }: OperatorsPageProps) => (
  <PlatformPage>
    <PlatformPageHeader>
      <PlatformPageHeading>
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
        <Suspense fallback={<TableSkeleton />}>
          <OperatorsContent searchParams={searchParams} />
        </Suspense>
      </SectionErrorBoundary>
    </PlatformPageContent>
  </PlatformPage>
);

export default OperatorsPage;
