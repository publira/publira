# syntax=docker/dockerfile:1.28.0@sha256:bb22d9815c728170f72750f4e5b0d672e06176142e1d602c7e66c050100b7e5b

# OpenSearch with the analysis plugins a definition for one language is built
# on, for the optional `search` profile of the root compose.yaml and of
# e2e/compose.yaml, and for the Go integration tests that run the catalog
# search backend on OpenSearch: analysis-kuromoji and analysis-icu, which the
# tests' definition for Japanese titles is built on, and analysis-nori and
# analysis-smartcn, which their definitions for Korean and Chinese titles are.
# The default text analysis needs none of them. The published
# image ships none of them either, and one can only be installed while the
# node is stopped, so they are installed here rather than at container start.
#
# This is a dependency of local development and the tests, not a deployment
# image: single-node discovery and the disabled security plugin are set by the
# compose files and by server/internal/testutil, which run it, and nothing
# here builds it for a registry. testutil builds it from this file when
# PUBLIRA_TEST_OPENSEARCH_IMAGE is unset.
#
# Build from the repository root (compose does this with `--profile search`):
#
#   docker build \
#     -f infra/docker/opensearch/Dockerfile \
#     -t publira/opensearch:local \
#     .

FROM opensearchproject/opensearch:3.9.0@sha256:3b55f6b6249cfdb92b52ee59adc8a266203ba9ef9f5d82544fad6f1af2f3609e

RUN bin/opensearch-plugin install --batch analysis-kuromoji analysis-icu analysis-nori analysis-smartcn
