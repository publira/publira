export type CloseRoyaltyStatementActionState = {
  message: string;
  ok: false;
} | null;

export type RoyaltyCloseSettingsFieldErrors = Partial<
  Record<"autoCloseDay" | "closeMode", string>
>;

export type RoyaltyCloseSettingsFormState =
  | {
      ok: true;
      message: string;
    }
  | {
      ok: false;
      message: string;
      fieldErrors?: RoyaltyCloseSettingsFieldErrors;
    }
  | null;
