# Publira

Publira is open-source software for selling and distributing comics under a publisher's own brand. One install serves one or more publishers: each gets a public site on its own domain, where readers browse the catalog, buy episodes, and read them page by page, and a console where its staff publish series and episodes made of page images. Readers can also read in a mobile app for iOS and Android built for the publisher. An install runs on ordinary infrastructure — Docker Compose, Kubernetes, or Amazon ECS — so it is not tied to one cloud provider.

## Running an install

The documentation for the people who run Publira — the operator who deploys an install and keeps it running, and the publisher's staff who configure a site from its console — is published at [www.publira.dev/docs](https://www.publira.dev/docs/). Its source is under [`docs/en/`](docs/en/1-getting-started.md); start from [Getting started](docs/en/1-getting-started.md).

## Changing Publira

[CONTRIBUTING.md](CONTRIBUTING.md) covers the repository layout, the development environment, the commands that check a change, and the pull request conventions.

## License

Publira is licensed under the [Apache License 2.0](LICENSE).
