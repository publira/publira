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

const normalizeRequestHost = (value: string): string => {
  let host = value.trim().toLowerCase();
  const scheme = host.indexOf("://");
  if (scheme !== -1) {
    host = host.slice(scheme + 3);
  }

  const slash = host.indexOf("/");
  if (slash !== -1) {
    host = host.slice(0, slash);
  }

  return host;
};

const getHostVariants = (value: string): string[] => {
  const host = normalizeRequestHost(value);
  return host.length > 0 ? [host] : [];
};

export const getTenantDomainCandidates = (headers: HeadersLike): string[] => {
  const candidates = [
    ...getHeaderValues(headers, "x-forwarded-host"),
    ...getHeaderValues(headers, "host"),
  ].flatMap(getHostVariants);

  return [...new Set(candidates)];
};
