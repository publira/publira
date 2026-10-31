import { BlockList, isIP } from "node:net";

import {
  forwardedParameters,
  isForwardedHeaderEnabled,
} from "./forwarded-header";

type HeadersLike = Pick<Headers, "get">;

/** Replaces {@link DEFAULT_TRUSTED_PROXIES}, as on `publira server`. */
export const TRUSTED_PROXIES_ENV = "PUBLIRA_TRUSTED_PROXIES";

/**
 * The ranges `publira server` trusts when {@link TRUSTED_PROXIES_ENV} is unset:
 * loopback, private, and link-local, which Rails trusts by default too.
 */
export const DEFAULT_TRUSTED_PROXIES = [
  "127.0.0.0/8",
  "::1/128",
  "fc00::/7",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "169.254.0.0/16",
  "fe80::/10",
] as const;

const IPV4_MAPPED = new BlockList();

IPV4_MAPPED.addSubnet("::ffff:0:0", 96, "ipv6");

const familyOf = (address: string): "ipv4" | "ipv6" | null => {
  switch (isIP(address)) {
    case 4: {
      return "ipv4";
    }

    case 6: {
      return "ipv6";
    }

    default: {
      return null;
    }
  }
};

/**
 * Reads addresses and CIDR ranges separated by commas or white space, the way
 * `publira server` reads {@link TRUSTED_PROXIES_ENV}: a bare address is the
 * range holding it alone, and a range of length zero, an IPv4-mapped range
 * shorter than `/96`, and anything that is not an address are refused, so a
 * typo fails rather than trusting less, or more, than the operator wrote.
 */
export const parseTrustedProxies = (raw: string): BlockList => {
  const trusted = new BlockList();

  for (const field of raw.split(/[\s,]+/u).filter(Boolean)) {
    const slash = field.indexOf("/");
    const address = slash === -1 ? field : field.slice(0, slash);
    const family = familyOf(address);
    const bits = slash === -1 ? null : Number(field.slice(slash + 1));
    const maxBits = family === "ipv4" ? 32 : 128;

    if (
      !family ||
      address.includes("%") ||
      (bits !== null &&
        !(
          /^\d+$/u.test(field.slice(slash + 1)) &&
          bits >= 0 &&
          bits <= maxBits
        ))
    ) {
      throw new Error(
        `${TRUSTED_PROXIES_ENV}: ${JSON.stringify(field)} is not an address or a CIDR range`
      );
    }

    const prefix = bits ?? maxBits;
    const mapped = family === "ipv6" && IPV4_MAPPED.check(address, "ipv6");

    if (mapped && prefix < 96) {
      throw new Error(
        `${TRUSTED_PROXIES_ENV}: ${JSON.stringify(field)} is an IPv4-mapped range shorter than /96`
      );
    }

    if (prefix === (mapped ? 96 : 0)) {
      throw new Error(
        `${TRUSTED_PROXIES_ENV}: ${JSON.stringify(field)} trusts every address`
      );
    }

    trusted.addSubnet(address, prefix, family);
  }

  return trusted;
};

const trustedProxiesFromEnv = (): BlockList => {
  const raw = (process.env[TRUSTED_PROXIES_ENV] ?? "").trim();

  return parseTrustedProxies(raw || DEFAULT_TRUSTED_PROXIES.join(","));
};

/**
 * The IPv4 address an IPv4-mapped IPv6 address carries, as `publira server`
 * unmaps it: a Node.js server that listens on both families reports an IPv4
 * peer as `::ffff:192.0.2.1`.
 */
const unmap = (address: string): string => {
  // The URL parser writes the address in its shortest form, which spells the
  // mapped address as two hex groups after `::ffff:`.
  const groups = new URL(`http://[${address}]/`).hostname
    .slice(1, -1)
    .split(":")
    .slice(-2)
    .map((group) => Number.parseInt(group, 16));

  return groups
    .flatMap((group) => [Math.trunc(group / 256), group % 256])
    .join(".");
};

/**
 * One hop of a chain: an address, optionally quoted, with an optional port,
 * and an IPv6 address in brackets when it carries one. The zone is dropped,
 * as `publira server` drops it. `null` for anything else, such as
 * `Forwarded`'s `unknown` and its obfuscated identifiers.
 */
const parseNode = (raw: string): string | null => {
  let node = raw.trim();

  if (node.length >= 2 && node.startsWith('"') && node.endsWith('"')) {
    node = node.slice(1, -1).replaceAll("\\", "");
  }

  if (node.startsWith("[")) {
    const end = node.indexOf("]");
    const rest = node.slice(end + 1);

    if (end === -1 || !(rest === "" || /^:\d+$/u.test(rest))) {
      return null;
    }

    node = node.slice(1, end);
  } else if (/^[\d.]+:\d+$/u.test(node)) {
    node = node.slice(0, node.indexOf(":"));
  }

  const address = node.split("%")[0] ?? "";
  const family = familyOf(address);

  if (!family) {
    return null;
  }

  return family === "ipv6" && IPV4_MAPPED.check(address, "ipv6")
    ? unmap(address)
    : address;
};

/**
 * The chain `Forwarded`'s `for=` parameters name, and whether it had any,
 * which is what decides that `X-Forwarded-For` is not read.
 */
const forwardedChain = (headers: HeadersLike): string[] | null => {
  const nodes = forwardedParameters(headers.get("forwarded") ?? "", "for");

  return nodes.length > 0
    ? nodes.map(parseNode).filter((node) => node !== null)
    : null;
};

const forwardedForChain = (headers: HeadersLike): string[] =>
  (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map(parseNode)
    .filter((node) => node !== null);

/**
 * The address of the client a request came from, found the way
 * `publira server` finds it: the chain `Forwarded`'s `for=` names, or
 * `X-Forwarded-For`'s when `Forwarded` carries none or is turned off, walked
 * from the right past every trusted proxy. The first address that is not one
 * is the client; when every one is, the furthest from the app is.
 *
 * The app's own peer is already the last hop of either header:
 * `appendPeerAddressOnEveryRequest` from `@publira/api-client/forwarded-hop`
 * appends it before the app sees the request. `null` when neither header
 * names an address.
 */
export const getClientAddress = (headers: HeadersLike): string | null => {
  const chain =
    (isForwardedHeaderEnabled() ? forwardedChain(headers) : null) ??
    forwardedForChain(headers);

  const trusted = trustedProxiesFromEnv();

  const client = chain.findLast(
    (address) => !trusted.check(address, familyOf(address) ?? "ipv4")
  );

  return client ?? chain[0] ?? null;
};
