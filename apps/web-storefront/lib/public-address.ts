import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/**
 * Addresses no request a tenant's setting points at may reach: unspecified,
 * loopback, private, shared (carrier-grade NAT), link-local, multicast,
 * reserved, and broadcast. They are where Publira's own network lives, and
 * where `publira server` refuses to send a Web Push for the same reason.
 * An IPv4-mapped IPv6 address is checked as the IPv4 address it maps.
 */
const RESTRICTED = new BlockList();

for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  RESTRICTED.addSubnet(address, prefix, "ipv4");
}

for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  RESTRICTED.addSubnet(address, prefix, "ipv6");
}

/** Whether `address` is an IP address outside {@link RESTRICTED}. */
export const isPublicAddress = (address: string): boolean => {
  const version = isIP(address);

  return (
    version !== 0 && !RESTRICTED.check(address, version === 4 ? "ipv4" : "ipv6")
  );
};

/** Raised in place of a connection to a host that has no public address. */
export class RestrictedAddressError extends Error {
  readonly code = "ERESTRICTEDADDRESS";

  constructor(hostname: string) {
    super(`${hostname} has no public address`);
    this.name = "RestrictedAddressError";
  }
}

/**
 * The first public address `hostname` resolves to, which the caller then
 * connects to by that address rather than by the name, so the address checked
 * is the one dialed even if the name resolves differently a moment later. A
 * host given as an IP address is answered only when it is public itself.
 * Raises {@link RestrictedAddressError} when there is none.
 */
const addressesOf = async (hostname: string): Promise<string[]> => {
  const literal = hostname.replaceAll(/^\[|\]$/gu, "");

  if (isIP(literal) !== 0) {
    return [literal];
  }

  const resolved = await lookup(hostname, { all: true });

  return resolved.map((entry) => entry.address);
};

export const resolvePublicAddress = async (
  hostname: string
): Promise<string> => {
  const addresses = await addressesOf(hostname);
  const address = addresses.find(isPublicAddress);

  if (!address) {
    throw new RestrictedAddressError(hostname);
  }

  return address;
};
