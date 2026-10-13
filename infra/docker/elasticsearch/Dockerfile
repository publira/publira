# syntax=docker/dockerfile:1.28.0@sha256:bb22d9815c728170f72750f4e5b0d672e06176142e1d602c7e66c050100b7e5b

# Elasticsearch with the analysis plugins opensearch/Dockerfile installs, for
# the Go integration tests that run the catalog search backend on
# Elasticsearch. The published image ships none of them, and one can only be
# installed while the node is stopped, so they are installed here rather than
# at container start, where every start would download them again.
#
# This is a test dependency, not a deployment image: single-node discovery and
# the disabled security are set by server/internal/testutil, which starts it,
# and nothing here builds it for a registry. The Elasticsearch version is the
# one major the catalog search backend is tested against.
#
# testutil builds it from this file when PUBLIRA_TEST_ELASTICSEARCH_IMAGE is
# unset; to build it by hand, from the repository root:
#
#   docker build \
#     -f infra/docker/elasticsearch/Dockerfile \
#     -t publira/elasticsearch:local \
#     .

FROM elasticsearch:9.5.5@sha256:4e69180ed6f2abc91e85d8f3d5e393fed19ce3f4135489dc8636b7f6a9c8eeea

RUN bin/elasticsearch-plugin install --batch analysis-kuromoji analysis-icu analysis-nori analysis-smartcn
