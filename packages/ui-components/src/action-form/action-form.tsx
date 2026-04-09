"use client";

import type { ReactNode } from "react";
import { useActionState } from "react";

import { Button } from "../button";
import type { ButtonProps } from "../button";
import { FormMessage } from "../form-message";

/**
 * Server Action が返す状態の型。
 *
 * - `null` — 初期状態（未送信）
 * - `{ ok: true, message }` — 成功
 * - `{ ok: false, message }` — エラー
 *
 * サーバーアクション側でも型をインポートして使える。
 *
 * ```ts
 * // _lib/actions.ts
 * "use server";
 * import type { FormActionState } from "@publira/ui-components/action-form";
 * ```
 */
export type FormActionState = { ok: boolean; message: string } | null;

export interface ActionFormRenderProps {
  isPending: boolean;
  state: FormActionState;
}

/**
 * `useActionState` をカプセル化したフォームコンポーネント。
 *
 * **自動モード** — `children` に ReactNode を渡すだけでエラー表示と送信ボタンを自動管理:
 *
 * ```tsx
 * <ActionForm
 *   action={myAction}
 *   submitLabel="送信"
 *   pendingLabel="送信中..."
 * >
 *   <Field>...</Field>
 * </ActionForm>
 * ```
 *
 * **レンダー関数モード** — ボタン配置やメッセージ表示をカスタマイズ:
 *
 * ```tsx
 * <ActionForm action={myAction}>
 *   {({ isPending, state }) => (
 *     <>
 *       <Field>...</Field>
 *       {state && !state.ok && (
 *         <FormMessage variant="destructive">{state.message}</FormMessage>
 *       )}
 *       <Button disabled={isPending} type="submit">送信</Button>
 *     </>
 *   )}
 * </ActionForm>
 * ```
 */

export interface ActionFormProps {
  action: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>;
  children: ReactNode | ((props: ActionFormRenderProps) => ReactNode);
  className?: string;
  disabled?: boolean;
  pendingLabel?: string;
  showSuccess?: boolean;
  submitClassName?: string;
  submitLabel?: string;
  submitVariant?: ButtonProps["variant"];
}

export const ActionForm = ({
  action,
  children,
  className,
  disabled,
  pendingLabel,
  showSuccess = false,
  submitClassName,
  submitLabel,
  submitVariant,
}: ActionFormProps) => {
  const [state, formAction, isPending] = useActionState(action, null);

  if (typeof children === "function") {
    return (
      <form action={formAction} className={className}>
        {children({ isPending, state })}
      </form>
    );
  }

  return (
    <form action={formAction} className={className}>
      {children}

      {state && (showSuccess || !state.ok) ? (
        <FormMessage variant={state.ok ? "success" : "destructive"}>
          {state.message}
        </FormMessage>
      ) : null}

      {submitLabel ? (
        <Button
          className={submitClassName}
          disabled={isPending || disabled}
          type="submit"
          variant={submitVariant}
        >
          {isPending ? (pendingLabel ?? submitLabel) : submitLabel}
        </Button>
      ) : null}
    </form>
  );
};
