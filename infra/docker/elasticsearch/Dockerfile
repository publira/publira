# syntax=docker/dockerfile:1.29.0@sha256:572cebbc2b15e6f84c077742952674889cb63cd5e9b80abdffcbe587b6f19183

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

FROM elasticsearch:9.5.5@sha256:b7b0f24e9b5e90656ffe69804b3a48907499ab2b9cd67f02b7af3aff1b026a89
