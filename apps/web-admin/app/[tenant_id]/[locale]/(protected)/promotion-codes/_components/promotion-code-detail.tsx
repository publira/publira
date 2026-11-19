import type { Locale } from "@publira/i18n";
import { LinkButton } from "@publira/ui-components/button";
import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDateTime } from "@publira/utils";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getMessagesFor } from "#lib/messages";
import { getPromotionCode } from "#lib/promotion-code";
import { promotionCodeStatus } from "#lib/promotion-code-shared";

import type { PromotionCodeParams } from "../_lib/search-params";
import { promotionCodeListQuery } from "../_lib/search-params";
import { PromotionCodeDeleteButton } from "./promotion-code-delete-button";
import { PromotionCodeEditForm } from "./promotion-code-edit-form";
import { PromotionCodePauseButton } from "./promotion-code-pause-button";
import { PromotionCodeRedemptions } from "./promotion-code-redemptions";
import {
  PromotionCodeStatusChip,
  PromotionCodeTargetName,
  promotionCodeDiscountLabel,
  promotionCodeRedemptionsLabel,
  promotionCodeWindowLabel,
} from "./promotion-code-terms";

interface PromotionCodeDetailProps {
  locale: Locale;
  /** The instant the code's status is read against. */
  now: Temporal.Instant;
  params: PromotionCodeParams;
  tenantId: string;
  timeZone: string;
}

const labelClassName = "text-sm text-muted-foreground";
const valueClassName = "min-w-0 text-sm";

/**
 * One code, read on its own so that a link to it opens even when it is not on
 * the page of the list behind the drawer: its terms, what can be done to it,
 * and the purchases it discounted. With `edit` set, the drawer holds the form
 * that changes its window and limits instead.
 */
export const PromotionCodeDetail = async ({
  locale,
  now,
  params,
  tenantId,
  timeZone,
}: PromotionCodeDetailProps) => {
  const [t, result] = await Promise.all([
    getMessagesFor(locale),
    getPromotionCode(tenantId, params.code, locale),
  ]);

  await redirectToLoginIfSessionRejected(result);

  if (!result.ok) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.promotion_codes.detail_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>{result.message}</SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  const { code } = result;

  if (!code) {
    return (
      <p className="text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
          <Message message="admin.promotion_codes.not_found" />
        </Suspense>
      </p>
    );
  }

  const termsHref = promotionCodeListQuery({
    code: code.id,
    token: params.token,
  });

  if (params.edit) {
    return (
      <PromotionCodeEditForm
        cancelHref={termsHref}
        code={code}
        listToken={params.token}
        tenantId={tenantId}
        timeZone={timeZone}
      />
    );
  }

  const displayCode = code.code.toUpperCase();
  const ended = promotionCodeStatus(code, now) === "ended";

  return (
    <div className="grid gap-6">
      <div className="grid gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-lg font-semibold">{displayCode}</span>
          <PromotionCodeStatusChip code={code} now={now} />
        </div>

        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <dt className={labelClassName}>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.promotion_codes.columns.discount" />
            </Suspense>
          </dt>
          <dd className={`${valueClassName} tabular-nums`}>
            {promotionCodeDiscountLabel(code, t, locale)}
          </dd>

          <dt className={labelClassName}>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.promotion_codes.columns.target" />
            </Suspense>
          </dt>
          <dd className={valueClassName}>
            <PromotionCodeTargetName target={code.target} />
          </dd>

          <dt className={labelClassName}>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.promotion_codes.columns.window" />
            </Suspense>
          </dt>
          <dd className={`${valueClassName} tabular-nums`}>
            {promotionCodeWindowLabel(code, t, { locale, timeZone })}
          </dd>

          <dt className={labelClassName}>
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.promotion_codes.columns.redemptions" />
            </Suspense>
          </dt>
          <dd className={`${valueClassName} tabular-nums`}>
            {promotionCodeRedemptionsLabel(code, t)}
          </dd>

          <dt className={labelClassName}>
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.promotion_codes.per_reader" />
            </Suspense>
          </dt>
          <dd className={`${valueClassName} tabular-nums`}>
            {code.maxRedemptionsPerReader > 0 ? (
              t("admin.promotion_codes.per_reader_limit", {
                limit: code.maxRedemptionsPerReader,
              })
            ) : (
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.promotion_codes.no_limit" />
              </Suspense>
            )}
          </dd>

          {code.pausedAt ? (
            <>
              <dt className={labelClassName}>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.promotion_codes.paused_at" />
                </Suspense>
              </dt>
              <dd className={`${valueClassName} tabular-nums`}>
                {formatDateTime(code.pausedAt, { locale, timeZone })}
              </dd>
            </>
          ) : null}

          <dt className={labelClassName}>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.promotion_codes.created_at" />
            </Suspense>
          </dt>
          <dd className={`${valueClassName} tabular-nums`}>
            {formatDateTime(code.createdAt, { locale, timeZone })}
          </dd>
        </dl>

        <div className="flex flex-wrap items-start gap-2">
          <LinkButton
            render={
              <Link
                href={promotionCodeListQuery({
                  code: code.id,
                  edit: true,
                  token: params.token,
                })}
                scroll={false}
              />
            }
            variant="outline"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-10" />}>
              <Message message="admin.promotion_codes.edit" />
            </Suspense>
          </LinkButton>
          {/* A code past its end opens nothing however it is set, so it has
              nothing to pause; its window can still be moved with Edit. */}
          {ended ? null : (
            <PromotionCodePauseButton
              codeId={code.id}
              paused={Boolean(code.pausedAt)}
              tenantId={tenantId}
            />
          )}
          <PromotionCodeDeleteButton
            code={displayCode}
            codeId={code.id}
            listToken={params.token}
            tenantId={tenantId}
          />
        </div>
      </div>

      <PromotionCodeRedemptions
        codeId={code.id}
        locale={locale}
        params={params}
        tenantId={tenantId}
        timeZone={timeZone}
      />
    </div>
  );
};
