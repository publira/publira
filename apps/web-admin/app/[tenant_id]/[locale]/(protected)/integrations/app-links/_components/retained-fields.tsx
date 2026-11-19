"use client";

import { Input } from "@publira/ui-components/input";
import type { InputProps } from "@publira/ui-components/input";
import { Textarea } from "@publira/ui-components/textarea";
import type { TextareaProps } from "@publira/ui-components/textarea";
import { useState } from "react";

// React resets an uncontrolled form once its Action settles, which would wipe
// the value a refused save asks the operator to fix.

export const RetainedInput = ({
  defaultValue,
  ...props
}: Omit<InputProps, "defaultValue" | "onChange" | "value"> & {
  defaultValue: string;
}) => {
  const [value, setValue] = useState(() => defaultValue);

  return (
    <Input
      {...props}
      onChange={(event) => setValue(event.target.value)}
      value={value}
    />
  );
};

export const RetainedTextarea = ({
  defaultValue,
  ...props
}: Omit<TextareaProps, "defaultValue" | "onChange" | "value"> & {
  defaultValue: string;
}) => {
  const [value, setValue] = useState(() => defaultValue);

  return (
    <Textarea
      {...props}
      onChange={(event) => setValue(event.target.value)}
      value={value}
    />
  );
};
