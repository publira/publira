type HeadersLike = Pick<Headers, "get">;

const getHeaderValues = (headers: HeadersLike, name: string): string[] => {
  const value = headers.get(name)?.trim();
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

const getHostVariants = (value: string): string[] => {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return [];
  }

  const normalizedValue = trimmedValue.replace(/\/.*/u, "").toLowerCase();

  try {
    const url = new URL(
      normalizedValue.includes("://")
        ? normalizedValue
        : `http://${normalizedValue}`
    );

    return [
      ...new Set(
        [url.host, url.hostname].filter(
          (candidate) => candidate.trim().length > 0
        )
      ),
    ];
  } catch {
    const withoutPort = normalizedValue.replace(/:\d+$/u, "");
    return [
      ...new Set(
        [normalizedValue, withoutPort].filter(
          (candidate) => candidate.trim().length > 0
        )
      ),
    ];
  }
};

export const getTenantDomainCandidates = (headers: HeadersLike): string[] => {
  const candidates = [
    ...getHeaderValues(headers, "x-forwarded-host"),
    ...getHeaderValues(headers, "host"),
  ].flatMap(getHostVariants);

  return [...new Set(candidates)];
};
