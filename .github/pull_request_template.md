<!--
PR title is used as the merge commit message.
Use a short, clear English title in Conventional Commits format.
Keep it concise so it displays cleanly in terminals and consoles.
-->

## Summary

<!--
Briefly explain what this PR does and why it is needed.
Write this section in normal sentences (not bullet points).
-->

## Changes

<!--
List the main code or behavior changes in this PR.
Use bullet points for easy review.
-->

-

## Upgrade notes

<!--
What an operator upgrading to the release that carries this PR has to do,
written for them: this section is copied into that release's notes.
Name every change of these kinds:
- an environment variable added, renamed, or no longer read
- a new database role, which `publiractl db roles` needs a password for
- a change to the routing in infra/proxy/
- a process or a service an install has to run that it did not run before
- a migration that runs long or locks a busy table
Write "None." when nothing in this PR asks anything of an operator.
The "Check upgrade notes" job fails while this section is empty in a PR that
adds a migration, changes infra/proxy/, the database roles, or the services
of infra/deploy/compose.yaml, or starts or stops reading a PUBLIRA_* variable.
-->

## How to Test

<!--
Describe reproducible test steps and expected results.
Include commands when useful.
-->

-

## Checklist

<!--
Check all items before requesting review.
Add project-specific checks if needed.
-->

- [ ] I used a Conventional Commits style PR title.
- [ ] I tested my changes locally.
- [ ] I updated docs if needed.
