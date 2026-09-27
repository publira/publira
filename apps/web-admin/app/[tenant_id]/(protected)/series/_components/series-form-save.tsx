"use client";

import { ActionFormSubmit } from "@publira/ui-components/action-form";
import type { ReactNode } from "react";
import { createContext, use, useMemo, useState } from "react";

interface SeriesFormSaveContextValue {
  savable: boolean;
  setSavable: (savable: boolean) => void;
}

const SeriesFormSaveContext = createContext<SeriesFormSaveContextValue | null>(
  null
);

const useSeriesFormSaveContext = (caller: string) => {
  const context = use(SeriesFormSaveContext);
  if (!context) {
    throw new Error(`${caller} must be rendered inside a SeriesFormSaveScope.`);
  }

  return context;
};

/**
 * Carries whether the credit shares as typed can be saved from the credit list
 * to the save button, which sit apart in a form composed on the server. The
 * stored shares already passed the server's cap, so the form opens savable.
 */
export const SeriesFormSaveScope = ({ children }: { children: ReactNode }) => {
  const [savable, setSavable] = useState(true);
  const value = useMemo(() => ({ savable, setSavable }), [savable]);

  return (
    <SeriesFormSaveContext value={value}>{children}</SeriesFormSaveContext>
  );
};

/** Tells the save button whether the credit shares as typed can be saved. */
export const useSetSeriesFormSavable = () =>
  useSeriesFormSaveContext("useSetSeriesFormSavable").setSavable;

/** The form's save button, closed while a field says the form cannot be saved. */
export const SeriesFormSubmit = ({ children }: { children: ReactNode }) => {
  const { savable } = useSeriesFormSaveContext("SeriesFormSubmit");

  return <ActionFormSubmit disabled={!savable}>{children}</ActionFormSubmit>;
};
