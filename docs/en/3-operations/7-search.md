---
title: Search
description: Choose the engine the storefront search finds works, authors, and labels with, move from the database to OpenSearch or Elasticsearch, and rebuild the index.
published: 2026-10-06
---

The search on every tenant's site finds series, authors, and labels through one engine, shared by every tenant. An install starts on the database itself and needs nothing more; OpenSearch or Elasticsearch is an option for an install that wants results ranked by relevance. This page compares the engines, moves the search from one to another, and covers the index an engine keeps.

Every `publiractl` command here is shown bare; run it the way [The Platform Console and publiractl](./1-platform-console.md#choosing-between-them) describes, with `PUBLIRA_PLATFORM_DB_URL` set to the `publira_platform` connection and the same `PUBLIRA_SECRET_ENCRYPTION_KEYS` and `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID` the processes run with. Every flag is in the [`publiractl` reference](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#search).

## Choosing an engine

| Engine | `--engine` | How it searches | What it needs |
| --- | --- | --- | --- |
| **PostgreSQL** | `sql` | Finds the titles and names that contain what was typed, in title or name order | Nothing: it is the database the install already has |
| **OpenSearch** | `opensearch` | Ranks the results by relevance, forgives a mistyped letter in a word written in Latin letters, and, with the default text analysis, finds a title written in kanji from its reading typed in kana | An OpenSearch cluster with the `analysis-kuromoji` and `analysis-icu` plugins on every node |
| **Elasticsearch** | `elasticsearch` | The same search as OpenSearch | An Elasticsearch cluster with the same plugins |

Whichever engine finds the results, what the storefront shows of each one is read from the database, so a series never shows a stale title, price, or cover because the engine has not caught up. A search can be narrowed and sorted the same ways on every engine.

PostgreSQL is enough for a catalog readers browse more than they search, or whose titles they type exactly. Move to an engine when readers look for a title by its reading or misspell it, and come away with nothing.

## Preparing OpenSearch or Elasticsearch

Publira does not run the engine for you. Use a cluster you operate or a managed one, and prepare these:

- **The plugins.** With the default text analysis, every node needs `analysis-kuromoji` and `analysis-icu`, and neither the official OpenSearch image nor the Elasticsearch one ships them. Install them on every node while it is stopped, with `bin/opensearch-plugin install analysis-kuromoji analysis-icu` or `bin/elasticsearch-plugin install analysis-kuromoji analysis-icu`. The repository's [OpenSearch image for development](https://github.com/publira/publira/blob/main/infra/docker/opensearch/Dockerfile) shows the same step as a Dockerfile. A catalog in a language other than Japanese may need other plugins instead, as [Text analysis](#text-analysis) describes.
- **The URL** the engine answers on, `http://` or `https://`, which `publira server`, `publira worker`, and `publiractl` all have to reach.
- **A user**, when the engine requires one. Publira signs in with HTTP basic authentication, which it sends only to an `https://` URL; it does not support API keys, nor a certificate authority of your own, so an engine with security turned on needs a certificate the servers already trust. The user needs to create, write, and delete indices, and move aliases, under the index alias below.
- **An index alias**, the name Publira reaches its index by: `publira-catalog` unless you give another. Publira creates the index and the alias itself. Give each install that shares a cluster an alias of its own, since two installs on one alias would overwrite each other's catalog.

## Testing the engine

The test asks the engine what it is and which plugins every node has, and reports the product, its version, and whether each plugin is installed. It fails when the engine does not answer, rejects the credentials, turns out to be the other product than the one chosen, or lacks either plugin while the default text analysis is in use.

- In the Platform Console, **Test connection** under **Search** tests the values in the form, before they are saved. It runs from `publira server`.
- `publiractl search test` tests the engine already saved, from wherever `publiractl` runs, and exits `1` when the test fails. On PostgreSQL there is nothing to test, and it exits `1`.

## Moving to another engine

Saving an engine does not move the search onto it at once. The index on the new engine is empty, so `publira worker` builds it first, from the database, and the search moves over once the index holds every tenant's catalog. Until then the storefront keeps answering from where it was, so readers never search an empty index.

### From the Platform Console

1. Choose **Search** under **Services** in the sidebar.
2. Under **Engine**, choose **OpenSearch** or **Elasticsearch**, and enter its **URL** and, if you chose one, its **Index alias (optional)**.
3. Under **Authentication**, choose **No authentication**, or **Username and password** and enter both.
4. Choose **Test connection**, and save with **Save search settings** once it passes.

**Search status** at the top of the screen shows the engine the storefront answers from, and while the index is being built, the engine it will move to. The screen checks again every few seconds, so it shows the move when it happens. An Operator or a Super admin can save; an Auditor only sees the screen.

### From publiractl

```bash
publiractl search set \
  --engine opensearch \
  --url https://search.example.com:9200 \
  --username publira --password-file /run/secrets/search-password
publiractl search test
publiractl search show
```

`search set` replaces every saved setting with the flags it is given, so name all of them each time; leaving `--username` out removes a saved password. With the same `--username` and no password, it keeps the saved password. `search show` prints the engine the search answers from, and a build that is under way or has failed.

### How long it takes

The worker looks for an index to build every 30 seconds, and filling it takes as long as the engine needs to take every published series, author, and label of every tenant. Changes made in the meantime are written to the new index as well, so nothing is lost by the wait.

### When the build fails

A build that fails — an engine that went away, a missing plugin, a user that may not create the index — leaves the search where it was, and the error is shown by **Search status** and by `publiractl search show`. The worker tries again every 30 seconds, so once you fix the engine the build goes through without saving the settings again. To give up on the move instead, save the engine the search is still answering from.

### Going back to PostgreSQL

Saving **PostgreSQL**, or `publiractl search set --engine sql`, moves the search back at once: the database needs no index. The index on the engine is left where it is; delete it yourself if you will not use it again.

### When the change reaches every process

`publira server` and `publira worker` read the settings again every 30 seconds, so a move reaches every instance within a minute, with no restart. Each save and each test is recorded in **Audit logs**.

## Text analysis

How the engine splits titles, names, and synopses into words is the text analysis, one definition for every tenant, since they share the index. The default is built for Japanese, on `analysis-kuromoji` and `analysis-icu`. For a catalog whose titles are in another language, replace it with a definition built on that language's plugin, such as `analysis-nori` for Korean or `analysis-smartcn` for Chinese.

A definition is the `settings.analysis` object of the index, as JSON of at most 64 KiB, and has to define three names the index refers to: the analyzers `written_form` and `alternate_form` and the normalizer `exact_match`. What each one is for is in the [text analysis reference](https://github.com/publira/publira/blob/main/server/README.md#text-analysis).

- In the Platform Console, **Text analysis** under **Search** takes the definition in **Definition (settings.analysis, JSON)** and saves it with **Save text analysis**. **Reset to default** goes back to the default definition. On PostgreSQL there is no index, and so no text analysis to save.
- With `publiractl`, `search set --analysis-file korean-analysis.json` saves a definition along with the engine, and `--default-analysis` goes back to the default. Without either, `search set` keeps the definition already saved.

Before a definition is saved, the engine is asked to create an empty index with it, and a definition it refuses is not saved, with the engine's reason. A saved definition is built into a new index the same way a new engine is, and the search moves onto it when the build is done.

## Rebuilding the index

The worker keeps the index up to date as tenants publish and edit, and builds a new one whenever the engine or the text analysis changes, so an index rarely needs rebuilding by hand. `publiractl search reindex` is for the two cases that are left:

- **A release changed the index.** When the [release notes](../2-deployments/5-upgrading.md#read-the-release-notes) say the catalog index changed, run it once the upgrade is done.
- **The index was lost**, because the cluster was replaced or the index deleted.

```bash
publiractl search reindex
```

It builds a new index beside the current one, fills it with every tenant's catalog, moves the alias onto it, and deletes the old one, so the storefront keeps searching while it runs. It reads the catalog as the `publira_content_stats` role, so give it `PUBLIRA_CONTENT_STATS_DB_URL` for that role, along with the encryption keys when the engine has a saved password. It cannot run while the worker is building an index, and exits `1` if one is under way; run it again once the build is done. On PostgreSQL there is no index to rebuild, and it exits `1`.

`publiractl search reindex --tenant comics.example.com` writes one tenant's catalog again, in the index the search answers from, without building a new one. It is for one tenant whose results look wrong, and cannot apply a change to the index itself.
