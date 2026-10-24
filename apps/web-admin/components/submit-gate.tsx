"use client";

import * as ActionForm from "@publira/ui-components/action-form";
import type { ReactNode } from "react";
import { createContext, use, useMemo, useState } from "react";

interface SubmitGateContextValue {
  submittable: boolean;
  setSubmittable: (submittable: boolean) => void;
}

const SubmitGateContext = createContext<SubmitGateContextValue | null>(null);

const useSubmitGateContext = (caller: string) => {
  const context = use(SubmitGateContext);
  if (!context) {
    throw new Error(`${caller} must be rendered inside a SubmitGate.`);
  }

  return context;
};

/**
 * Carries whether a form can be submitted from the client control that knows
 * to its submit control, which sit apart in a form composed on the server.
 */
const SubmitGate = ({
  children,
  initialSubmittable,
}: {
  children: ReactNode;
  initialSubmittable: boolean;
}) => {
  const [submittable, setSubmittable] = useState(initialSubmittable);
  const value = useMemo(() => ({ setSubmittable, submittable }), [submittable]);

  return <SubmitGateContext value={value}>{children}</SubmitGateContext>;
};

/** Tells the submit control whether the form can be submitted as it stands. */
const useSetSubmittable = () =>
  useSubmitGateContext("useSetSubmittable").setSubmittable;

/** The form's submit control, closed while a control says it cannot be submitted. */
const SubmitGateSubmit = ({ children }: { children: ReactNode }) => {
  const { submittable } = useSubmitGateContext("SubmitGateSubmit");

  return (
    <ActionForm.Submit disabled={!submittable}>{children}</ActionForm.Submit>
  );
};

export { SubmitGate as Root, SubmitGateSubmit as Submit, useSetSubmittable };
