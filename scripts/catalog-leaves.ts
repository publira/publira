/**
 * The leaves a generator compiles out of `locales/*.json`.
 *
 * A generated catalog holds the namespaces its reader needs, and every locale
 * has to carry the same keys: a key present in one catalog and missing from
 * another would otherwise compile into a member that renders nothing in one
 * language.
 */

export interface CatalogLocale {
  readonly code: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const flatten = (
  node: unknown,
  prefix: string,
  into: Map<string, string>
): void => {
  if (typeof node === "string") {
    into.set(prefix, node);
    return;
  }
  if (!isRecord(node)) {
    throw new Error(`${prefix}: leaves must be strings`);
  }
  for (const [name, child] of Object.entries(node)) {
    flatten(child, `${prefix}.${name}`, into);
  }
};

/** The messages of `namespaces` in one catalog, keyed by full path. */
const compiledLeaves = (
  catalog: unknown,
  code: string,
  namespaces: readonly string[]
): Map<string, string> => {
  const leaves = new Map<string, string>();
  if (!isRecord(catalog)) {
    throw new Error(`locales/${code}.json is not an object`);
  }
  for (const namespace of namespaces) {
    if (!(namespace in catalog)) {
      throw new Error(`locales/${code}.json has no ${namespace} namespace`);
    }
    flatten(catalog[namespace], namespace, leaves);
  }

  return leaves;
};

export interface CatalogLeaves {
  /** Every key of `namespaces`, sorted, so generated output has one order. */
  readonly keys: readonly string[];
  /** The leaves of one locale, keyed by locale code. */
  readonly leavesByCode: ReadonlyMap<string, Map<string, string>>;
}

/**
 * The leaves of `namespaces` in every locale, once every catalog has been
 * checked against the first one for missing and extra keys.
 */
export const namespaceLeaves = (
  locales: readonly CatalogLocale[],
  catalogs: ReadonlyMap<string, unknown>,
  namespaces: readonly string[]
): CatalogLeaves => {
  const leavesByCode = new Map(
    locales.map(({ code }) => [
      code,
      compiledLeaves(catalogs.get(code), code, namespaces),
    ])
  );
  const [reference, ...others] = locales.map(({ code }) => code);
  const referenceLeaves = leavesByCode.get(reference);
  if (referenceLeaves === undefined) {
    throw new Error("at least one locale is needed");
  }
  for (const code of others) {
    const leaves = leavesByCode.get(code);
    const missing = [...referenceLeaves.keys()].filter(
      (key) => !leaves?.has(key)
    );
    const extra = [...(leaves?.keys() ?? [])].filter(
      (key) => !referenceLeaves.has(key)
    );
    if (missing.length > 0 || extra.length > 0) {
      throw new Error(
        `locales/${code}.json does not match locales/${reference}.json: missing ${JSON.stringify(missing)}, extra ${JSON.stringify(extra)}`
      );
    }
  }

  return { keys: [...referenceLeaves.keys()].toSorted(), leavesByCode };
};
