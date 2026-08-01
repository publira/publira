"use client";

import { useCallback, useState } from "react";
import { useTenantId } from "#lib/use-tenant-id";

interface DeleteAccountModalProps {
  deleteAction: (formData: FormData) => Promise<void>;
}

export const DeleteAccountModal = ({ deleteAction,
}: DeleteAccountModalProps) => {

  const tenantId = useTenantId();
  const [open, setOpen] = useState(false);
  const openModal = useCallback(() => setOpen(true), []);
  const closeModal = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        className="inline-flex rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:opacity-90"
        onClick={openModal}
        type="button"
      >
        アカウントを削除
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-modal-title"
        >
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
            <h3
              className="text-lg font-semibold text-destructive"
              id="delete-account-modal-title"
            >
              退会の確認
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              退会を実行するには、現在のパスワードを入力してください。
            </p>

            <form action={deleteAction} className="mt-5 space-y-4">
              <input
                name="tenantId"
                type="hidden"
                value={tenantId}
              />

              <div className="space-y-2">
                <label htmlFor="deletePassword" className="text-sm font-medium">
                  現在のパスワード
                </label>
                <input
                  autoComplete="current-password"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  id="deletePassword"
                  name="password"
                  placeholder="********"
                  required
                  type="password"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  className="inline-flex rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
                  onClick={closeModal}
                  type="button"
                >
                  キャンセル
                </button>
                <button
                  className="inline-flex rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:opacity-90"
                  type="submit"
                >
                  退会する
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
};
