export interface VersionDiffLine {
  type: "added" | "removed" | "unchanged";
  value: string;
}

export interface VersionDiffResult {
  lines: VersionDiffLine[];
  summary: {
    added: number;
    removed: number;
    unchanged: number;
  };
}

const toLines = (value: string): string[] =>
  value.replaceAll("\r\n", "\n").split("\n");

export const getDefaultComparisonVersionId = (
  publishedVersionId: string,
  versions: { id: string }[]
): string => {
  if (versions.length <= 1) {
    return "";
  }

  if (publishedVersionId) {
    const publishedIndex = versions.findIndex(
      (version) => version.id === publishedVersionId
    );
    if (publishedIndex >= 0) {
      return versions[publishedIndex === 0 ? 1 : publishedIndex].id;
    }
  }

  return versions[1]?.id ?? "";
};

export const buildVersionDiff = (
  nextValue: string,
  previousValue: string
): VersionDiffResult => {
  const nextLines = toLines(nextValue);
  const previousLines = toLines(previousValue);
  const matrix = Array.from({ length: previousLines.length + 1 }, () =>
    Array.from<number>({ length: nextLines.length + 1 }).fill(0)
  );

  for (let previousIndex = previousLines.length - 1; previousIndex >= 0; previousIndex -= 1) {
    for (let nextIndex = nextLines.length - 1; nextIndex >= 0; nextIndex -= 1) {
      if (previousLines[previousIndex] === nextLines[nextIndex]) {
        matrix[previousIndex][nextIndex] = matrix[previousIndex + 1][nextIndex + 1] + 1;
      } else {
        matrix[previousIndex][nextIndex] = Math.max(
          matrix[previousIndex + 1][nextIndex],
          matrix[previousIndex][nextIndex + 1]
        );
      }
    }
  }

  const lines: VersionDiffLine[] = [];
  let previousIndex = 0;
  let nextIndex = 0;

  while (previousIndex < previousLines.length && nextIndex < nextLines.length) {
    if (previousLines[previousIndex] === nextLines[nextIndex]) {
      lines.push({ type: "unchanged", value: nextLines[nextIndex] });
      previousIndex += 1;
      nextIndex += 1;
      continue;
    }

    if (matrix[previousIndex + 1][nextIndex] >= matrix[previousIndex][nextIndex + 1]) {
      lines.push({ type: "removed", value: previousLines[previousIndex] });
      previousIndex += 1;
      continue;
    }

    lines.push({ type: "added", value: nextLines[nextIndex] });
    nextIndex += 1;
  }

  while (previousIndex < previousLines.length) {
    lines.push({ type: "removed", value: previousLines[previousIndex] });
    previousIndex += 1;
  }

  while (nextIndex < nextLines.length) {
    lines.push({ type: "added", value: nextLines[nextIndex] });
    nextIndex += 1;
  }

  return {
    lines,
    summary: {
      added: lines.filter((line) => line.type === "added").length,
      removed: lines.filter((line) => line.type === "removed").length,
      unchanged: lines.filter((line) => line.type === "unchanged").length,
    },
  };
};