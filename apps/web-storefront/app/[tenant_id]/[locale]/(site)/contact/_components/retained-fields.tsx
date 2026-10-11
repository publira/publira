"use client";

import { Input } from "@publira/ui-components/input";
import type { InputProps } from "@publira/ui-components/input";
import { Textarea } from "@publira/ui-components/textarea";
import type { TextareaProps } from "@publira/ui-components/textarea";
import { useState } from "react";

/**
 * A text field that keeps what the reader typed across a rejected submission.
 *
 * React resets an uncontrolled field the moment the form's Action settles, which
 * would empty a message the reader has to correct and send again. Holding the
 * value in state is what survives that reset; an accepted message redirects, so
 * nothing needs clearing.
 */
export const RetainedInput = ({
  defaultValue = "",
  ...props
}: Omit<InputProps, "defaultValue" | "onChange" | "value"> & {
  defaultValue?: string;
}) => {
  const [value, setValue] = useState(defaultValue);

  return (
    <Input
      {...props}
      onChange={(event) => {
        setValue(event.target.value);
      }}
      value={value}
    />
  );
};

/** {@link RetainedInput} for the message itself. */
export const RetainedTextarea = (
  props: Omit<TextareaProps, "defaultValue" | "onChange" | "value">
) => {
  const [value, setValue] = useState("");

  return (
    <Textarea
      {...props}
      onChange={(event) => {
        setValue(event.target.value);
      }}
      value={value}
    />
  );
};
