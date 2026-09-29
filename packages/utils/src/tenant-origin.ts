export const TENANT_URL_SCHEME_ENV = "PUBLIRA_TENANT_URL_SCHEME";

const normalizeHost = (domain: string): string => {
  let host = domain.trim();
  if (host.startsWith("https://")) {
    host = host.slice("https://".length);
  } else if (host.startsWith("http://")) {
    host = host.slice("http://".length);
  }

  if (host.endsWith("/")) {
    host = host.slice(0, -1);
  }

  return host;
};

const readEnv = (name: string): string => {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
};

const deploymentScheme = (): string => {
  const scheme = readEnv(TENANT_URL_SCHEME_ENV).toLowerCase();
  if (scheme === "") {
    return "https";
  }

  if (scheme === "http" || scheme === "https") {
    return scheme;
  }

  throw new Error(
    `${TENANT_URL_SCHEME_ENV} must be http or https, not ${JSON.stringify(scheme)}`
  );
};

/**
 * The origin of `domain`. The scheme is `PUBLIRA_TENANT_URL_SCHEME`, `https`
 * when unset. `null` when `domain` names no host.
 */
export const tenantOrigin = (domain: string): string | null => {
  const host = normalizeHost(domain);
  if (host === "") {
    return null;
  }

  return `${deploymentScheme()}://${host}`;
};
