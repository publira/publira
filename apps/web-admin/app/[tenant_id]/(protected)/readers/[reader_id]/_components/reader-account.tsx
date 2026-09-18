import type { Locale } from "@publira/i18n";
import { StatusChip } from "@publira/ui-components/badge";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import {
  cn,
  formatDate,
  formatDateTime,
  formatPlainDate,
} from "@publira/utils";
import { Suspense } from "react";

import {
  AdminSection,
  AdminSectionActions,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import { getMessagesFor } from "#lib/messages";

import {
  ReaderStatusMessage,
  readerStatusTone,
} from "../../_components/reader-status-label";
import type { ReaderDetail } from "../../reader-types";
import { ChangeBirthDateButton } from "./change-birth-date-button";
import { DeleteReaderButton } from "./delete-reader-button";
import { Identifier, IdentifierCopy, IdentifierValue } from "./identifier";
import { SuspendReaderButton } from "./suspend-reader-button";
import { UnsuspendReaderButton } from "./unsuspend-reader-button";

interface ReaderAccountProps {
  locale: Locale;
  reader: ReaderDetail;
  tenantId: string;
  timeZone: string;
}

const labelClassName = cn("text-sm text-muted-foreground");
const valueClassName = cn("min-w-0 text-sm");

export const ReaderAccount = async ({
  locale,
  reader,
  tenantId,
  timeZone,
}: ReaderAccountProps) => {
  const t = await getMessagesFor(locale);

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.readers.account_title" />
            </Suspense>
          </AdminSectionTitle>
        </AdminSectionHeading>
        <AdminSectionActions>
          {reader.status === "suspended" ? (
            <UnsuspendReaderButton
              publicId={reader.publicId}
              tenantId={tenantId}
            />
          ) : (
            <SuspendReaderButton
              name={reader.name || reader.email}
              publicId={reader.publicId}
              tenantId={tenantId}
            />
          )}
          <DeleteReaderButton
            name={reader.name || reader.email}
            publicId={reader.publicId}
            tenantId={tenantId}
          />
        </AdminSectionActions>
      </AdminSectionHeader>
      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <dt className={labelClassName}>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="admin.readers.columns.name" />
          </Suspense>
        </dt>
        <dd className={valueClassName}>
          {reader.name || (
            <span className="text-muted-foreground">
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.readers.name_unset" />
              </Suspense>
            </span>
          )}
        </dd>

        <dt className={labelClassName}>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="admin.readers.public_id" />
          </Suspense>
        </dt>
        <dd className={valueClassName}>
          <Identifier>
            <IdentifierValue>{reader.publicId}</IdentifierValue>
            <IdentifierCopy
              aria-label={t("admin.readers.copy_public_id")}
              value={reader.publicId}
            />
          </Identifier>
        </dd>

        <dt className={labelClassName}>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="admin.readers.columns.email" />
          </Suspense>
        </dt>
        <dd className={valueClassName}>{reader.email}</dd>

        <dt className={labelClassName}>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="admin.readers.columns.status" />
          </Suspense>
        </dt>
        <dd className={valueClassName}>
          <StatusChip status={readerStatusTone(reader.status)}>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <ReaderStatusMessage status={reader.status} />
            </Suspense>
          </StatusChip>
        </dd>

        <dt className={labelClassName}>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="admin.readers.columns.created_at" />
          </Suspense>
        </dt>
        <dd className={cn(valueClassName, "tabular-nums")}>
          {reader.createdAt
            ? formatDate(reader.createdAt, { locale, timeZone })
            : "—"}
        </dd>

        <dt className={labelClassName}>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="admin.readers.email_verified" />
          </Suspense>
        </dt>
        <dd className={valueClassName}>
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            {reader.emailVerifiedAt ? (
              <Message
                message="admin.readers.email_verified_at"
                values={{
                  at: formatDateTime(reader.emailVerifiedAt, {
                    locale,
                    timeZone,
                  }),
                }}
              />
            ) : (
              <Message message="admin.readers.email_unverified" />
            )}
          </Suspense>
        </dd>

        <dt className={labelClassName}>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="admin.readers.birth_date" />
          </Suspense>
        </dt>
        <dd className={cn(valueClassName, "flex flex-wrap items-center gap-3")}>
          {reader.birthDate ? (
            <span className="tabular-nums">
              {formatPlainDate(reader.birthDate, { locale })}
            </span>
          ) : (
            <span className="text-muted-foreground">
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.readers.birth_date_not_recorded" />
              </Suspense>
            </span>
          )}
          <ChangeBirthDateButton
            birthDate={reader.birthDate}
            name={reader.name || reader.email}
            publicId={reader.publicId}
            tenantId={tenantId}
          />
        </dd>
      </dl>
    </AdminSection>
  );
};
