---
name: organize-github-issues
description: Create, triage, audit, or reorganize GitHub Issues using consistent titles, issue types, fields, labels, epics, Sub-issues, and dependency Relationships. Use when an agent must create Issues, normalize an existing backlog including closed Issues, remove redundant metadata, estimate Priority or Effort, build an issue hierarchy, or make GitHub work tracking easier to search and maintain.
---

# Organize GitHub Issues

Use GitHub's structured metadata for classification and planning. Keep titles focused on the work itself and keep each metadata dimension in exactly one place.

## Start with repository policy

1. Read the repository's `AGENTS.md` files and Issue templates.
2. Inspect the repository's existing language, terminology, types, fields, labels, and hierarchy.
3. Run `gh auth status` and identify the repository with `gh repo view`.
4. Check `gh` help and current official GitHub documentation before relying on newer Issue features. Read [references/github-api.md](references/github-api.md) when the installed CLI lacks the required flags.
5. Inventory open and closed Issues when the user requests repository-wide normalization.

Do not mutate GitHub while still discovering the taxonomy. Establish a mapping first, preserve unrelated metadata, and make changes idempotently.

## Apply the metadata model

### Title

- State the outcome or work directly.
- Use the repository's normal language and established technical terms.
- Do not add Priority, Type, area, or conventional-commit prefixes such as `[P1]`, `[Bug]`, `feat:`, or `refactor(web):`.
- Do not translate identifiers, product names, API names, or conventional technical terms merely to make the title monolingual.
- Preserve titles managed by automation. Examples include Renovate's `Dependency Dashboard` and configuration-warning Issues. Check the generator's configuration before renaming any bot-authored Issue.

### Issue type

Assign one primary kind of work:

- `Bug`: unexpected or incorrect behavior.
- `Feature`: a product, user, or platform capability or outcome.
- `Task`: design, investigation, documentation, migration, maintenance, testing, or operational work.

Do not create an `Epic` issue type when an Epic can also be a Feature or Task. Represent hierarchy separately with the `epic` label and Sub-issues.

### Fields

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

### Labels

Use labels only for orthogonal facets that types and fields do not express, for example:

- ownership or component: `area/server`, `area/mobile`
- cross-cutting concern: `security`, `documentation`
- workflow or resolution: `duplicate`, `blocked`, `good first issue`
- hierarchy role: `epic`

Remove or avoid labels such as `type/*`, `priority/*`, `effort/*`, `bug`, or `enhancement` when the equivalent Issue type or field is available. Remember that repository labels can also be used by pull requests; inspect that impact before deleting a label.

## Model hierarchy and sequencing

Use these relationships for distinct purposes:

- `epic` label: mark an Issue that represents a multi-Issue outcome.
- Sub-issues: enumerate the deliverables that compose the parent outcome.
- `blocked by` / `blocking`: express a real execution prerequisite.
- Plain references: connect related work that does not impose hierarchy or order.

Keep the parent's Type as Feature or Task. Prefer an existing broad outcome as the parent. Create a new Epic Issue only when existing Issues are leaf deliverables or their titles describe narrower work. Avoid turning a design task into a parent merely because it happens first.

An Issue should have only one parent. A parent may still participate in dependency Relationships, but do not duplicate a parent-child relationship as a dependency unless completion order genuinely requires it.

## Create an Issue

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
