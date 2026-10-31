"use client";

import { RadioGroup } from "@publira/ui-components/radio-group";
import type { RadioGroupProps } from "@publira/ui-components/radio-group";
import { createContext, use, useState } from "react";
import type { Dispatch, ReactNode } from "react";

import {
  readerIconPolicyClearance,
  TENANT_READER_ICON_POLICIES,
} from "#lib/reader-icon-settings-shared";
import type {
  ReaderIconPolicyClearance,
  TenantReaderIconPolicy,
} from "#lib/reader-icon-settings-shared";

const SelectedPolicyContext = createContext<TenantReaderIconPolicy | undefined>(
  undefined
);

const SelectPolicyContext =
  createContext<Dispatch<TenantReaderIconPolicy> | null>(null);

const ClearanceContext = createContext<ReaderIconPolicyClearance>("none");

const isTenantReaderIconPolicy = (
  value: unknown
): value is TenantReaderIconPolicy =>
  TENANT_READER_ICON_POLICIES.some((policy) => policy === value);

/**
 * Holds the policy the card has selected, and which icons saving it may
 * clear. The radio group below sets it, and {@link ReaderIconPolicySelectionWhenClearing}
 * picks the submit control from it, so a save that may take icons down asks
 * first and one that cannot does not.
 *
 * Only the operator's own choice is state; until they make one the saved
 * policy is selected. The caller keys this by the saved policy, which drops
 * the choice once a save is read back.
 */
const ReaderIconPolicySelection = ({
  children,
  saved,
}: {
  children: ReactNode;
  /** The stored policy, absent when it could not be read. */
  saved: TenantReaderIconPolicy | undefined;
}) => {
  const [choice, setChoice] = useState<TenantReaderIconPolicy>();
  const selected = choice ?? saved;

  const clearance =
    selected === undefined ? "none" : readerIconPolicyClearance(selected);

  return (
    <SelectPolicyContext value={setChoice}>
      <SelectedPolicyContext value={selected}>
        <ClearanceContext value={clearance}>{children}</ClearanceContext>
      </SelectedPolicyContext>
    </SelectPolicyContext>
  );
};

/** The card's radio group, reporting each choice to the selection above it. */
const ReaderIconPolicySelectionRadioGroup = (
  props: Omit<RadioGroupProps, "defaultValue" | "onValueChange" | "value">
) => {
  const selected = use(SelectedPolicyContext);
  const select = use(SelectPolicyContext);

  return (
    <RadioGroup
      {...props}
      onValueChange={(value) => {
        if (isTenantReaderIconPolicy(value)) {
          select?.(value);
        }
      }}
      // An empty value checks no option and keeps the group controlled while
      // the saved policy could not be read.
      value={selected ?? ""}
    />
  );
};

/** Renders its children only while saving would clear `clearance`. */
const ReaderIconPolicySelectionWhenClearing = ({
  children,
  clearance,
}: {
  children: ReactNode;
  clearance: ReaderIconPolicyClearance;
}) => (use(ClearanceContext) === clearance ? children : null);

export {
  ReaderIconPolicySelection as Root,
  ReaderIconPolicySelectionRadioGroup as RadioGroup,
  ReaderIconPolicySelectionWhenClearing as WhenClearing,
};
