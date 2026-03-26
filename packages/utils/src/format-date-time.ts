interface FormatDateTimeOptions {
  fallback?: string;
}

export const formatDateTime = (
  value: string,
  options?: FormatDateTimeOptions
): string => {
  const fallback = options?.fallback ?? value;

  if (!value) {
    return fallback;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};
