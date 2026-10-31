import type { RetentionCohortItem } from "#lib/engagement";

/** The weeks a cohort is followed for: its sign-up week, then twelve more. */
export const RETENTION_WEEKS = 13;

/**
 * One week of a cohort as the table shows it, `week` weeks after the sign-up
 * week: still under way, after a week nobody signed up in, or the share of the
 * cohort active in it.
 */
export type CohortCell = { week: number } & (
  | { state: "open" }
  | { state: "no_readers" }
  | { state: "counted"; share: number }
);

/**
 * Every week of `cohort`, from its sign-up week on. A week the API left out
 * has not ended, and stays open rather than reading as nobody active in it.
 */
export const cohortCells = (cohort: RetentionCohortItem): CohortCell[] =>
  Array.from({ length: RETENTION_WEEKS }, (_, week): CohortCell => {
    const active = cohort.activeCounts[week];

    if (active === undefined) {
      return { state: "open", week };
    }

    if (cohort.cohortSize === 0) {
      return { state: "no_readers", week };
    }

    return { share: active / cohort.cohortSize, state: "counted", week };
  });

/**
 * The most of the primary colour a cell is shaded with, at a share of one: the
 * figure in the cell stays in the foreground colour, and has to stay legible
 * on the darkest shade.
 */
const MAX_SHADE_PERCENT = 40;

/** A cell's background, deeper the larger the share of the cohort it shows. */
export const cohortShade = (share: number): string =>
  `color-mix(in oklab, var(--color-primary) ${Math.round(
    Math.min(Math.max(share, 0), 1) * MAX_SHADE_PERCENT
  )}%, transparent)`;
