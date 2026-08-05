# GitHub Issue API reference

Use current official GitHub documentation as the authority. The commands below are fallback patterns for GitHub CLI versions that do not yet expose Issue fields, dependencies, or Sub-issues as flags.

Set the current API version header supported by GitHub. The examples use `2026-03-10`; verify it before use.

## Inventory

```bash
gh api --paginate "/repos/OWNER/REPO/issues?state=all&per_page=100"
gh api --paginate "/repos/OWNER/REPO/labels?per_page=100"
gh api "/orgs/ORG/issue-types"
gh api "/orgs/ORG/issue-fields"
gh api "/repos/OWNER/REPO/issues/NUMBER/issue-field-values"
gh api "/repos/OWNER/REPO/issues/NUMBER/sub_issues"
gh api "/repos/OWNER/REPO/issues/NUMBER/dependencies/blocked_by"
```

The repository Issues endpoint also returns pull requests. Exclude objects containing `pull_request` when auditing Issues.

## Update structured metadata

Update an Issue with `PATCH /repos/OWNER/REPO/issues/NUMBER`. The request may include `title`, `body`, `labels`, `type`, and `issue_field_values` when supported by the current API.

Add field values without clearing unrelated values:

```bash
gh api --method POST \
  "/repos/OWNER/REPO/issues/NUMBER/issue-field-values" \
  -F 'issue_field_values[][field_id]=FIELD_ID' \
  -F 'issue_field_values[][value]=OPTION_NAME'
```

Use `PUT` only when intentionally replacing all field values.

## Sub-issues

The API expects the database ID of the child Issue, not its issue number:

```bash
gh api --method POST \
  "/repos/OWNER/REPO/issues/PARENT_NUMBER/sub_issues" \
  -F sub_issue_id=CHILD_DATABASE_ID
```

Read the child ID from the REST Issue object. Check for an existing parent before attaching the child.

## Dependencies

Add a blocker using the blocking Issue's database ID:

```bash
gh api --method POST \
  "/repos/OWNER/REPO/issues/NUMBER/dependencies/blocked_by" \
  -F issue_id=BLOCKER_DATABASE_ID
```

Read both `blocked_by` and `blocking` endpoints during audits. Treat `422` as a signal to check duplicates, cycles, or incompatible targets rather than retrying blindly.

## Safety

- Read back one test mutation before bulk updates.
- Preserve field values and labels outside the migration plan.
- Expect notifications and secondary rate limits from repeated writes.
- Record successes and failures so a partial batch can be resumed idempotently.
- Do not rename or rewrite bot-managed Issues without confirming the generator configuration.
