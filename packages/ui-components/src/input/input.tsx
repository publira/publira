import { Input as BaseInput } from "@base-ui/react/input";
import { cn } from "@publira/utils";

export type InputProps = BaseInput.Props;

/** The box every text control in a form shares, `PasswordInputControl` included. */
export const inputClassName =
  "h-10 w-full rounded-control border border-input bg-card px-3 py-2 text-sm text-foreground transition-colors duration-state ease-state placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50";

export const Input = ({ className, ...props }: InputProps) => (
  <BaseInput {...props} className={cn(inputClassName, className)} />
);
