"use client";

import { Button } from "@publira/ui-components/button";
import type { ButtonProps } from "@publira/ui-components/button";
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogTrigger,
} from "@publira/ui-components/dialog";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useTransition,
} from "react";
import type { ReactNode } from "react";

interface DangerConfirmState {
  isPending: boolean;
  run: () => void;
}

const DangerConfirmContext = createContext<DangerConfirmState | null>(null);

const useDangerConfirm = (): DangerConfirmState => {
  const state = useContext(DangerConfirmContext);
  if (!state) {
    throw new Error(
      "DangerConfirmButton slots must be rendered inside a DangerConfirmButton."
    );
  }
  return state;
};

interface DangerConfirmButtonProps<T> {
  actionArg: T;
  actionCreator: (arg: T) => Promise<void>;
  /** A `DangerConfirmButtonTrigger` and the `ConfirmDialogContent` it opens, with a `DangerConfirmButtonAction` in its footer. */
  children: ReactNode;
}

/**
 * A confirmation dialog that runs `actionCreator(actionArg)` once the operator
 * confirms.
 *
 * ```tsx
 * <DangerConfirmButton actionArg={…} actionCreator={…}>
 *   <DangerConfirmButtonTrigger>…</DangerConfirmButtonTrigger>
 *   <ConfirmDialogContent>
 *     <ConfirmDialogHeader>
 *       <ConfirmDialogTitle>…</ConfirmDialogTitle>
 *       <ConfirmDialogDescription>…</ConfirmDialogDescription>
 *     </ConfirmDialogHeader>
 *     <ConfirmDialogFooter>
 *       <ConfirmDialogCancel>…</ConfirmDialogCancel>
 *       <DangerConfirmButtonAction>…</DangerConfirmButtonAction>
 *     </ConfirmDialogFooter>
 *   </ConfirmDialogContent>
 * </DangerConfirmButton>
 * ```
 */
export const DangerConfirmButton = ({
  actionArg,
  actionCreator,
  children,
}: DangerConfirmButtonProps<string>) => {
  const [isPending, startTransition] = useTransition();

  const run = useCallback(() => {
    startTransition(async () => {
      await actionCreator(actionArg);
    });
  }, [actionArg, actionCreator]);

  const state = useMemo(() => ({ isPending, run }), [isPending, run]);

  return (
    <DangerConfirmContext value={state}>
      <ConfirmDialog>{children}</ConfirmDialog>
    </DangerConfirmContext>
  );
};

/** The button that opens the dialog, disabled while the action runs. */
export const DangerConfirmButtonTrigger = ({
  children,
  variant = "destructive",
}: {
  children: ReactNode;
  variant?: ButtonProps["variant"];
}) => {
  const { isPending } = useDangerConfirm();

  return (
    <ConfirmDialogTrigger
      render={
        <Button disabled={isPending} variant={variant}>
          {children}
        </Button>
      }
    />
  );
};

/** The dialog's confirm control, which runs the action. */
export const DangerConfirmButtonAction = ({
  children,
  variant = "destructiveFilled",
}: {
  children: ReactNode;
  variant?: NonNullable<ButtonProps["variant"]>;
}) => {
  const { run } = useDangerConfirm();

  return (
    <ConfirmDialogAction onClick={run} variant={variant}>
      {children}
    </ConfirmDialogAction>
  );
};
