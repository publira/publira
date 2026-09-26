"use client";

import { toIntlLocale } from "@publira/i18n";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { useId } from "react";

import { useAdminLocale } from "#components/admin-locale-context";
import { ClientMessage } from "#components/client-message";
import {
  MAX_CREDIT_SHARE_BPS,
  formatShareBps,
  sharePercentToBps,
} from "#lib/credit-share";
import type { CreditShareTotal } from "#lib/credit-share";

/**
 * The share box on one credit row. It holds the text as typed, so a half-typed
 * `33.` stays on screen instead of being rewritten under the cursor; the list
 * parses it when it sums and when it posts.
 */
export const CreditShareInput = ({
  onChange,
  position,
  value,
}: {
  onChange: (nextValue: string) => void;
  position: number;
  value: string;
}) => {
  const id = useId();

  return (
    <Field className="w-28 shrink-0">
      <FieldLabel className="sr-only" htmlFor={id}>
        <ClientMessage
          message="admin.series.form.creators_share_field_label"
          values={{ position: String(position) }}
        />
      </FieldLabel>
      <FieldContent>
        <div className="flex items-center gap-1.5">
          <Input
            aria-invalid={sharePercentToBps(value) === undefined}
            className="text-right tabular-nums"
            id={id}
            inputMode="decimal"
            onChange={(event) => onChange(event.currentTarget.value)}
            placeholder="0"
            value={value}
          />
          <span aria-hidden="true" className="text-sm text-muted-foreground">
            %
          </span>
        </div>
      </FieldContent>
    </Field>
  );
};

/**
 * What the shares add up to, as the editor types: the authors' total and the
 * publisher's remainder, or why the list cannot be saved yet.
 */
export const CreditShareSummary = ({ total }: { total: CreditShareTotal }) => {
  const locale = useAdminLocale();
  const intlLocale = toIntlLocale(locale);
  const format = (bps: number) => formatShareBps(bps, intlLocale);

  if (total.hasInvalid) {
    return (
      <div aria-live="polite">
        <FormMessage variant="destructive">
          <ClientMessage message="admin.series.form.creators_share_invalid" />
        </FormMessage>
      </div>
    );
  }
  if (total.totalBps > MAX_CREDIT_SHARE_BPS) {
    return (
      <div aria-live="polite">
        <FormMessage variant="destructive">
          <ClientMessage
            message="admin.series.form.creators_share_over"
            values={{
              excess: format(total.totalBps - MAX_CREDIT_SHARE_BPS),
              total: format(total.totalBps),
            }}
          />
        </FormMessage>
      </div>
    );
  }
  return (
    <p aria-live="polite" className="text-sm text-foreground tabular-nums">
      <ClientMessage
        message="admin.series.form.creators_share_summary"
        values={{
          publisher: format(MAX_CREDIT_SHARE_BPS - total.totalBps),
          total: format(total.totalBps),
        }}
      />
    </p>
  );
};
