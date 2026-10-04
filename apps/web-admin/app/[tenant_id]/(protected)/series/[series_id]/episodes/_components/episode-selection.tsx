"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

interface EpisodeSelectionValue {
  clear: () => void;
  selectedIds: ReadonlySet<string>;
  selectMany: (ids: readonly string[], selected: boolean) => void;
  toggle: (id: string, selected: boolean) => void;
}

const EpisodeSelectionContext = createContext<EpisodeSelectionValue | null>(
  null
);

const EMPTY_SELECTED_IDS: readonly string[] = [];

export const selectionCheckboxProps = (
  allSelected: boolean,
  someSelected: boolean
): { checked: boolean; indeterminate: boolean } => ({
  checked: allSelected,
  indeterminate: someSelected,
});

export const EpisodeSelectionProvider = ({
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

  const toggle = useCallback((id: string, selected: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const selectMany = useCallback(
    (ids: readonly string[], selected: boolean) => {
      setSelectedIds((current) => {
        const next = new Set(current);
        for (const id of ids) {
          if (selected) {
            next.add(id);
          } else {
            next.delete(id);
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
    <EpisodeSelectionContext.Provider value={value}>
      {children}
    </EpisodeSelectionContext.Provider>
  );
};

export const useEpisodeSelection = (): EpisodeSelectionValue => {
  const value = useContext(EpisodeSelectionContext);
  if (value === null) {
    throw new Error("EpisodeSelectionProvider is required.");
  }
  return value;
};
