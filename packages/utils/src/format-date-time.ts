interface FormatDateTimeOptions {
  fallback?: string;
}

const DISPLAY_TIME_ZONE = "Asia/Tokyo";

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
    timeZone: DISPLAY_TIME_ZONE,
  }).format(date);
};
