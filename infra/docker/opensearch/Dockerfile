# syntax=docker/dockerfile:1.27.1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e

# OpenSearch with the analysis plugins the catalog index can be built from,
# for the optional `search` profile of the root compose.yaml and of
# e2e/compose.yaml: analysis-kuromoji and analysis-icu, which the default text
# analysis needs, and analysis-nori and analysis-smartcn, which a definition
# for Korean or Chinese titles is built on. The published image ships none of
# them, and one can only be installed while the node is stopped, so they are
# installed here rather than at container start.
#
# This is a dependency of local development and E2E, not a deployment image:
# single-node discovery and the disabled security plugin are set by the
# compose files that run it, and nothing here builds it for a registry.
#
# Keep the version in step with defaultOpenSearchImage in
# server/internal/testutil/opensearch.go, the node the Go integration tests
# run against.
#
# Build from the repository root (compose does this with `--profile search`):
#
#   docker build \
#     -f infra/docker/opensearch/Dockerfile \
#     -t publira/opensearch:local \
#     .

FROM opensearchproject/opensearch:3.9.0@sha256:adfa61f85025d06b4aeb562e7e74fde7e31c437039c93c3862c17e9acebd6c7c

RUN bin/opensearch-plugin install --batch analysis-kuromoji analysis-icu analysis-nori analysis-smartcn
