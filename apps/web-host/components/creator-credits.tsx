import type { Locale } from "@publira/i18n";
import { formatList } from "@publira/utils";

import type { CreatorCredit } from "#lib/catalog";

/** One run of neighbouring credits that name the same role. */
interface CreditGroup {
  /**
   * The run's first credit as `<creator>:<role>`, the pair that is the
   * identity of a credit, so no two runs of one work can share it.
   */
  id: string;
  names: string[];
  roleName: string;
}

/**
 * Collect the credits into the runs a reader reads as one line of a colophon.
 * The runs are formed from neighbours rather than by gathering every credit
 * naming a role, so the sequence the API sent survives.
 */
const toCreditGroups = (credits: CreatorCredit[]): CreditGroup[] => {
  const groups: CreditGroup[] = [];

  for (const credit of credits) {
    const current = groups.at(-1);
    if (current && current.roleName === credit.roleName) {
      current.names.push(credit.name);
      continue;
    }
    groups.push({
      id: `${credit.publicId}:${credit.roleName}`,
      names: [credit.name],
      roleName: credit.roleName,
    });
  }

  return groups;
};

/**
 * Who a work is credited to: the role, the people who hold it, and the next
 * role after that, in the order the tenant's role priority put them.
 *
 * It renders inline text and sets no size or spacing of its own, so the same
 * credits read as one truncated line under a cover and as a paragraph under a
 * title. The two tones are its own: the role in the muted colour and the names
 * in the reading one is what tells them apart at a glance.
 */
export const CreatorCredits = ({
  credits,
  locale,
}: {
  credits: CreatorCredit[];
  locale: Locale;
}) => (
  <>
    {toCreditGroups(credits).map((group, index) => (
      <span key={group.id}>
        {index > 0 ? (
          <span className="px-1.5 text-muted-foreground">/</span>
        ) : null}
        {/* Empty on a credit written before the tenant curated any role, which
          is then the name on its own. */}
        {group.roleName ? (
          <span className="text-muted-foreground">{group.roleName} </span>
        ) : null}
        <span className="text-foreground">
          {formatList(group.names, { locale })}
        </span>
      </span>
    ))}
  </>
);
