import { listPublishedSeries } from "./catalog";

const SERIES_FETCH_BATCH_SIZE = 50;
const FALLBACK_AUTHOR_ID_PREFIX = "name_";

export interface PublishedAuthorListItem {
  id: string;
  name: string;
  seriesCount: number;
}

export interface PublishedAuthorDetail {
  id: string;
  name: string;
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

const encodeFallbackAuthorId = (name: string) =>
  `${FALLBACK_AUTHOR_ID_PREFIX}${Buffer.from(name, "utf8").toString("base64url")}`;

const decodeFallbackAuthorId = (id: string): string | null => {
  if (!id.startsWith(FALLBACK_AUTHOR_ID_PREFIX)) {
    return null;
  }

  const encoded = id.slice(FALLBACK_AUTHOR_ID_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
    return null;
  }

  try {
    const decoded = Buffer.from(encoded, "base64url").toString("utf8").trim();
    if (decoded.length === 0) {
      return null;
    }

    const reencoded = Buffer.from(decoded, "utf8").toString("base64url");
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
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

const addAuthorContribution = (
  authorSeriesMap: Map<
    string,
    { name: string; seriesMap: Map<string, string> }
  >,
  authorId: string,
  authorName: string,
  seriesPublicId: string,
  seriesTitle: string
) => {
  const existing = authorSeriesMap.get(authorId);
  if (existing) {
    existing.seriesMap.set(seriesPublicId, seriesTitle);
    return;
  }
  authorSeriesMap.set(authorId, {
    name: authorName,
    seriesMap: new Map([[seriesPublicId, seriesTitle]]),
  });
};

export const listPublishedAuthors = async (
  tenantPublicId: string,
  {
    page = 1,
    pageSize = 12,
  }: {
    page?: number;
    pageSize?: number;
  } = {}
): Promise<PublishedAuthorListResult> => {
  "use cache";

  const targetEndIndex = page * pageSize + 1;
  const authorSeriesMap = new Map<
    string,
    { name: string; seriesMap: Map<string, string> }
  >();

  let offset = 0;
  let reachedSeriesEnd = false;

  while (authorSeriesMap.size < targetEndIndex && !reachedSeriesEnd) {
    const seriesBatch = await listPublishedSeries(
      tenantPublicId,
      SERIES_FETCH_BATCH_SIZE,
      offset
    );

    if (seriesBatch.length === 0) {
      break;
    }

    for (const series of seriesBatch) {
      const creatorsInSeries = new Map<string, string>();

      for (const creator of series.creators) {
        const name = normalizeAuthorName(creator.name);
        if (name.length === 0) {
          continue;
        }

        const creatorId =
          creator.publicId.trim() || encodeFallbackAuthorId(name);
        creatorsInSeries.set(creatorId, name);
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
          series.publicId,
          series.title
        );
      }
    }

    reachedSeriesEnd = seriesBatch.length < SERIES_FETCH_BATCH_SIZE;
    offset += SERIES_FETCH_BATCH_SIZE;
  }

  const allAuthors = [...authorSeriesMap.entries()]
    .map(([id, value]) => ({
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
  tenantPublicId: string,
  authorId: string
): Promise<PublishedAuthorDetail | null> => {
  "use cache";

  const fallbackAuthorName = decodeFallbackAuthorId(authorId);
  const isFallbackAuthor = fallbackAuthorName !== null;

  const relatedSeries = new Map<string, string>();
  let resolvedAuthorName = fallbackAuthorName ?? "";

  let offset = 0;
  let reachedSeriesEnd = false;

  while (!reachedSeriesEnd) {
    const seriesBatch = await listPublishedSeries(
      tenantPublicId,
      SERIES_FETCH_BATCH_SIZE,
      offset
    );

    if (seriesBatch.length === 0) {
      break;
    }

    for (const series of seriesBatch) {
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

      if (resolvedAuthorName.length > 0) {
        relatedSeries.set(series.publicId, series.title);
      }
    }

    reachedSeriesEnd = seriesBatch.length < SERIES_FETCH_BATCH_SIZE;
    offset += SERIES_FETCH_BATCH_SIZE;
  }

  if (relatedSeries.size === 0) {
    return null;
  }

  return {
    id: authorId,
    name: resolvedAuthorName,
    series: [...relatedSeries.entries()]
      .map(([publicId, title]) => ({ publicId, title }))
      .toSorted((left, right) => left.title.localeCompare(right.title, "ja")),
  };
};

export const normalizeAuthorsPage = (
  pageParam: string | string[] | undefined
) => toPositiveInt(pageParam, 1);
