# syntax=docker/dockerfile:1.28.0@sha256:bb22d9815c728170f72750f4e5b0d672e06176142e1d602c7e66c050100b7e5b

# Elasticsearch as its official image ships it, with no plugin added, for the
# Go integration tests that run the catalog search backend on Elasticsearch.
# Those tests are what shows the default text analysis builds every
# language's index on an engine nobody installed a plugin on; the tests of a
# definition built on a language's plugin run on OpenSearch, whose image
# (opensearch/Dockerfile) installs them.
#
# This is a test dependency, not a deployment image: single-node discovery and
# the disabled security are set by server/internal/testutil, which starts it,
# and nothing here builds it for a registry. The Elasticsearch version is the
# one major the catalog search backend is tested against, and the image is
# named here so Renovate raises it with the others.
#
# testutil builds it from this file when PUBLIRA_TEST_ELASTICSEARCH_IMAGE is
# unset; to build it by hand, from the repository root:
#
#   docker build \
#     -f infra/docker/elasticsearch/Dockerfile \
#     -t publira/elasticsearch:local \
#     .

FROM elasticsearch:9.5.5@sha256:1f537272deddf92b5c94bcaeb25180c2d0e1558f7d21bcbaf3fdaa74400c4607
