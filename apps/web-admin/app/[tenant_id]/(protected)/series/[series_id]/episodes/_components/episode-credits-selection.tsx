"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

interface EpisodeCreditsSelectionValue {
  clear: () => void;
  selectedIds: ReadonlySet<string>;
  selectMany: (publicIds: readonly string[], selected: boolean) => void;
  toggle: (publicId: string, selected: boolean) => void;
}

const EpisodeCreditsSelectionContext =
  createContext<EpisodeCreditsSelectionValue | null>(null);

const EMPTY_SELECTED_IDS: readonly string[] = [];

export const selectionCheckboxProps = (
  allSelected: boolean,
  someSelected: boolean
): { checked: boolean; indeterminate: boolean } => ({
  checked: allSelected,
  indeterminate: someSelected,
});

export const EpisodeCreditsSelectionProvider = ({
  children,
  initialSelectedIds = EMPTY_SELECTED_IDS,
}: {
  children: ReactNode;
  initialSelectedIds?: readonly string[];
}) => {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(initialSelectedIds)
  );

  const clear = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const toggle = useCallback((publicId: string, selected: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(publicId);
      } else {
        next.delete(publicId);
      }
      return next;
    });
  }, []);

  const selectMany = useCallback(
    (publicIds: readonly string[], selected: boolean) => {
      setSelectedIds((current) => {
        const next = new Set(current);
        for (const publicId of publicIds) {
          if (selected) {
            next.add(publicId);
          } else {
            next.delete(publicId);
          }
        }
        return next;
      });
    },
    []
  );

  const value = useMemo(
    () => ({ clear, selectMany, selectedIds, toggle }),
    [clear, selectMany, selectedIds, toggle]
  );

  return (
    <EpisodeCreditsSelectionContext.Provider value={value}>
      {children}
    </EpisodeCreditsSelectionContext.Provider>
  );
};

export const useEpisodeCreditsSelection = (): EpisodeCreditsSelectionValue => {
  const value = useContext(EpisodeCreditsSelectionContext);
  if (value === null) {
    throw new Error("EpisodeCreditsSelectionProvider is required.");
  }
  return value;
};
