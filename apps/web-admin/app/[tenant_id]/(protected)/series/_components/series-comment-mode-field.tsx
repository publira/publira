"use client";

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Select } from "@publira/ui-components/select";
import { useCallback, useContext, useId, useMemo } from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
import { ClientMessage, useClientMessages } from "#components/client-message";
import { isSeriesCommentMode } from "#lib/series-comment-mode";
import type { SeriesCommentMode } from "#lib/series-comment-mode";
import type { TenantCommentMode } from "#lib/tenant-comment-settings-shared";

/**
 * The option that leaves the series following its tenant, naming what the
 * tenant currently publishes comments under.
 *
 * Its own component because that label is one catalog string written into
 * another, which needs the catalog itself rather than a `<ClientMessage>`.
 */
const TenantDefaultOptionLabel = ({
  tenantCommentMode,
}: {
  tenantCommentMode: TenantCommentMode;
}) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const t = useClientMessages();

  // The tenant's own wording is written into another message, so each branch
  // names its key here rather than behind a helper the accessor cannot reach.
  const tenantModeLabel = (): string => {
    if (tenantCommentMode === "disabled") {
      return t("admin.series.form.comment_mode_options.disabled");
    }
    if (tenantCommentMode === "immediate") {
      return t("admin.series.form.comment_mode_options.immediate");
    }

    return t("admin.series.form.comment_mode_options.approval_required");
  };

  return t("admin.series.form.comment_mode_options.tenant_default_known", {
    mode: tenantModeLabel(),
  });
};

/**
 * The three modes a series may state instead of its tenant's, in the order the
 * settings card offers them: off, then the two ways of being on.
 */
const SERIES_COMMENT_MODE_ITEMS = [
  {
    label: (
      <ClientMessage message="admin.series.form.comment_mode_options.disabled" />
    ),
    value: "disabled",
  },
  {
    label: (
      <ClientMessage message="admin.series.form.comment_mode_options.immediate" />
    ),
    value: "immediate",
  },
  {
    label: (
      <ClientMessage message="admin.series.form.comment_mode_options.approval_required" />
    ),
    value: "approval_required",
  },
];

export const SeriesCommentModeField = ({
  onChange,
  tenantCommentMode,
  value,
}: {
  onChange: (next: SeriesCommentMode) => void;
  /**
   * What the tenant publishes comments under, for the option that follows it.
   * Absent when that read failed, and the option then says only that it
   * follows the tenant — a wrong mode named there would be read as the
   * tenant's own choice.
   */
  tenantCommentMode?: TenantCommentMode;
  value: SeriesCommentMode;
}) => {
  // `Select` renders a trigger rather than a Field control, so the label needs
  // an id to point at.
  const selectId = useId();

  const items = useMemo(
    () => [
      {
        label:
          tenantCommentMode === undefined ? (
            <ClientMessage message="admin.series.form.comment_mode_options.tenant_default" />
          ) : (
            <TenantDefaultOptionLabel tenantCommentMode={tenantCommentMode} />
          ),
        value: "",
      },
      ...SERIES_COMMENT_MODE_ITEMS,
    ],
    [tenantCommentMode]
  );

  const handleValueChange = useCallback(
    (next: string) => {
      // The trigger only ever offers the four above; the guard is what keeps
      // the state's type honest without a cast.
      if (isSeriesCommentMode(next)) {
        onChange(next);
      }
    },
    [onChange]
  );

  return (
    <Field>
      <FieldLabel htmlFor={selectId}>
        <ClientMessage message="admin.series.form.comment_mode" />
      </FieldLabel>
      <FieldContent>
        <Select
          id={selectId}
          items={items}
          onValueChange={handleValueChange}
          value={value}
        />
        <input name="comment_mode" type="hidden" value={value} />
        <FieldDescription>
          <ClientMessage message="admin.series.form.comment_mode_description" />
        </FieldDescription>
      </FieldContent>
    </Field>
  );
};
