export const buildQueryString = (
  values: Record<string, string | undefined>
): string => {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    const trimmed = value?.trim();
    if (trimmed) {
      params.set(key, trimmed);
    }
  }

  const query = params.toString();
  return query ? `?${query}` : "";
};
