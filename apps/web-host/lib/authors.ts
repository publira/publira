import { applyCacheTag, tenantAuthorsTag } from "./cache-tags";
import { listPublishedSeries } from "./catalog";

const SERIES_FETCH_BATCH_SIZE = 50;
const FALLBACK_AUTHOR_ID_PREFIX = "name_";

export interface PublishedAuthorListItem {
  id: string;
  name: string;
  iconImageUrl: string;
  seriesCount: number;
}

export interface PublishedAuthorDetail {
  id: string;
  name: string;
  iconImageUrl: string;
  profileText: string;
  series: {
    publicId: string;
    title: string;
  }[];
}

export interface PublishedAuthorListResult {
  authors: PublishedAuthorListItem[];
  hasNextPage: boolean;
  page: number;
  pageSize: number;
}

const normalizeAuthorName = (value: string) => value.trim();

const normalizeAuthorProfileText = (value: string) => value.trim();

const encodeFallbackAuthorId = (name: string) =>
  `${FALLBACK_AUTHOR_ID_PREFIX}${Buffer.from(name, "utf-8").toString("base64url")}`;

const decodeFallbackAuthorId = (id: string): string | null => {
  if (!id.startsWith(FALLBACK_AUTHOR_ID_PREFIX)) {
    return null;
  }

  const encoded = id.slice(FALLBACK_AUTHOR_ID_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) {
    return null;
  }

  try {
    const decoded = Buffer.from(encoded, "base64url").toString("utf-8").trim();
    if (decoded.length === 0) {
      return null;
    }

    const reencoded = Buffer.from(decoded, "utf-8").toString("base64url");
    if (reencoded !== encoded) {
      return null;
    }

    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
};

const toPositiveInt = (
  value: string | string[] | undefined,
  fallback: number
) => {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Math.trunc(Number(raw ?? ""));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

const addAuthorContribution = (
  authorSeriesMap: Map<
    string,
    { name: string; iconImageUrl: string; seriesMap: Map<string, string> }
  >,
  authorId: string,
  authorName: string,
  iconImageUrl: string,
  seriesPublicId: string,
  seriesTitle: string
) => {
  const existing = authorSeriesMap.get(authorId);
  if (existing) {
    if (existing.iconImageUrl.length === 0 && iconImageUrl.length > 0) {
      existing.iconImageUrl = iconImageUrl;
    }
    existing.seriesMap.set(seriesPublicId, seriesTitle);
    return;
  }
  authorSeriesMap.set(authorId, {
    iconImageUrl,
    name: authorName,
    seriesMap: new Map([[seriesPublicId, seriesTitle]]),
  });
};

export const listPublishedAuthors = async (
  tenantId: string,
  {
    page = 1,
    pageSize = 12,
  }: {
    page?: number;
    pageSize?: number;
  } = {}
): Promise<PublishedAuthorListResult> => {
  "use cache";

  const normalizedTenantId = tenantId.trim();
  applyCacheTag(tenantAuthorsTag(normalizedTenantId));

  const targetEndIndex = page * pageSize + 1;
  const authorSeriesMap = new Map<
    string,
    { name: string; iconImageUrl: string; seriesMap: Map<string, string> }
  >();

  let token = "";
  let reachedSeriesEnd = false;

  while (authorSeriesMap.size < targetEndIndex && !reachedSeriesEnd) {
    // Sequential pagination depends on previous batch results.
    // oxlint-disable-next-line no-await-in-loop
    const seriesPage = await listPublishedSeries(tenantId, {
      limit: SERIES_FETCH_BATCH_SIZE,
      token,
    });

    if (seriesPage.series.length === 0) {
      break;
    }

    for (const series of seriesPage.series) {
      const creatorsInSeries = new Map<string, string>();
      const creatorIconsInSeries = new Map<string, string>();

      for (const creator of series.creators) {
        const name = normalizeAuthorName(creator.name);
        if (name.length === 0) {
          continue;
        }

        const creatorId =
          creator.publicId.trim() || encodeFallbackAuthorId(name);
        creatorsInSeries.set(creatorId, name);
        creatorIconsInSeries.set(creatorId, creator.iconImageUrl.trim());
      }

      if (creatorsInSeries.size === 0) {
        for (const creatorName of series.creatorNames) {
          const name = normalizeAuthorName(creatorName);
          if (name.length === 0) {
            continue;
          }
          creatorsInSeries.set(encodeFallbackAuthorId(name), name);
        }
      }

      for (const [creatorId, creatorName] of creatorsInSeries.entries()) {
        addAuthorContribution(
          authorSeriesMap,
          creatorId,
          creatorName,
          creatorIconsInSeries.get(creatorId) ?? "",
          series.publicId,
          series.title
        );
      }
    }

    reachedSeriesEnd = seriesPage.nextToken.length === 0;
    token = seriesPage.nextToken;
  }

  const allAuthors = [...authorSeriesMap.entries()]
    .map(([id, value]) => ({
      iconImageUrl: value.iconImageUrl,
      id,
      name: value.name,
      seriesCount: value.seriesMap.size,
    }))
    .toSorted((left, right) => left.name.localeCompare(right.name, "ja"));

  const startIndex = (page - 1) * pageSize;
  const endIndex = startIndex + pageSize;

  return {
    authors: allAuthors.slice(startIndex, endIndex),
    hasNextPage: allAuthors.length > endIndex,
    page,
    pageSize,
  };
};

export const getPublishedAuthorDetail = async (
  tenantId: string,
  authorId: string
): Promise<PublishedAuthorDetail | null> => {
  "use cache";

  const fallbackAuthorName = decodeFallbackAuthorId(authorId);
  const isFallbackAuthor = fallbackAuthorName !== null;

  const relatedSeries = new Map<string, string>();
  let resolvedAuthorName = fallbackAuthorName ?? "";
  let resolvedAuthorIconImageUrl = "";
  let resolvedAuthorProfileText = "";

  let token = "";
  let reachedSeriesEnd = false;

  while (!reachedSeriesEnd) {
    // Sequential pagination depends on previous batch results.
    // oxlint-disable-next-line no-await-in-loop
    const seriesPage = await listPublishedSeries(tenantId, {
      limit: SERIES_FETCH_BATCH_SIZE,
      token,
    });

    if (seriesPage.series.length === 0) {
      break;
    }

    for (const series of seriesPage.series) {
      const matchedCreator = series.creators.find((creator) => {
        const name = normalizeAuthorName(creator.name);
        if (name.length === 0) {
          return false;
        }

        if (isFallbackAuthor) {
          return name === fallbackAuthorName;
        }

        return creator.publicId.trim() === authorId;
      });

      if (!matchedCreator) {
        if (
          isFallbackAuthor &&
          series.creatorNames.some(
            (name) => normalizeAuthorName(name) === fallbackAuthorName
          )
        ) {
          resolvedAuthorName = fallbackAuthorName;
          relatedSeries.set(series.publicId, series.title);
        }
        continue;
      }

      if (!resolvedAuthorName) {
        resolvedAuthorName = normalizeAuthorName(matchedCreator.name);
      }

      if (!resolvedAuthorProfileText) {
        resolvedAuthorProfileText = normalizeAuthorProfileText(
          matchedCreator.profileText
        );
      }

      if (!resolvedAuthorIconImageUrl) {
        resolvedAuthorIconImageUrl = matchedCreator.iconImageUrl.trim();
      }

      if (resolvedAuthorName.length > 0) {
        relatedSeries.set(series.publicId, series.title);
      }
    }

    reachedSeriesEnd = seriesPage.nextToken.length === 0;
    token = seriesPage.nextToken;
  }

  if (relatedSeries.size === 0) {
    return null;
  }

  return {
    iconImageUrl: resolvedAuthorIconImageUrl,
    id: authorId,
    name: resolvedAuthorName,
    profileText: resolvedAuthorProfileText,
    series: [...relatedSeries.entries()]
      .map(([publicId, title]) => ({ publicId, title }))
      .toSorted((left, right) => left.title.localeCompare(right.title, "ja")),
  };
};

export const normalizeAuthorsPage = (pageParam?: string | string[]) =>
  toPositiveInt(pageParam, 1);
