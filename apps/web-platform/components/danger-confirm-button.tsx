"use client";

import { Button } from "@publira/ui-components/button";
import type { ButtonProps } from "@publira/ui-components/button";
import * as ConfirmDialog from "@publira/ui-components/confirm-dialog";
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
  /** A `DangerConfirmButton.Trigger` and the `ConfirmDialog.Content` it opens, with a `DangerConfirmButton.Action` in its footer. */
  children: ReactNode;
}

/**
 * A confirmation dialog that runs `actionCreator(actionArg)` once the operator
 * confirms.
 *
 * ```tsx
 * <DangerConfirmButton.Root actionArg={…} actionCreator={…}>
 *   <DangerConfirmButton.Trigger>…</DangerConfirmButton.Trigger>
 *   <ConfirmDialog.Content>
 *     <ConfirmDialog.Header>
 *       <ConfirmDialog.Title>…</ConfirmDialog.Title>
 *       <ConfirmDialog.Description>…</ConfirmDialog.Description>
 *     </ConfirmDialog.Header>
 *     <ConfirmDialog.Footer>
 *       <ConfirmDialog.Cancel>…</ConfirmDialog.Cancel>
 *       <DangerConfirmButton.Action>…</DangerConfirmButton.Action>
 *     </ConfirmDialog.Footer>
 *   </ConfirmDialog.Content>
 * </DangerConfirmButton.Root>
 * ```
 */
const DangerConfirmButton = <T,>({
  actionArg,
  actionCreator,
  children,
}: DangerConfirmButtonProps<T>) => {
  const [isPending, startTransition] = useTransition();

  const run = useCallback(() => {
    startTransition(async () => {
      await actionCreator(actionArg);
    });
  }, [actionArg, actionCreator]);

  const state = useMemo(() => ({ isPending, run }), [isPending, run]);

  return (
    <DangerConfirmContext value={state}>
      <ConfirmDialog.Root>{children}</ConfirmDialog.Root>
    </DangerConfirmContext>
  );
};

/** The button that opens the dialog, disabled while the action runs. */
const DangerConfirmButtonTrigger = ({
  children,
  variant = "destructive",
}: {
  children: ReactNode;
  variant?: ButtonProps["variant"];
}) => {
  const { isPending } = useDangerConfirm();

  return (
    <ConfirmDialog.Trigger
      render={
        <Button disabled={isPending} variant={variant}>
          {children}
        </Button>
      }
    />
  );
};

/** The dialog's confirm control, which runs the action. */
const DangerConfirmButtonAction = ({
  children,
  variant = "destructiveFilled",
}: {
  children: ReactNode;
  variant?: NonNullable<ButtonProps["variant"]>;
}) => {
  const { run } = useDangerConfirm();

  return (
    <ConfirmDialog.Action onClick={run} variant={variant}>
      {children}
    </ConfirmDialog.Action>
  );
};

export {
  DangerConfirmButton as Root,
  DangerConfirmButtonAction as Action,
  DangerConfirmButtonTrigger as Trigger,
};
