/**
 * `"use client"` boundary for `@publira/ui-components/action-form`.
 *
 * `tsdown` drops the directive when it bundles the package, so a Server
 * Component importing `ActionForm` from there reaches `useActionState` in the
 * server graph and the build fails. Re-exporting it through this module is what
 * lets a form body stay a Server Component — the labels then resolve from the
 * catalog on the server, each in its own `<Suspense>`.
 */

"use client";

export {
  ActionForm,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
export type {
  ActionFormProps,
  ActionFormRenderProps,
  ActionFormSubmitProps,
  FormActionState,
} from "@publira/ui-components/action-form";
