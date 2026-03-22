"use client";

import { Button } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import * as React from "react";
import { useActionState } from "react";

export type TenantUpdateFormState = { ok: boolean; message: string } | null;

interface TenantUpdateFormProps {
  action: (
    prevState: TenantUpdateFormState,
    formData: FormData
  ) => Promise<TenantUpdateFormState>;
  children: React.ReactNode;
}

export const TenantUpdateForm = ({
  action,
  children,
}: TenantUpdateFormProps) => {
  const [state, formAction, isPending] = useActionState(action, null);

  return (
    <form action={formAction}>
      {children}
      {state ? (
        <FormMessage
          className="mt-3"
          variant={state.ok ? "success" : "destructive"}
        >
          {state.message}
        </FormMessage>
      ) : null}
      <div className="mt-4 flex justify-end">
        <Button disabled={isPending} type="submit" variant="outline">
          {isPending ? "保存中..." : "保存"}
        </Button>
      </div>
    </form>
  );
};
