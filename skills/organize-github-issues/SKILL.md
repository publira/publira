---
name: organize-github-issues
description: Create, triage, audit, or reorganize GitHub Issues using consistent titles, issue types, Issue fields, labels, epics, Sub-issues, and dependency Relationships. Use when an agent must create Issues, normalize an existing backlog including closed Issues, remove redundant metadata, estimate Priority or Effort, build an issue hierarchy, or make GitHub work tracking easier to search and maintain.
---

# Organize GitHub Issues

Use GitHub's structured metadata for classification and planning. Keep titles focused on the work itself and keep each metadata dimension in exactly one place.

## Start with repository policy

1. Read the repository's `AGENTS.md` files and Issue templates.
2. Inspect the repository's existing language, terminology, types, fields, labels, and hierarchy.
3. Run `gh auth status` and identify the repository with `gh repo view`.
4. Check `gh` help and current official GitHub documentation before relying on newer Issue features. Prefer dedicated `gh issue` commands, then read [references/github-api.md](references/github-api.md) to select an API fallback only for unsupported operations such as Issue field values.
5. Inventory open and closed Issues when the user requests repository-wide normalization.

Do not mutate GitHub while still discovering the taxonomy. Establish a mapping first, preserve unrelated metadata, and make changes idempotently.

## Write in English

Write every Issue in English — the title and the body — whatever language the conversation that produced it was held in, and keep it English when you retitle or rewrite it later. An Issue is read outside the session that created it, from a search result or a link, by contributors who were never part of that conversation.

Rewriting a body that was filed in another language is a substantive repair rather than the cosmetic uniformity warned against under **Normalize a backlog**: keep what the prose says, and change only the language it says it in. Identifiers, product names, API names, paths, environment variable names, and quoted output are never translated in either direction, and a quoted log line, error message, or UI string stays exactly as it was emitted.

## Apply the metadata model

### [Title](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue)

- State the outcome or work directly.
- Write it in English, using the repository's established technical terms.
- Do not add Priority, Type, area, or conventional-commit prefixes such as `[P1]`, `[Bug]`, `feat:`, or `refactor(web):`.
- Do not translate identifiers, product names, API names, or conventional technical terms merely to make the title monolingual.
- Preserve titles managed by automation. Examples include Renovate's `Dependency Dashboard` and configuration-warning Issues. Check the generator's configuration before renaming any bot-authored Issue.

### [Issue type](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/managing-issue-types-in-an-organization)

Assign one primary kind of work:

- `Bug`: unexpected or incorrect behavior.
- `Feature`: a product, user, or platform capability or outcome.
- `Task`: design, investigation, documentation, migration, maintenance, testing, or operational work.

Do not create an `Epic` issue type when an Epic can also be a Feature or Task. Represent hierarchy separately with the `epic` label and Sub-issues.

### [Fields](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-and-managing-issue-fields)

These are Issue fields: organization-level typed metadata shown in the Issue sidebar next to assignees, labels, and type. They are not Projects custom fields, which belong to a single Project — see [About issue fields in projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects/understanding-fields/about-issue-fields) for how the two differ. An organization owner defines them in organization settings ([Managing issue fields in your organization](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/managing-issue-fields-in-your-organization)).

`Priority` and `Effort` below are organization-defined single-select fields, not built-in ones. Read the actual field names and option sets with `gh api "/orgs/ORG/issue-fields"` before writing values, and map the following meanings onto whatever the organization already defines.

- `Priority` expresses importance or sequencing pressure, not size.
  - `Urgent`: release-, security-, or operation-blocking work.
  - `High`: near-term important work.
  - `Medium`: planned work without immediate pressure.
  - `Low`: optional or opportunistic work.
- `Effort` expresses relative implementation size.
  - `High`: broad, uncertain, or cross-system work.
  - `Medium`: bounded work spanning several components.
  - `Low`: localized and well-understood work.
- Set Effort on actionable leaf Issues. Leave parent Epics unset to avoid double counting.
- Do not retroactively guess Effort for closed Issues unless the history provides credible evidence.
- Set dates only from an actual plan or commitment; never invent them.

### [Labels](https://docs.github.com/en/issues/using-labels-and-milestones-to-track-work/managing-labels)

Use labels only for orthogonal facets that types and fields do not express, for example:

- ownership or component: `area/server`, `area/mobile`
- cross-cutting concern: `security`, `documentation`
- workflow or resolution: `duplicate`, `blocked`, `good first issue`
- hierarchy role: `epic`

Remove or avoid labels such as `type/*`, `priority/*`, `effort/*`, `bug`, or `enhancement` when the equivalent Issue type or field is available. Remember that repository labels can also be used by pull requests; inspect that impact before deleting a label.

## Model hierarchy and sequencing

Use these relationships for distinct purposes:

- `epic` label: mark an Issue that represents a multi-Issue outcome.
- [Sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues): enumerate the deliverables that compose the parent outcome.
- [`blocked by` / `blocking`](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies): express a real execution prerequisite.
- Plain references: connect related work that does not impose hierarchy or order.

Keep the parent's Type as Feature or Task. Prefer an existing broad outcome as the parent. Create a new Epic Issue only when existing Issues are leaf deliverables or their titles describe narrower work. Avoid turning a design task into a parent merely because it happens first.

An Issue should have only one parent. A parent may still participate in dependency Relationships, but do not duplicate a parent-child relationship as a dependency unless completion order genuinely requires it.

## [Create an Issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue)

1. Search for duplicates, bot-managed equivalents, and suitable existing parents.
2. Write a content-only title.
3. Write a body containing only useful sections, typically purpose, background, scope, non-scope, acceptance criteria, and implementation notes.
4. Set Type, Priority, leaf Effort, orthogonal labels, parent, and genuine dependencies.
5. If the Issue is a multi-Issue outcome, add `epic`, leave Effort unset, and attach its Sub-issues.
6. Re-read the created Issue from GitHub and verify every value.

Do not repeat structured metadata in the title or add hand-maintained `Parent`, `Priority`, or `Blocked by` sections when GitHub's native fields already represent it. Preserve useful historical prose during migrations; do not rewrite bodies solely for cosmetic uniformity.

## Normalize a backlog

1. Export all Issues, labels, types, field definitions and values, Sub-issues, and dependencies.
2. Identify machine-managed Issues and exclude their controlled titles and bodies.
3. Build a deterministic per-Issue migration table before writing:
   - old and new title
   - Type
   - Priority and Effort
   - retained and removed labels
   - parent and Sub-issues
   - dependencies
4. Test the payload on one representative Issue and read it back.
5. Apply changes in bounded batches. Watch for secondary rate limits and partial failures.
6. Delete redundant labels only after Issue migration succeeds and pull-request usage has been checked.
7. Re-fetch the complete backlog and validate it.

For closed Issues, normalize titles, Type, Priority, labels, and explicit historical relationships when requested. Avoid speculative Effort and new hierarchy that cannot be supported by the record.

## Validate the result

Confirm all applicable invariants:

- every human-managed Issue title contains only meaningful content
- automated titles remain compatible with their generators
- every Issue has the correct Type
- no title or label duplicates Type, Priority, or Effort
- every open actionable leaf Issue has Effort
- parent Epics have `epic`, valid Sub-issues, and no Effort
- dependencies represent prerequisites rather than mere association
- no Issue has multiple parents
- counts and sampled read-backs match the migration plan
- repository files remain unchanged unless configuration changes were explicitly required

Report created Issues, changed counts, deliberate unset fields, hierarchy, verification results, and any permission or API limitations.
