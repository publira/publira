# GitHub Issue CLI and API reference

Prefer dedicated [`gh issue`](https://cli.github.com/manual/gh_issue) commands. They accept Issue numbers or URLs, expose intent clearly, and avoid REST database-ID handling. Use `gh api` only for structured fields, inventory that the CLI cannot return, or a feature missing from the installed CLI.

Check the installed version and flags rather than assuming the online manual matches the environment:

```bash
gh --version
gh issue create --help
gh issue edit --help
gh issue view --help
```

## [Create with native commands](https://cli.github.com/manual/gh_issue_create)

Use `gh issue create` for the Issue and all metadata it supports:

```bash
gh issue create --repo OWNER/REPO \
  --title "TITLE" \
  --body-file BODY_FILE \
  --type Task \
  --label area/server \
  --parent PARENT_NUMBER \
  --blocked-by BLOCKER_NUMBER
```

Use `--blocking` when the new Issue blocks existing work. Both dependency flags accept comma-separated Issue numbers or URLs.

After creation, use the API only to add field values such as Priority and Effort because `gh issue create` does not provide field-value flags.

## [Edit with native commands](https://cli.github.com/manual/gh_issue_edit)

Use `gh issue edit` for existing types, hierarchy, and dependencies:

```bash
gh issue edit ISSUE_NUMBER --repo OWNER/REPO \
  --type Feature \
  --parent PARENT_NUMBER \
  --add-blocked-by BLOCKER_NUMBER

gh issue edit PARENT_NUMBER --repo OWNER/REPO \
  --add-sub-issue CHILD_NUMBER
```

The corresponding removal flags include `--remove-type`, `--remove-parent`, `--remove-sub-issue`, `--remove-blocked-by`, and `--remove-blocking`.

Do not express the same hierarchy twice with both `--parent` and `--add-sub-issue`; either direction creates the same parent-child relationship.

## [Use the API for Issue fields](https://docs.github.com/en/rest/issues/issue-field-values)

Issue fields are organization-level metadata on the Issue itself, not Projects custom fields. The organization-level definitions live under [REST API endpoints for organization issue fields](https://docs.github.com/en/rest/orgs/issue-fields); per-Issue values live under [REST API endpoints for issue field values](https://docs.github.com/en/rest/issues/issue-field-values).

List organization fields and existing Issue values:

```bash
gh api "/orgs/ORG/issue-fields"
gh api "/repos/OWNER/REPO/issues/NUMBER/issue-field-values"
```

Add or update individual values without clearing unrelated fields:

```bash
gh api --method POST \
  "/repos/OWNER/REPO/issues/NUMBER/issue-field-values" \
  -F 'issue_field_values[][field_id]=FIELD_ID' \
  -F 'issue_field_values[][value]=OPTION_NAME'
```

Use `PUT` only when intentionally replacing all field values.

## [Use the API for complete inventory](https://docs.github.com/en/rest/issues/issues)

The API remains useful for repository-wide audits and machine-readable values:

```bash
gh api --paginate "/repos/OWNER/REPO/issues?state=all&per_page=100"
gh api --paginate "/repos/OWNER/REPO/labels?per_page=100"
gh api "/orgs/ORG/issue-types"
gh api "/orgs/ORG/issue-fields"
gh api "/repos/OWNER/REPO/issues/NUMBER/sub_issues"
gh api "/repos/OWNER/REPO/issues/NUMBER/dependencies/blocked_by"
gh api "/repos/OWNER/REPO/issues/NUMBER/dependencies/blocking"
```

The repository Issues endpoint also returns pull requests. Exclude objects containing `pull_request` when auditing Issues.

Set the current API version header supported by GitHub when an endpoint requires it. Do not copy a stale version blindly from this reference.

## Compatibility fallback

If local `gh issue create --help` or `gh issue edit --help` lacks a required flag, use the corresponding REST endpoint temporarily:

```bash
gh api --method POST \
  "/repos/OWNER/REPO/issues/NUMBER/sub_issues" \
  -F sub_issue_id=CHILD_DATABASE_ID

gh api --method POST \
  "/repos/OWNER/REPO/issues/NUMBER/dependencies/blocked_by" \
  -F issue_id=BLOCKER_DATABASE_ID
```

These REST endpoints expect database IDs, not Issue numbers. Read the IDs from REST Issue objects and check for an existing parent or relationship first.

## Safety

- Read back one test mutation before bulk updates.
- Preserve field values and labels outside the migration plan.
- Expect notifications and secondary rate limits from repeated writes.
- Record successes and failures so a partial batch can be resumed idempotently.
- Treat `422` as a signal to check duplicates, cycles, or incompatible targets rather than retrying blindly.
- Do not rename or rewrite bot-managed Issues without confirming the generator configuration.
