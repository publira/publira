/**
 * Shared action state type for forms using `useActionState`.
 *
 * - `null` represents the initial (pristine) state before any submission.
 * - `{ ok: true, message }` represents a successful action with an optional message.
 * - `{ ok: false, message }` represents a failed action with an error message.
 */
export type FormActionState = { ok: boolean; message: string } | null;
