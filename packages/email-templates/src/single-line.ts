export const hasNoLineBreaks = (value: string): boolean =>
  !value.includes("\r") && !value.includes("\n");
