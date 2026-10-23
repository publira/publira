import type { Locale } from "@publira/i18n";
import { StatusChip } from "@publira/ui-components/badge";
import { LinkButton } from "@publira/ui-components/button";
import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
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
      token,
    }),
  ]);

  const previousHref = result.previousToken
    ? buildOperatorsPath({ token: result.previousToken })
    : undefined;
  const nextHref = result.nextToken
    ? buildOperatorsPath({ token: result.nextToken })
    : undefined;

  return (
    <div className="grid gap-4">
      {result.ok ? null : (
        <SectionError.Root>
          <SectionError.Heading>
            <SectionError.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="platform.operators.load_failed" />
              </Suspense>
            </SectionError.Title>
            <SectionError.Description>
              {result.message}
            </SectionError.Description>
          </SectionError.Heading>
        </SectionError.Root>
      )}

      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="platform.operators.columns_name" />
              </Suspense>
            </Table.Head>
            <Table.Head>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="platform.operators.columns_email" />
              </Suspense>
            </Table.Head>
            <Table.Head className="w-48">
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="platform.operators.columns_role" />
              </Suspense>
            </Table.Head>
            <Table.Head className="w-36">
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="platform.operators.columns_status" />
              </Suspense>
            </Table.Head>
            <Table.Head className="w-24" />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {result.ok && result.operators.length === 0 ? (
            <Table.Row>
              <Table.Cell className="text-muted-foreground" colSpan={5}>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="platform.operators.empty" />
                </Suspense>
              </Table.Cell>
            </Table.Row>
          ) : null}
          {result.ok &&
            result.operators.map((operator) => (
              <Table.Row key={operator.publicId || operator.email}>
                <Table.Cell className="font-medium">{operator.name}</Table.Cell>
                <Table.Cell>{operator.email}</Table.Cell>
                <Table.Cell>
                  <OperatorRoleCell locale={locale} role={operator.role} />
                </Table.Cell>
                <Table.Cell>
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
                </Table.Cell>
                <Table.Cell>
                  <LinkButton
                    render={<Link href={`/operators/${operator.publicId}`} />}
                    size="sm"
                    variant="outline"
                  >
                    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                      <Message message="platform.common.detail" />
                    </Suspense>
                  </LinkButton>
                </Table.Cell>
              </Table.Row>
            ))}
        </Table.Body>
      </Table.Root>

      <PaginationControls
        aria-label={t("platform.operators.pagination_aria")}
        nextHref={nextHref}
        previousHref={previousHref}
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
        <Suspense fallback={<Table.Skeleton />}>
          <OperatorsContent searchParams={searchParams} />
        </Suspense>
      </SectionErrorBoundary>
    </PlatformPageContent>
  </PlatformPage>
);

export default OperatorsPage;
