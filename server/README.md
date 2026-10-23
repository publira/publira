# server

The Go backend. It is operated as a single module, `github.com/publira/publira/server`.

## Directory layout

```text
server/
├── cmd/
│   ├── publira/           # `publira server` (ConnectRPC API + image delivery) and `publira worker` (Outbox drain + River jobs)
│   └── publiractl/        # The command that operates an install (`job <kind>` runs a maintenance job by hand)
├── bin/                   # Binaries produced by task build
└── internal/
    ├── db/                # PostgreSQL integration tests for db/migrations and db/query
    │   └── gen/           # sqlc-generated code (do not edit)
    ├── proto/
    │   └── gen/           # buf-generated code (do not edit)
    └── testutil/          # Shared test helpers such as Testcontainers
```

## Responsibilities

- Serving the API for multi-tenant operation
- Business logic for content submission and publication
- Full rebuilds of the daily content statistics
- Purging view events past their retention window
- The scheduled publication job (transition into the published state)
- Authentication and security foundations

## Implementation rules

1. Schema-first development: change `proto/` or the golang-migrate files under `db/migrations/` (`.up.sql` / `.down.sql`) first, then run `task gen`
2. Keep `cmd/` thin and put the implementation in `internal/`
3. The background worker (`publira worker`, in `cmd/publira`) is a long-lived process separated from the API, where River executes every recurring job — the Outbox drain, the periodic jobs that promote due episodes, apply free window boundaries, turn over each tenant's calendar day, and expire pinned announcements, and the maintenance jobs that rebuild and purge stored data. Running it is all the scheduling a deployment needs. `cmd/publiractl` runs one of those maintenance jobs by hand as `publiractl job <kind>`

## Development commands

```bash
task db:setup
task db:seed
task db:create NAME=add_example_column
task server:dev-server
task server:dev-worker
task server:tidy
task server:build
task server:lint
task server:test
```

## Lint

- `task server:lint` (= `golangci-lint run ./...`) runs the static analysis. It is the same configuration and the same version as the `Lint / Go` job in CI.
- The rule set is [`.golangci.yml`](.golangci.yml). It enables golangci-lint's own `standard` default set (`errcheck` / `govet` / `ineffassign` / `staticcheck` / `unused`).
- `golangci-lint` is installed in the Dev Container at a pinned version (`GOLANGCI_LINT_VERSION` in [`ci.yml`](../.github/workflows/ci.yml)). Install the same version when you run it outside the Dev Container.
- Generated code (`internal/proto/gen/**`, `internal/db/gen/**`) is excluded automatically by its `DO NOT EDIT.` header. The hand-written integration tests under `internal/db/` stay in scope.

## Tests

- Unit tests mostly mock the database with `sqlmock`.
- Integration tests against a real database start a PostgreSQL container with [Testcontainers for Go](https://golang.testcontainers.org/).
  - Shared helpers: `internal/testutil` (applying migrations, seeding the app roles, Snapshot/Restore, seeding tenants and the catalog)
  - Open a connection per app role with `OpenPlatformDB` / `OpenAdminDB` / `OpenPublicDB`. The latter two have RLS enabled, so they can verify the tenant boundary itself.
  - Examples: `TestDB*` in `api/platformapi` (tenant creation, uniqueness constraints, state transitions), `TestDB*` in `api/adminapi` (tenant isolation), `TestDB*` in `api/publicapi` (published/unpublished filtering, member authentication)
- The catalog search tests start an OpenSearch and an Elasticsearch node with `StartOpenSearch` / `StartElasticsearch`. The OpenSearch image carries the language plugins the tests of a definition for Japanese, Korean, or Chinese build on, and those tests run there alone (`EachSearchEngineWithLanguagePlugins`); the Elasticsearch image is the official one with no plugin, so every test that runs on both engines (`EachSearchEngine`) shows the default analysis working on an engine nobody installed a plugin on. Each runs the image named by its variable when that is set, and otherwise builds one from [`infra/docker/opensearch`](../infra/docker/opensearch/Dockerfile) or [`infra/docker/elasticsearch`](../infra/docker/elasticsearch/Dockerfile), which Docker's build cache keeps for the next run. CI builds both once and sets the variables.

  | Variable | Image |
  | --- | --- |
  | `PUBLIRA_TEST_OPENSEARCH_IMAGE` | An image built from `infra/docker/opensearch/Dockerfile` |
  | `PUBLIRA_TEST_ELASTICSEARCH_IMAGE` | An image built from `infra/docker/elasticsearch/Dockerfile` |

- Requirement: Docker must be usable locally (the affected tests skip when it is not running)
- For a faster run, `go test -short ./...` skips the integration tests that start containers

## Entrypoint details

- `publira server` (the API and image delivery) and `publira worker` (Outbox drain / scheduled publishing / free window boundaries / tenant day roll / pinned announcement expiry / scheduled maintenance): [cmd/publira/README.md](cmd/publira/README.md)
- publiractl (manual runs of the maintenance jobs: backfills, recovery, dry-run purges): [cmd/publiractl/README.md](cmd/publiractl/README.md)

## Where the design is explained

How a subsystem decides or records something is explained in the doc comment of the code that does it, which `go doc` shows (`go doc -u` for an unexported handler):

- `internal/httpserver`: how a stopping process drains its requests, stops its job queue, and flushes the audit log, the telemetry, and the database pools on one deadline
- `internal/contentevents`: what each kind of event in `content_events` records, for whom, and what happens when it cannot be written; the handlers that file them are `RecordContentView` (with the `publira_aid` cookie), `RateEpisode`, and `MarkEpisodeAsRead` in `api/publicapi`
- `db/query/series_rating.sql`: the series rating derived from its episodes' reactions
- `ListMyEpisodeReads`, `SaveReadingPosition`, `GetMyReadingPosition`, and `GetMySeriesProgress` in `api/publicapi`, and the queries in `db/query/episode.sql` and `db/query/episode_reading_position.sql`: a member's own reading history and reading positions
- `ListEpisodeReadThrough` in `api/adminapi` and `db/query/engagement.sql`: the read-through rate the console reports
- `internal/contentstats`: the daily aggregates, the comment count among them
- `internal/auth`: the token audiences, and the media tokens an image URL carries for a reader, a free body, and a console preview
- `internal/mfaflow`, `internal/mfa`, and `internal/tenantwebauthn`: the second factor of the tenant consoles and the Platform Console, the challenge that stands in for a session until it is answered, and the console's passkeys

## Graceful shutdown

On SIGINT / SIGTERM, `publira server` and `publira worker` stop within 30 seconds. Give the orchestrator a SIGKILL grace period longer than that (on Kubernetes, a `terminationGracePeriodSeconds` of 45 or more). Draining readiness at the load balancer is configured separately.

## Episode purchases

A paid episode is sold as a one-time payment through the web payment provider the tenant chose. A provider is a package under `internal/paymentprovider` that implements `paymentprovider.Provider`, and `providers.Registry()` lists the ones a tenant may choose from. The purchase flow in `api/publicapi/purchase_handlers.go` reaches a provider only through that interface. This build ships [Stripe](#stripe), the worked example below, and [PAY.JP](#payjp).

- **Start.** `StartEpisodeCheckout` loads the tenant's enabled provider and credentials from `tenant_payment_config` and calls `StartCheckout` with the purchase (tenant, reader, episode, price, the tenant currency it is in, reading period), the episode title, the URLs the reader returns to, and an idempotency key derived from all of those and from the reader's last checkout of the episode the provider reported expired, so a retry of the same request reuses the provider's checkout while one that differs in any of them, or follows an expiry, starts a checkout of its own. It answers the URL the provider gives back, which the storefront and the app send the reader to. An episode that already has a valid purchase does not start a checkout, and can be bought again once that purchase has expired.
- **Return.** After paying or cancelling, the reader comes back to the episode URL on the tenant's `domain` with `checkout=success` or `checkout=cancelled`. The return confirms nothing; only a notification does.
- **Notification.** `POST /api/v1/webhook/payment/<provider>` on `web-storefront` receives the provider's notifications on the tenant's public domain and forwards the raw body and every header to `ProcessPaymentWebhook` with the provider id. The API server refuses a provider the tenant does not use and hands the rest to `ParseNotification`, which verifies the notification against the tenant's credentials, reads the provider's API where the notification alone does not say enough, and answers `PurchaseCompleted`, `Refunded`, `RefundFailed`, `Disputed`, `DisputeLost`, `CheckoutExpired`, or `Ignored`.
- **Purchase.** `PurchaseCompleted` creates a row in `purchases`, keyed by `(provider, provider_checkout_id)` so that a redelivered notification creates nothing more, and stores the id the provider's refunds name as `provider_payment_id`. The purchase it carries must belong to the tenant whose path it arrived on, and is recorded in the currency it was paid in: the tenant's, unless the checkout was started before the tenant changed its currency, in which case it opens the episode and is no sale on a royalty statement in the new one. A payment made in the provider's test mode is recorded with `is_test`, opens the episode, and is left out of royalty statements and the daily content stats.
- **Revocation.** A purchase opens its episode until `revoked_at` is set, and `revocation_reason` says why: `refund`, `dispute`, or `staff`. A revoked purchase opens nothing, is reported inactive by `ListMyPurchases`, and no longer blocks the reader from buying the episode again. The first revocation keeps its instant and its reason, so a refund that follows a dispute leaves both alone; the one exception is `RefundPurchase`, which revokes the purchase as `staff` before it asks the provider and takes over a `refund` recorded in between.
- **Refund.** `Refunded` carries the total refunded so far on one payment. `refunded_amount` holds it, and `refunded_at` is set once it reaches the price paid, which revokes the purchase as a `refund`; a partial refund leaves the reading right alone. A refund that names no amount, or one in a currency other than its purchase's, is recorded as a full refund. Royalty statements read `refunded_at`, not the revocation. `RefundFailed` reports a refund that failed after the provider accepted it, with the total that stays refunded as the provider's API reports it; that total replaces `refunded_amount`, and once it falls short of the price `refunded_at` is cleared and a `refund` or `staff` revocation lifted.
- **Dispute.** `Disputed` revokes the purchase of the payment it names as a `dispute`, and records no refund: whether the money goes back is for the reader's bank to decide. `DisputeLost` reports the bank's decision against the tenant and sets `dispute_lost_at`, revoking the purchase as a `dispute` too when nothing has revoked it yet. Royalty statements read `dispute_lost_at` beside `refunded_at`: a lost dispute is no sale, and one lost after its month was closed is carried into the next statement as a full refund is. Nothing lifts the revocation of a purchase whose dispute was lost, a failed refund included. A dispute decided for the tenant is no event: the payment stays a sale, and the purchase stays revoked.
- **Held refund or dispute.** A provider need order neither its notifications nor its retries, so a refund or a dispute can arrive before the purchase it reverses. Such a refund is kept in `unapplied_refunds`, and such a dispute in `unapplied_disputes`, with `lost_at` once it is reported lost, under `(provider, provider_payment_id)`, and written onto the purchase by the notification that finally creates it.
- **Expiry.** `CheckoutExpired` revokes nothing, since nothing was bought. It records the checkout in `expired_checkouts`, one row per reader and episode, which the next checkout's idempotency key names, so the reader is sent to a new checkout rather than the expired one the provider would otherwise answer the earlier key with.

Without a usable configuration neither the checkout nor the webhook runs, and web-storefront turns the resulting `FailedPrecondition` into a 503, which the provider retries. A notification that does not verify or cannot be read is a 400, and a provider id the registry does not know is a 404. Verifying signatures, currencies, amounts, and purchase permissions stays in the API server.

Tenant administrators choose a provider from `ListPaymentProviders` and store the credential fields it declares through `AdminPaymentSettingsService`. Every field is stored encrypted in `tenant_payment_config`; a secret field is shown back masked and a public one as stored. Payments can be turned on only once every required field has a value, and choosing another provider clears the fields stored for the previous one.

The same settings hold the tenant currency, `tenant_payment_config.currency`: the one currency the tenant sells in, as an ISO 4217 code. A tenant that has saved none sells in the platform's default currency, `platform_config.default_currency`, which initial setup takes — `publiractl setup --default-currency`, or `CreateInitialUser` — and `publiractl platform set --default-currency` changes, as long as no tenant selling in it has a purchase, and which is `USD` until one is given. `PlatformSettings.default_currency_locked` answers whether such a purchase exists. Every price is an integer in the tenant currency's minor unit, so a price of 500 is 500 yen in JPY and 5.00 dollars in USD, and every recorded amount — a purchase, a store purchase intent, a held refund — names the currency it is in beside it. `UpdateTenantPaymentSettings` saves only a currency the chosen provider declares, which `ListPaymentProviders` answers, and refuses to change it once the tenant has a purchase. `TenantService.GetTenant` and `AdminAuthService.GetTenant` answer it, and `MyPurchase` and `TenantStoreProduct` carry it beside their amounts.

The same service stores the App Store Connect API key (issuer ID, key ID, and the `.p8` private key) and the Google Play service account's JSON key, in `tenant_app_store_config` and `tenant_google_play_config`, and the tenant's app purchase route (`tenant_config.app_purchase_route`): `external_checkout`, the web checkout above, or `store`, the store's in-app purchase. The app each store sells in is the one the tenant's mobile app association names. `TenantService.GetTenant` answers the route, and while it is `store`, `StartEpisodeCheckout` refuses `CLIENT_MOBILE` with `FailedPrecondition`.

While the route is `store`, the app buys through `StartStorePurchase` and `ConfirmStorePurchase`. The first opens a row in `store_purchase_intents` for the episode and answers its ID and the product the episode's price is sold as (`episode_<price>`); the app sets the ID as the transaction's `appAccountToken` (App Store) or `obfuscatedAccountId` (Google Play). The second takes the StoreKit 2 signed transaction or the Play purchase token, verifies it with the store (the App Store Server API's Get Transaction Info, or `purchases.products.get` on the Google Play Developer API), and records a `purchases` row with `store` and `store_transaction_id` in place of the provider columns. A Play purchase is then consumed by `publira worker`. `StartStorePurchase` names the store the app is about to charge through and is refused unless that store is ready, and the intent keeps the episode's price, the tenant currency it is in, and the reading period, which the purchase is recorded on however late it is confirmed. Every confirmation spends the reader's store confirmation allowance of the platform policy before the store is asked. A transaction from the App Store sandbox or a Play license tester is recorded with `is_test`, opens the episode, and is left out of royalty statements and the daily content stats.

A store's refund takes the purchase back as a provider's refund does, for the whole price. App Store Server Notifications V2 reach `POST /api/v1/webhook/payment/app-store` on the tenant's public domain, which forwards the raw body to `ProcessAppStoreNotification`; `REFUND` and `REVOKE` are applied and every other type is acknowledged. Register that URL for both the production and the sandbox server in App Store Connect. Google Play's refunds are read by `publira worker` from the Voided Purchases API every hour (`maintenance.sync_google_play_voided_purchases`, also `publiractl job sync-google-play-voided-purchases`), each pass rereading the 30 days the API keeps. A refund that arrives before the app has confirmed the purchase is kept in `unapplied_store_refunds` and applied by the confirmation that records it.

### Stripe

`internal/paymentprovider/stripe` starts a hosted Checkout Session per purchase. The session carries the purchase in its metadata, and its id and its payment intent's id become the checkout id and the payment id: `charge.refunded` and the dispute events name the payment intent and never the session. A session whose `livemode` is false completes a test purchase. It charges in the currencies Stripe states a minimum charge for, less ISK and UGX, which Stripe charges in hundredths although ISO 4217 gives them no minor unit. Its fields are the secret key (`secret_key`) and the webhook signing secret (`webhook_secret`), both secret and required, and it signs its notifications in `Stripe-Signature`.

| Event | Answered as |
| --- | --- |
| `checkout.session.completed` | `PurchaseCompleted`, or `Ignored` while a delayed method such as konbini is unpaid |
| `checkout.session.async_payment_succeeded` | `PurchaseCompleted` for a delayed method once it is paid |
| `checkout.session.expired` | `CheckoutExpired`, or `Ignored` for a session that names no purchase |
| `charge.refunded` | `Refunded` |
| `refund.updated`, `refund.failed` | `RefundFailed` for a refund that failed or was canceled, with what stays refunded read from the payment intent's charge, or `Ignored` for any other change |
| `charge.dispute.created` | `Disputed` |
| `charge.dispute.closed` | `DisputeLost` for a dispute closed as lost, or `Ignored` for one won or an inquiry closed without becoming a chargeback |
| Any other | `Ignored` |

In the Stripe Dashboard, register the tenant's public domain `https://<tenant-domain>/api/v1/webhook/payment/stripe` as the webhook endpoint and enable the seven events above. For local development, forward with the Stripe CLI:

```bash
stripe listen --forward-to localhost:3080/api/v1/webhook/payment/stripe
```

Save the `whsec_...` it prints as that tenant's webhook signing secret through `UpdateTenantPaymentSettings`. For test cards, Stripe's `4242 4242 4242 4242` with any future date and a valid CVC works.

### PAY.JP

`internal/paymentprovider/payjp` starts a hosted Checkout Session per purchase on PAY.JP's API v2, cards only and with 3-D Secure required. A notification is authenticated by a token alone, so the payment it reports is read from the payment flow it names, a refund's total from the refunds that have gone through on the flow, and a refund the notification says failed or was canceled from the refund itself before it is answered as `RefundFailed`. A flow whose `livemode` is false completes a test purchase. It charges in JPY alone. Its fields are the secret key (`secret_key`) and the webhook token (`webhook_token`), both secret and required.

In the PAY.JP dashboard, register `https://<tenant-domain>/api/v1/webhook/payment/payjp` as the webhook endpoint, and store the secret key from the API settings page and the webhook token from the account settings. For local development, log in with the [PAY.JP CLI](https://docs.pay.jp/v2/guide/developers/payjp-cli) and forward test-mode events, which it delivers with the headers PAY.JP sends them with:

```bash
payjp-cli login
payjp-cli listen --forward-to localhost:3080/api/v1/webhook/payment/payjp
```

For test cards, `4242 4242 4242 4242` with any future date and any three-digit CVC works; in test mode, 3-D Secure shows PAY.JP's test authentication screen, where the outcome is chosen.

### Adding a payment provider

GMO Payment Gateway, SB Payment Service, Sony Payment Services, and Veritrans give their specifications and test environments to merchants under contract only, so such a provider comes from a contributor who holds one. Its tests run from notifications recorded in its sandbox, so it stays tested in CI without one.

```text
internal/paymentprovider/
├── provider.go           # Provider, Declaration, Field, Credentials, and the events
├── registry.go           # Registry, and the rules a declaration is checked against
├── paymentprovidertest/  # The contract suite: Fixture, RunParse, Harness, Run
├── providers/            # providers.Registry(), the providers this build ships
│   └── providerstest/    # The contract fixture of every registered provider
└── <id>/                 # One provider
    ├── <id>.go
    └── <id>test/         # Its contract fixture
        └── testdata/     # Notifications recorded from its sandbox
```

1. **Implement `paymentprovider.Provider`** in `internal/paymentprovider/<id>`.
   - `Declaration()` answers the provider's `ID`, which is stored per tenant and is a segment of the webhook path, so it is lower case letters, digits, and `_`, starting with a letter; the `DisplayName` the console lists; the `SignatureHeader`; the `Currencies` it can charge in, as ISO 4217 codes in capitals, each charged in its ISO 4217 minor unit; and the credential `Fields`. A field is `Secret` when it is never shown back, `Public` when the reader's browser needs it, as a publishable key, and `Required` when the provider cannot take payments without it. A field is never both secret and public.
   - `StartCheckout` answers the URL the reader is sent to in order to pay, charging `Purchase.Price` in `Purchase.Currency`. The provider carries `CheckoutRequest.Purchase` to the notification that confirms the payment, as Stripe does in the session's metadata, and passes `IdempotencyKey` on when its API accepts one.
   - `ParseNotification` verifies a notification against the tenant's credentials, reading the provider's API with them when the payload is not signed or does not carry the total refunded, and answers `PurchaseCompleted` once the money has arrived, with `Purchase.Currency` read from the payment rather than from anything the checkout carried and `Test` set when the payment was made in the provider's test mode, `Refunded` with the total refunded so far on the payment in the currency's minor unit and its upper-case ISO 4217 code, or `Ignored` for anything else. A notification that does not verify answers `ErrInvalidSignature`, and one that verifies but cannot be read `ErrMalformedNotification`.
2. **Register it** in `providers.Registry()`.
3. **Record its fixture.** `<id>test` implements `paymentprovidertest.Fixture`, and a constructor for it is added to the map in `providers/providerstest`. The fixture answers the provider it drives, two sets of credentials that sign differently, and three notifications: a completed checkout, in live or test mode as the suite asks, a refund, and one the purchase flow ignores. To record them, point the sandbox's notifications at a URL you can read (for Stripe, `stripe listen --print-json`), make a test payment, refund it, and save each body the sandbox delivers under `testdata/`, with any personal data in it replaced by placeholders. The fixture writes the values the suite chooses — the checkout id, the payment id, the purchase, and the refunded amount — into the recorded body and signs it with the credentials it is given at the moment the test asks, so a signature that carries a timestamp never goes stale. A provider that reads its API answers from the fixture's fake of the endpoints it calls, which the fixture fills as it hands out each notification, as `payjptest` does. `stripetest` is the worked example.
4. **Run the contract.** `TestEveryRegisteredProviderReadsItsNotifications` in `providers`, part of `task server:test-short`, runs `RunParse` in JPY and in USD, each where the provider declares it: the purchase and the ids come back unchanged, a test-mode checkout is reported as one and a live one is not, the refund names its payment, its amount, and its currency, the unrelated notification is ignored, one signed with the other credentials or not signed at all is refused, and the declaration names a signature header and requires nothing the fixture's credentials lack. `TestDBEveryRegisteredPaymentProviderPassesTheContract` in `api/publicapi`, part of `task server:test`, runs `Run` for a tenant in each of the same currencies, delivering the same notifications through `ProcessPaymentWebhook` to PostgreSQL: a redelivered checkout creates one purchase, a live checkout opens the episode and counts on the month's royalty statement while a test-mode one opens it and does not, a refund that arrives first is held and applied, partial refunds close the purchase once their total reaches the price, and a forged notification or a checkout naming another tenant creates nothing. Both fail, naming the provider, while it has no fixture.
5. **Add its console copy.** The payment settings page of `web-admin` lists the provider under its `DisplayName` and labels each field with `admin.settings.payment.fields.<id>.<field>`, a key every catalog in `locales/` carries and `PaymentCredentialName` in `apps/web-admin/app/[tenant_id]/(protected)/integrations/payment/_components/tenant-payment-settings-form.tsx` renders. A field with no key shows the name it is declared under.
6. **Document its setup** in a section beside [Stripe](#stripe): what a tenant registers with the provider, and how to reach the sandbox from local development.

The settings store, the admin RPCs, the console form, the webhook route, and the proxy routes are generic over the declaration, so nothing else changes.

## Contact message replies by email

Staff answer a contact message from the console, and the `contact_message_reply_email` outbox handler mails the answer to the reader through the tenant's SMTP settings. Where the reader's reply goes depends on whether the tenant receives inbound email:

- **Not configured.** The answer's `Reply-To` is the answering staff member's account address, so the reply lands in that person's mailbox and Publira never sees it.
- **Configured and ready.** The answer's `Reply-To` is the message's own address on the tenant's inbound domain, `contact+<message public id>@<inbound domain>`. The provider receives the reply there and posts it to `POST /api/v1/webhook/email/<provider>` on `web-storefront`, which forwards the raw body and every header to `ContactService.ProcessInboundEmailWebhook`. The API server matches the mail to its message by that address first and by the Message-IDs its `In-Reply-To` and `References` name second, stores it under the message as a reader entry without the quoted answer, puts the message back among the waiting ones, and queues the `contact_message_staff_email` notice for it.

An inbound provider is a package under `internal/inboundprovider` that implements `inboundprovider.Provider`, and `providers.Registry()` lists the ones a tenant may choose from. Tenant administrators choose one from `ListInboundEmailProviders` and store it, the inbound domain, and the credential fields it declares through `AdminInboundEmailSettingsService`; the fields are stored encrypted in `tenant_inbound_email_config` and shown back masked. The settings are ready once they are enabled with a domain and every required field.

The tenant points the inbound domain's MX records at the provider. A domain of its own, such as `reply.<tenant domain>`, keeps the tenant's other mail where it is.

### SendGrid Inbound Parse

`internal/inboundprovider/sendgrid` reads both forms Inbound Parse posts, the parsed one and the raw MIME one. Inbound Parse signs nothing, so its one field is a webhook token (`webhook_token`, secret and required) that the tenant chooses and puts in the destination URL as the basic auth password. In SendGrid, add the inbound domain under **Settings → Inbound Parse** with the destination URL `https://inbound:<token>@<tenant-domain>/api/v1/webhook/email/sendgrid`.

### Resend

`internal/inboundprovider/resend` verifies the Svix signature of an `email.received` event and reads the mail's text and headers from Resend's receiving API, since the event carries only metadata. Its fields are the API key (`api_key`) and the webhook signing secret (`webhook_secret`), both secret and required. In Resend, add the inbound domain for receiving, and register `https://<tenant-domain>/api/v1/webhook/email/resend` as a webhook for `email.received`.

### Mailgun

`internal/inboundprovider/mailgun` reads what a Route's `forward()` action posts to a URL ending in `json`: the mail already parsed into one JSON document, attachments included, signed over the whole body in `X-Mailgun-Signature`. The post carries the whole mail, so nothing is read from Mailgun's API, and the EU and US regions need no setting. Its one field is the HTTP webhook signing key (`webhook_signing_key`, secret and required), found under **Settings → API Security** in Mailgun; for a domain on a subaccount, the subaccount's key and the primary account's both work. In Mailgun, add the inbound domain under **Domains** and point its MX records at the ones Mailgun shows for receiving, then create a Route under **Receiving** with the filter `match_recipient(".*@<inbound domain>")` and the action `forward("https://<tenant-domain>/api/v1/webhook/email/mailgun/json")`.

### Amazon SES

`internal/inboundprovider/ses` reads what an SNS topic delivers to an HTTPS subscription when an SES receipt rule publishes to it. A rule's SNS action puts the mail in the notification's `content`, base64 when the action's encoding is `BASE64`, and SES fails that action for a mail over 150 KB. A rule's S3 action writes the mail to a bucket and publishes where it is, and the provider reads it from there with the tenant's AWS access key. Either way the envelope recipients come from `receipt.recipients` and are matched ahead of the mail's `To` and `Cc`, and the SES message id is the delivery key.

The SNS signature (`SignatureVersion` 1 or 2) proves only that SNS sent the request, and any AWS account can subscribe its own topic to the URL. A request is therefore the tenant's when it also carries the webhook token as the basic auth password of the subscription URL and names the stored topic ARN; the signing certificate is fetched only from an HTTPS URL on an `sns.<region>.amazonaws.com` host. A `SubscriptionConfirmation` that passes all three is confirmed by fetching its `SubscribeURL`, and anything but a `Received` notification is ignored. SNS sends the credentials in the subscription URL only once a response challenges it for them, which `web-storefront` does on every 401 from this path.

| Field |  |  |
| --- | --- | --- |
| `webhook_token` | secret, required | The basic auth password of the subscription URL |
| `topic_arn` | required | The topic the receipt rule publishes to |
| `access_key_id` |  | The S3 action only: the access key of an IAM user allowed `s3:GetObject` on the bucket, and `kms:Decrypt` on the key when the bucket's default encryption is SSE-KMS. A notification from the S3 action with no key stored is answered as unavailable |
| `secret_access_key` | secret | The secret of that access key |
| `region` |  | The bucket's region, when it is not the topic's |
| `bucket` |  | When stored, the one bucket a mail is read from |

In SES, in a region that [receives email](https://docs.aws.amazon.com/general/latest/gr/ses.html#ses_inbound_endpoints), verify the inbound domain and point its MX record at `inbound-smtp.<region>.amazonaws.com`, create an SNS topic in the same region, and add a receipt rule for the domain with an S3 action that names the topic, or with an SNS action whose encoding is Base64. Save the provider in the console, then subscribe `https://inbound:<token>@<tenant-domain>/api/v1/webhook/email/ses` to the topic over HTTPS with raw message delivery off.

### Raw MIME over HTTPS

`internal/inboundprovider/mime` reads one whole RFC 5322 mail posted as the request body with `Content-Type: message/rfc822`, for anything that can hand a received mail to an HTTPS endpoint and has no provider of its own: a Cloudflare Email Worker, a Postfix `pipe` transport running `curl`, a script. Nothing on that side signs what it posts, so its one field is a webhook token (`webhook_token`, secret and required) that the tenant chooses and the sender sends as the basic auth password, the same way SendGrid does: `https://inbound:<token>@<tenant-domain>/api/v1/webhook/email/mime`. A post with another token is refused as unsigned, and one whose body is not a mail with a `From` is refused as malformed.

The `X-Envelope-To` request header names the envelope recipients, comma-separated, and they are matched ahead of the mail's `To` and `Cc`. A mail an alias or a forward passed on often no longer names `contact+<message public id>@<inbound domain>` in its headers, while the side that received it still knows the address it was delivered to: a Cloudflare Email Worker's `message.to`, Postfix's `${recipient}`. The Worker and the Postfix transport that post this way are on the [Email page](../docs/en/4-console/3-setup/7-email.md#posting-raw-mail-from-cloudflare-email-routing) of the documentation.

The **Email** page under **Integrations** in `web-admin` is where a tenant administrator does this: it shows the webhook URL to register on the tenant's domain and, once a domain is saved, the reply address pattern `contact+*@<inbound domain>`.

### Receiving replies on a development machine

No provider has a CLI that forwards to `localhost` the way the Stripe and PAY.JP CLIs do: both deliver from the internet, so the edge needs a public HTTPS URL in front of it. Open a tunnel to `localhost:3080` that rewrites the `Host` header to the seed tenant's domain, which is what `web-storefront` resolves the tenant from:

```bash
cloudflared tunnel --url http://localhost:3080 --http-host-header localhost:3080
# or
ngrok http 3080 --host-header=localhost:3080
```

The console shows the webhook URL on the tenant's own domain, which no provider can reach on a development machine, so register the tunnel's host in its place: `https://inbound:<token>@<tunnel-host>/api/v1/webhook/email/sendgrid` for SendGrid, `https://<tunnel-host>/api/v1/webhook/email/resend` for Resend, a Route forwarding to `https://<tunnel-host>/api/v1/webhook/email/mailgun/json` for Mailgun, and an SNS subscription to `https://inbound:<token>@<tunnel-host>/api/v1/webhook/email/ses` for Amazon SES; SNS posts its confirmation as soon as the subscription is created, so save the provider first, and choose **Request confirmation** on the subscription in SNS if it stays pending. The inbound domain still has to be a real one whose MX records you control, such as `reply-dev.<a domain you own>`, pointed at `mx.sendgrid.net` with priority 10, at `inbound-smtp.<region>.amazonaws.com`, or at the MX records Resend or Mailgun shows for it.

The raw MIME provider needs neither a tunnel nor an account anywhere: post a mail to the edge on the development machine yourself. Save the provider with any inbound domain, such as `reply.localhost`, and a token of your choice, answer a contact message from the console, and post a reply to it:

```bash
cat > reply.eml <<'MAIL'
From: Reader <reader@example.net>
To: contact+<message public id>@reply.localhost
Subject: Re: About my purchase
Content-Type: text/plain; charset=UTF-8

It opens now, thank you.
MAIL

curl --fail --user inbound:<token> \
  --header 'Content-Type: message/rfc822' \
  --header 'X-Envelope-To: contact+<message public id>@reply.localhost' \
  --data-binary @reply.eml \
  http://localhost:3080/api/v1/webhook/email/mime
```

### Adding an inbound provider

The layout follows `internal/paymentprovider`: implement `inboundprovider.Provider` in `internal/inboundprovider/<id>`, register it in `providers.Registry()`, and add a fixture implementing `inboundprovidertest.Fixture` in `<id>/<id>test` to the map in `providers/providerstest`. `TestEveryRegisteredProviderReadsItsWebhook` in `providers` runs `RunParse` against the fixture, and `TestDBEveryRegisteredInboundProviderStoresAReply` in `api/publicapi` delivers its requests through `ProcessInboundEmailWebhook` to PostgreSQL; both fail, naming the provider, while it has no fixture.

The **Email** page lists the provider under its `DisplayName` and labels each field with `admin.settings.inbound_email.fields.<id>.<field>`, a key every catalog in `locales/` carries and `InboundEmailCredentialName` in `apps/web-admin/app/[tenant_id]/(protected)/integrations/email/_components/tenant-inbound-email-settings-form.tsx` renders; a field with no key shows the name it is declared under. Document its setup in a section beside [SendGrid Inbound Parse](#sendgrid-inbound-parse), including how to reach it from a development machine. A service that can post the whole mail to a URL needs no package of its own: [Raw MIME over HTTPS](#raw-mime-over-https) already reads it.

## Image storage configuration

The installation has one S3-compatible object store, saved in `platform_storage_config` through `PlatformStorageSettingsService` or `publiractl storage set`: bucket, region, endpoint, path-style mode, public base URL, and an optional access key. No process reads it from its environment. `publira server` (the tenant console's uploads and images on the admin pool, the storefront's images and the readers' icon uploads on the public pool), the worker's `maintenance.purge_orphan_images`, and `publiractl job purge-orphan-images` each resolve it from that row and read the row again every 30 seconds (`platformstorage.RefreshInterval`), so a saved change reaches every process without a restart.

Every process starts with nothing saved. Until something is, an upload fails with `FailedPrecondition` and the `STORAGE_NOT_CONFIGURED` reason, an image answers `503`, and the orphan sweep fails (the worker cancels the job).

- An access key saved with the configuration is stored encrypted, so each of those processes needs `PUBLIRA_SECRET_ENCRYPTION_KEYS` / `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID` to use it.
- Without one, each process signs with the credential the AWS SDK finds for itself: `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`, a web identity token, or an instance role.

### Initializing the bucket

Creating the bucket is not the application's responsibility (it is never created from a regular request). In the development environment, the following task prepares it idempotently:

```bash
task storage:init
```

It creates `PUBLIRA_S3_BUCKET` with the aws CLI, succeeds as-is when the bucket already exists, and saves that bucket (with `PUBLIRA_S3_ENDPOINT`, `PUBLIRA_S3_FORCE_PATH_STYLE`, and `AWS_REGION`) as the platform's object store with `publiractl storage set`, signed with the ambient credential. It runs that command through `go run`, or through the binary `PUBLIRA_PUBLIRACTL` names when that is set, as the E2E stack sets it to its own `server/bin/publiractl`. Those variables are read by the scripts alone. `task dev` runs it before starting each server. `task setup`, the E2E preparation, and the bootstrap check run `task storage:seed` instead, which creates the bucket the same way and then uploads the images the development seed's rows name. Production buckets are out of scope and are provisioned separately, together with their IAM and lifecycle settings.

### Development environment (RustFS)

The Dev Container starts the S3-compatible RustFS and connects to it path-style (endpoint `http://rustfs:9000`, bucket `publira`, with the local-only credentials `publira` / `publirapass`). The console URL is under [Dependency services](../CONTRIBUTING.md#dependency-services) in `CONTRIBUTING.md`, and the values to export on the host under [Environment variables on the host](../CONTRIBUTING.md#environment-variables-on-the-host).

The Go integration tests against RustFS use the Testcontainers helper `StartRustFS` in `internal/testutil` to verify uploads in `internal/storage/s3` and fetches in `internal/imageserver` (skipped under `-short` or without Docker).

## Image delivery (Manael)

After checking permissions, the image routes of `publira server` convert JPEG/PNG/GIF to WebP or AVIF with [Manael](https://github.com/manaelproxy/manael) and resize them with `w` / `h` / `fit` / `q`. The converted result is kept in an intermediate cache, so the same `Accept` and query does not hit S3 or run the conversion again.

For episode body images on a tenant site, the cached converted plaintext is never returned as-is: the server encrypts it just before the response, bound to a JWT and its `sub`. An encrypted response has `Content-Type: application/octet-stream`, and the following headers are the decryption contract. Non-body public images — the tenant icon and logo, eye catches, creator images — and every response on a console host remain ordinary image responses, because the console renders bodies with an `<img>` that cannot decrypt.

The preview of a withheld body, `GET /images/episodes/{media_id}/preview`, is not a body image in this sense and is never encrypted: it is a JPEG rendered by `imageproc.BuildEpisodePreview` from the page's smallest stored rendition, the same bytes for every reader, cached under a key of its own and served `public`. It answers for the episode's opening pages (`imageproc.EpisodePreviewPageCount`) once the episode is published, applies neither the price nor the tenant's age rule, and ignores `w` / `h` / `fit` / `q` and `Accept`.

| Header | Value / meaning |
| --- | --- |
| `X-Publira-Image-Encryption` | `xor-hmac-sha256-v1` |
| `X-Publira-Image-Content-Type` | The MIME type after decryption (`image/webp` / `image/avif`, and so on) |
| `X-Publira-Image-Key-Id` | An opaque identifier for the converted rendition |

`xor-hmac-sha256-v1` takes the JWT string as the HMAC key, computes HMAC-SHA-256 over `"publira:image:xor-hmac-sha256:v1\\0" + sub + "\\0" + key-id`, and uses that output as the HMAC key. It then XORs the body with a 32-byte stream produced by HMAC-SHA-256 over the 8-byte big-endian block number. The client performs the same steps with the `t` in the URL (or the Bearer JWT it sent), the JWT's `sub`, and the headers above.

Which JWT a body is bound to depends on which rule let the request through:

| Body | Bound to | `Cache-Control` |
| --- | --- | --- |
| Unlocked by a grant — a purchase, a ticket, or a credit on the episode | The credential the request carried — the `Authorization` bearer, or the reader's media token on the URL — and its `sub` | `private, max-age=60` |
| Free (`price = 0`) | The episode's rotating media token (see [`internal/auth`](internal/auth/doc.go)) and its synthetic `sub` | `public, max-age=3600` |

- `PUBLIRA_REDIS_URL`: Redis for the conversion cache. Unset / `disabled` / `off` / `false` means in-process memory only. A `redis://` URL carrying a password stops the process at startup, because that scheme has no TLS: use `rediss://`
- `PUBLIRA_IMAGE_CACHE_TTL`: TTL of the conversion cache (a Go duration or a number of seconds; default `1h`)

Building requires libvips. For the details, see [cmd/publira/README.md](cmd/publira/README.md).

## Platform Console URL

- `PUBLIRA_PLATFORM_APP_URL`
  - The base URL of the Platform Console that the worker builds the password reset and email change confirmation links from
  - Example: `https://platform.example.com`
  - When unset, `http://platform.localhost:3080` is used for local development

## Internal URLs for Next.js revalidation

With `PUBLIRA_REVALIDATE_TOKEN` set, a write records the cache tags it leaves stale as a `next_cache_revalidation` outbox event, and the tags are sent to the internal Route Handler `POST /api/v1/revalidate` in each Next.js app — by `publira server` as soon as the write commits, and by `publira worker` for whatever that attempt did not finish. The tags go to every app whose URL is set, and an app without one is not a destination, so a deployment that runs no Platform Console leaves `PUBLIRA_WEB_PLATFORM_INTERNAL_URL` unset. Both processes log their destinations at startup, and refuse to start when the token is set with none of the three, or with one that is not an absolute URL.

- `PUBLIRA_WEB_STOREFRONT_INTERNAL_URL` (for example `http://web-storefront:3000`)
- `PUBLIRA_WEB_ADMIN_INTERNAL_URL` (for example `http://web-admin:4000`)
- `PUBLIRA_WEB_PLATFORM_INTERNAL_URL` (for example `http://web-platform:4100`)

These are URLs reachable inside the private network, not the public ones meant for browsers. The URL a payment provider returns the browser to is built from the tenant's `domain` on the scheme in `PUBLIRA_TENANT_URL_SCHEME`, not from any of them.

## Web service credential

`PUBLIRA_WEB_SERVICE_TOKEN` is a secret `publira server` shares with the web apps, sent as `Authorization: Bearer <token>`, so that a console can read data every one of its operators sees alike without an operator's session and cache the answer for all of them. Unset, the bearer is not recognized and both APIs accept operator sessions alone.

On the admin API the call runs as a service principal of the tenant the request names, with no user and no role, and only on these RPCs; any other answers `permission_denied`:

- `AdminGenreService/ListGenres`
- `AdminCreatorRoleService/ListCreatorRoles`
- `AdminCreatorService/ListCreators`
- `AdminLabelService/ListLabels`, `GetLabel`
- `AdminSeriesService/ListSeries`, `GetSeries`, `ListEpisodes`, `GetEpisode`, `ListEpisodeCredits`
- `AdminDashboardService/GetDashboard`

On the platform API it runs as a service principal with no operator and no platform role, and only on these RPCs; any other behind the platform session answers `permission_denied`:

- `PlatformTenantService/ListTenants`, `GetTenant`, `ListTenantMembers`, `ListTenantAdminInvitations`
- `PlatformPolicyService/GetPlatformPolicy`, `GetPlatformRetentionDefaults`
- `PlatformSettingsService/GetPlatformSettings`
- `PlatformEmailSettingsService/GetPlatformEmailSettings`
- `PlatformStorageSettingsService/GetPlatformStorageSettings`
- `PlatformDashboardService/GetDashboardSummary`
- `PlatformOperatorService/ListOperators`, `GetOperator`
- `PlatformUserService/ListEndUsers`, `GetEndUser`

`PlatformSetupService/CreateInitialUser`, which creates the first operator with the `platform_super_admin` role while the platform has none, takes the credential as well, and is refused with `unauthenticated` to any caller without it. An install whose first operator has not been created yet, or that runs no Platform Console at all, would otherwise hand the platform to whoever reaches `publira server` first: the edge answers the Platform Console's API itself, but a caller on the private network, or an edge that forwards that API after all, reaches it. The Platform Console's setup screen sends the credential from its server. `CheckSetupStatus` stays open, since the setup screen asks it before anyone has signed in.

## Email renderer

- `PUBLIRA_EMAIL_RENDERER_URL`
  - The URL of the ConnectRPC service that the worker uses to render the HTML part of its emails
  - Example: `http://email-renderer:8080` (container-to-container)
  - When unset, the worker delivers text-only mail. There is no default URL

## Catalog search

The public catalog searches (`SearchPublishedSeries`, `SearchPublishedCreators`, `SearchPublishedLabels`) find their hits through the engine the platform's search settings name, and read what they show from the database either way. No environment variable configures it: the engine is a singleton row, `platform_search_config`, saved through the Platform API's `PlatformSearchSettingsService` or `publiractl search set`, and a platform that has saved none searches on `sql`.

| Engine | What it is |
| --- | --- |
| `sql` | A substring match in PostgreSQL, ordered by title or name. A series search can be narrowed and sorted by every filter and order `ListPublishedSeries` takes. It needs nothing else |
| `opensearch` | OpenSearch, ranked by relevance, matching a Latin word with one wrong character and a title written in Han, kana, or Hangul by a part of it, and whatever more a locale's own analysis built on its plugin matches, such as a title written in kanji from a query typed in kana. A series search can be narrowed and sorted by every filter and order `ListPublishedSeries` takes, and is ranked by relevance when it names no order |
| `elasticsearch` | Elasticsearch, searched and written exactly as `opensearch` is: the index definition, the queries, the bulk writes, and the alias swaps are common to both, and the backend's integration tests run against an Elasticsearch 9 node as well as an OpenSearch one. The engine is reached with HTTP basic auth or none, so an API key and a private CA are not supported: a node with security on needs a certificate the server already trusts |

An engine other than `sql` is saved with its `http://` or `https://` URL, the alias the catalog indices are named after (`publira-catalog` unless given; give each environment sharing a cluster an alias of its own), and optionally an HTTP basic auth username and password, which need an `https://` URL. The password is sealed with `PUBLIRA_SECRET_ENCRYPTION_KEYS` and never returned. The default analysis needs no plugin, so the `opensearchproject/opensearch` and `elasticsearch` images run it as they ship; a definition built on a language's plugin needs that plugin on every node (see [Text analysis](#text-analysis)). [`infra/docker/opensearch`](../infra/docker/opensearch/Dockerfile) builds an OpenSearch image with `analysis-kuromoji`, `analysis-icu`, `analysis-nori`, and `analysis-smartcn`, and the root `compose.yaml` runs it in its `search` profile. `TestPlatformSearchConnection` and `publiractl search test` report the product and version the engine answers with and the plugins every node has installed, which an engine lists only to a user with the cluster privilege to ask; no plugin, and no refusal to list them, decides the test.

The engine keeps one catalog index for each locale a reader can search in (`locale.Supported`), behind the saved alias with the locale appended in lowercase — `publira-catalog-ja`, `publira-catalog-zh-hans` — and each holds every tenant's series, creators, and labels. A series document in a locale's index carries the title and the synopsis `series_translation_for` picks for that locale, so a series with no translation in it is found by the one shown in its place, and a title order sorts by that title; a creator's or a label's document is the same in every index. `SearchPublishedSeries` searches the index of the request's `locale`, and `SearchPublishedCreators` and `SearchPublishedLabels`, which take none, the index of the tenant's default locale. On `sql` the scans match the same translation. Every index is built from the saved analysis, or from its locale's own (see [Text analysis](#text-analysis)).

A save does not move the search onto an index nobody has built. The row keeps the saved configuration and the one the search answers from side by side:

- `sql`, or the engine, URL, alias, and analysis of every locale the search already answers from with other credentials, is answered from at once.
- Any other target, or another analysis on the same one, is built by the worker's `maintenance.build_search_index` job, and so is the target the search answers from when its indices were built for other locales than the server searches in, which the row records as `serving_locales`, or, for a locale built from the default analysis, from another default than the server ships, whose version the row records as `serving_default_analysis_version` (`opensearchbackend.DefaultAnalysisVersion`): a release that adds a locale or changes the default, and an install still on the single index from before the catalog was indexed per locale, get their indices this way with nothing saved. The job looks for a build every 30 seconds and fills the indices from the database, and the search moves onto them once they hold the catalog. Until then `publira server` keeps answering from the previous indices, and the worker writes every `catalog_index_sync` event into both targets, or into the serving aliases alone when the build fills new indices behind the same aliases and writes every tenant again once they have moved. A build for other locales counts as a target of its own here, since it fills indices behind aliases the search does not read yet. The single index of an install that predates per-locale indices is left behind the saved alias itself once the search has moved off it, and nothing reads or writes it after that.
- A build that fails is recorded on the row and reported by `GetPlatformSearchSettings` and `publiractl search show`; the search stays where it was, and the job tries again on its next pass.

`publira server` and `publira worker` reread the row within 30 seconds, so a save reaches them without a restart. Every write to a series, a creator, or a label, and every write to an episode or a free window that changes what its series is narrowed or sorted by, queues a `catalog_index_sync` outbox event in its own transaction; so do the ticker jobs when a free window opens or closes and when a scheduled episode is published. A save that changes a tenant's locales queues one naming the whole tenant, since the translation a series falls back to in a locale it has none in moves with the default locale. The worker rewrites the named row's document from the database, or replaces it with a tombstone no search finds when the row is published nowhere, and once a search can find that write it records a `next_cache_revalidation` for the cache tag web-storefront holds the searches of that kind under; on `sql` with no build due it marks those events done as it claims them. `publiractl search reindex` rebuilds the index on the saved engine, for a mapping a release changed or an index that was lost; see [publiractl](cmd/publiractl/README.md#search).

### OpenSearch on a development machine

Ordinary development needs no engine: the search stays on `sql` until another is saved. To work on the OpenSearch backend, start the one the root `compose.yaml` keeps in its `search` profile:

```bash
docker compose --profile search up -d
```

It is a single node built from [`infra/docker/opensearch`](../infra/docker/opensearch/Dockerfile), with the security plugin off, so it answers plain HTTP without credentials on `http://127.0.0.1:9200`, and it keeps its index in the `opensearch-data` volume. Inside the Dev Container, `docker compose --profile search up -d opensearch` starts it on the container's own Docker daemon, which publishes it on the same loopback address. Then save it as the platform's engine:

```bash
go -C server run ./cmd/publiractl search set --engine opensearch --url http://127.0.0.1:9200
```

A running worker builds the index from the seeded database within 30 seconds, and `go -C server run ./cmd/publiractl search reindex` builds it at once instead. `publiractl search set --engine sql` moves the search back to PostgreSQL.

### Text analysis

The mapping of the catalog index is the server's: the searches name its fields, and the documents are written to it. Its `settings.analysis` is the platform's, one definition for every tenant, since they share the indices, and for the index of every locale that has none of its own. It is saved as a JSON object through `UpdatePlatformSearchSettings` (`analysis_update_mode` and `analysis`) or `publiractl search set --analysis-file`, and put back to the default with `--default-analysis`. `GetPlatformSearchSettings` answers the definition in use, the default included. The default, [`analysis.json`](internal/catalogsearch/opensearchbackend/analysis.json), is built only on what OpenSearch and Elasticsearch include without a plugin: the `standard` tokenizer with `cjk_width`, `lowercase`, and `cjk_bigram`, which matches Latin text by its words and Han, kana, and Hangul by overlapping pairs of characters, with no alternate form. A platform that wants more of a language, such as a title written in kanji found from its reading typed in kana, gives that locale a definition of its own built on the language's plugin: `analysis-kuromoji` and `analysis-icu` for Japanese, `analysis-nori` for Korean, or `analysis-smartcn` for Chinese, all published for both engines.

A locale's own definition replaces the shared one for that locale's index alone, so a platform can build `publira-catalog-ja` from a definition on `analysis-kuromoji` and every other locale's index from the default. `UpdatePlatformSearchSettings` takes them in `locale_analyses`, one change per locale — `REPLACE` with a definition, `SHARED` to build the locale from the shared one again — and keeps every locale the request does not name, so a client that knows only the shared definition keeps them all. `publiractl search set` takes them as `--locale-analysis-file <locale>=<file>` and `--shared-analysis-for <locale>`. `GetPlatformSearchSettings` answers them in `locale_analyses`, and `publiractl search show` names the locales that have one. The row keeps them in `locale_analyses` as one JSON object from a locale to its definition, beside `analysis`, and the serving configuration the ones its indices were built with in `serving_locale_analyses`.

Every definition, shared or a locale's own, has to define the three names the mapping refers to, one per role:

| Name | Kind | Role |
| --- | --- | --- |
| `written_form` | analyzer | The title, the name, and the synopsis as they are written |
| `alternate_form` | analyzer | The alternate form a query may be typed in, which a title is also indexed in, and which an entered reading is analyzed in, such as the kana reading of a Japanese title. A language with no alternate form, and the default, make it the written form again |
| `exact_match` | normalizer | The exact match of a title or a name, which ranks above any partial match, and the order of the hits of one score |

A save refuses a definition over 64 KiB, one that is not a JSON object, one missing a role, and one the engine will not create an index from: whenever a save changes a definition, or takes a saved one to another target, the server creates an empty index beside the alias with it and drops it again, and the engine's reason is the refusal. A locale's own definition is refused on `locale_analyses[i].analysis`, the change that gave it, with a message naming the locale. An engine that cannot be asked refuses the save as `unavailable`. Nothing is written either way.

A saved definition is built like a new target, for the locales whose analysis it changes: the worker fills a new index behind each of their aliases from the database and moves those aliases onto them, leaves the indices of the other locales as they are, and the storefront answers from the indices it has until then. Whatever the definition, a query with a Han, Hiragana, Katakana, or Hangul character in it is never matched fuzzily, since one edit there makes another word rather than a typo, and is matched in the alternate form as well.

## Disposable email domains

`internal/disposabledomains` answers whether an email domain, or a domain it is a subdomain of, belongs to a service made for throwaway addresses. No list ships with the server: it is read from the URL in the platform policy's `disposable_email_domains_url`, saved through `PlatformPolicyService` or `publiractl policy set --disposable-email-domains-url`, and a platform that names none has no domain disposable.

The list has one domain per line, with blank lines and lines starting with `#` ignored — the format of the [disposable-email-domains](https://github.com/disposable-email-domains/disposable-email-domains) blocklist, whose `disposable_email_blocklist.conf` can be named directly.

A tenant applies the list to reader sign-up (`CreateUser`) and to a reader's email change (`RequestEmailChange`) by switching it on through the Admin API's `TenantSettingsService.UpdateTenantEmailRejectionSettings`, which also stores the addresses and domains the tenant refuses itself; `internal/emailrejection` holds the matching rules. The switch is off until the tenant turns it on, and `GetTenantEmailRejectionSettings` answers whether the platform names a list, since a switch with no list behind it refuses nothing. A refused address is `invalid_argument` on the address field, with the field violation's reason `EMAIL_DISPOSABLE_DOMAIN` or `EMAIL_REFUSED`.

## Mobile push (Firebase Cloud Messaging)

The worker mirrors member notifications onto the devices the mobile app registered, over FCM HTTP v1. Firebase relays to APNs for iOS once the APNs auth key is uploaded to the project, so one integration covers both platforms.

No environment variable configures it. Each tenant ships its own build of the app with its own Firebase project, so the credentials are a tenant setting: a tenant administrator saves the project id and a service account key through the Admin API's `AdminFcmSettingsService`, and the key is sealed with `PUBLIRA_SECRET_ENCRYPTION_KEYS` before it is stored. The key is refused unless it is a `service_account` credential for that same project, since FCM HTTP v1 accepts no other kind. No RPC returns it: a read answers whether credentials are stored and which project and service account they name.

The worker reads the tenant's credentials for each delivery and rereads them at most every ten seconds, so a replacement or a removal reaches it without a restart. A tenant with no credentials has mobile push off: its devices are skipped and kept, and its Web Push and bell notifications are delivered as usual.

A send reaches the devices it can. A run that reached none of them is retried as an outage; one that reached some completes, because a retry re-runs the whole send and FCM keeps no delivery record, so the devices that already took the message would take it again once per remaining attempt. The devices a partial run could not reach lose that alert and keep the `notifications` row behind it.

## Web Push

The public site registers browser subscriptions and the worker delivers them with VAPID. No environment variable configures it: the key pair is a platform setting generated the first time the Platform API's `GetPlatformWebPushSettings` is called or `publiractl webpush init` runs, with the private key sealed by `PUBLIRA_SECRET_ENCRYPTION_KEYS`. A process started without those keys cannot generate one: the read answers `failed_precondition`, and `publiractl webpush init` exits non-zero.

Web Push is off until an operator saves a subject — the `mailto:` or `https:` contact a push service may reach the sender at — through `UpdatePlatformWebPushSubject` or `publiractl webpush init`. Until then web registrations are refused, the tenant response carries no public VAPID key, and the worker sends nothing to a browser. Each process rereads the setting every ten seconds, so a saved subject reaches every instance without a restart. A push service response of `410 Gone` removes the expired subscription.

## Distributed tracing (OpenTelemetry)

Every process under `cmd/*` emits OpenTelemetry traces. **It is disabled by default**: unless `PUBLIRA_TRACING_ENABLED` is set, neither the TracerProvider nor the propagator is replaced, and the behavior is exactly what it was before the instrumentation was introduced (the processes start without any collection backend).

### What gets a span

| Layer | Instrumentation | Span |
| --- | --- | --- |
| Inbound Connect / gRPC | `connectrpc.com/otelconnect` | One per RPC, named `AdminSeriesService/ListSeries` (the proto package is dropped from the name because the `rpc.service` attribute carries it) |
| Inbound plain HTTP (the image routes) | `otelhttp` | One per route pattern (`GET /images/creators/{media_id}`). `/livez` and `/readyz` are excluded |
| DB queries | `XSAM/otelsql` (wrapping the pgx driver in `internal/sqldb`) | One `db.query` per statement |
| The scheduled publication batch | `internal/publishepisodes` | One parent span per `RunOnce` cycle |
| A maintenance job's run on the worker | `internal/maintenancejobs` | One parent span per pass, named by its River kind (`maintenance.aggregate_content_stats`) and carrying `river.job.id` and `river.job.attempt`. A failed pass sets the span's status to error |
| The Outbox worker | `internal/outbox` | One per drain and one per processed event (`outbox.drain` / `outbox.process`) |
| Outbound HTTP (Next.js revalidation / email-renderer) | The `otelhttp` Transport | A client span and `traceparent` propagation |

Propagation uses W3C Trace Context (`traceparent`) and Baggage. An inbound `traceparent` is **trusted as the parent**, which is what connects the web app, the API, and the DB queries beyond it into a single trace. It can be trusted because the gateway strips inbound headers; the next section describes that boundary.

### Trace context arriving from outside

**The trust boundary lives at the gateway**: `traceparent` / `tracestate` / `baggage` are removed from every request that came through a public entrypoint, as default middleware on that entrypoint.

| Environment | Where it is stripped |
| --- | --- |
| Development | Traefik in `.devcontainer/compose.yaml`. The `web` entrypoint gets the `strip-trace-context` middleware (empty values in `headers.customRequestHeaders`) by default |
| Production | The gateway's external entrypoint removes the same three headers before passing the request to the backend |

Because the headers are gone, the RPC becomes a **new root span** on the API side. The caller's trace ID is not adopted, and setting `sampled=01` does not override the 10% sampling in production. A trace is joined up only inside the gateway.

First-party server-to-server traffic does not pass through the gateway, so this removal does not apply to it. SSR (web-storefront / web-admin / web-platform) connects directly to the API's gRPC port, and publira server and worker call the Next.js revalidation endpoints directly through `PUBLIRA_WEB_*_INTERNAL_URL`. `traceparent` passes through in both cases, so "web app → API → DB query" remains a single trace.

The mobile app and the browser run on the user's device, so they are not first-party and their trace context is stripped at the gateway.

The stripping by Traefik in the development environment is verified by the connectivity checks in [`../e2e/routing/README.md`](../e2e/routing/README.md), which send requests that actually carry those headers.

### Operational monitoring for the asynchronous audit log

The asynchronous audit logs of the tenant and the platform console namespaces record the following low-cardinality OpenTelemetry metrics. `auditlog.entry_type` is `platform` or `tenant`, and `auditlog.drop_reason` is one of `queue_full`, `retry_exhausted`, and `shutdown`. Neither `action` nor the tenant ID is included as a metric attribute.

| Metric | Kind | Meaning |
| --- | --- | --- |
| `publira.auditlog.queue.depth` | gauge | Events queued and waiting to be persisted |
| `publira.auditlog.entries.enqueued` | counter | Events accepted into the queue |
| `publira.auditlog.entries.persisted` | counter | Events persisted asynchronously |
| `publira.auditlog.persist.failures` | counter | Failed persistence attempts (retries included) |
| `publira.auditlog.entries.dropped` | counter | Events dropped before being persisted |

Persistence retries, final drops, queue overflows, and shutdown drain deadlines are written to the structured log too. A continuously growing `queue.depth`, `persist.failures`, and `entries.dropped` are candidates for alerting. The meters are exported once metrics are turned on; see [Metrics (OpenTelemetry)](#metrics-opentelemetry).

### Resource attributes

| Key | Value |
| --- | --- |
| `service.name` | `publira server` resolves it per Connect namespace, because it serves all three from one process: `publira-api-server` for `publira.v1`, `publira-admin-api-server` for `publira.admin.v1`, and `publira-platform-api-server` for `publira.platform.v1`, with the first of them also carrying what is not an RPC — the database spans and the outbound calls — and `publira-image-server` for the image routes. `publira worker` defaults to `publira-worker` and adds one per periodic job on top — `publira-publish-episodes` / `publira-apply-free-windows` / `publira-roll-tenant-day` / `publira-expire-pinned-announcements` / `publira-apply-series-publications` / `publira-apply-campaign-banners` / `publira-apply-campaign-prices` — and one per maintenance job, the same name `publiractl job` reports for that job, carried by the span each run hangs off, so they stay apart in a trace UI now that they share a process. `publira server --with-worker` resolves the union of both, with `publira-api-server` as the default and the Outbox drain's spans still under `publira-worker`. `publiractl job` resolves it per job, so it becomes `publira-project-episode-reads` / `publira-aggregate-content-stats` / `publira-aggregate-rankings` / `publira-purge-content-events` / `publira-purge-ranking-snapshots` / `publira-purge-mfa-challenges` / `publira-purge-withdrawn-comments` / `publira-purge-orphan-images` / `publira-build-recommend-features` / `publira-close-royalty-statements` / `publira-sync-google-play-voided-purchases`. Overridable with `OTEL_SERVICE_NAME` |
| `service.version` | The version embedded at build time; otherwise the VCS revision of the checkout, and otherwise `dev` (`internal/buildinfo`) |
| `deployment.environment.name` | `PUBLIRA_DEPLOYMENT_ENVIRONMENT`, or `development` when unset |

A container build carries no `.git`, so pass `VERSION` (`task docker:build:server VERSION=v1.2.3`) to stamp the version into the binary. Without it the value is `dev`.

### Span attributes

On top of the standard attributes that `otelconnect` / `otelhttp` / `otelsql` add (`rpc.system` / `rpc.service` / `rpc.method`, `http.request.method` / `http.route`, `db.system.name`), the following are set.

| Key | When |
| --- | --- |
| `tenant.public_id` | After the tenant is resolved (the tenant-scope interceptor in Connect, and host resolution on the image routes) |
| `enduser.id` | After authentication succeeds. The value is the public ID |
| `db.operation.name` | The SQL keyword (`SELECT` / `INSERT` / …) |
| `db.query.summary` | The query name taken from sqlc's `-- name: GetTenantByID :one` |
| `db.query.text` | The generated SQL statement. sqlc emits it with placeholders (`$1`) intact, and argument values are never recorded |
| `server.address` / `server.port` | Every database span and query metric: the host and port of the server the pool connects to, so a query a read replica answered is told from one the primary did |

Email addresses, raw tokens, passwords, request bodies, and the `Authorization` header are never put on a span. Using public IDs instead of internal UUIDs is part of the same policy.

### Sampling

Sampling is parent-based, and only the handling of root spans changes with the deployment environment.

| `PUBLIRA_DEPLOYMENT_ENVIRONMENT`            | Root span |
| ------------------------------------------- | --------- |
| `development` (default)                     | All       |
| Anything else (`staging` / `production`, …) | 10%       |

Setting `OTEL_TRACES_SAMPLER` bypasses these defaults and lets the SDK interpret the value. Heavy attributes such as `db.query.text` are only attached to sampled spans, so in production the full SQL text is only present on the sampled 10%.

### Correlation with logs

The slog handler in `internal/logging` adds `trace_id` / `span_id` to logs recorded with a `context.Context` that carries a span (the `*Context` methods such as `ErrorContext`). Each API's `internalDBError`, the shared path for DB errors, goes through it, so a `trace_id` from the logs can be searched directly in Jaeger or a similar tool.

### Environment variables

Only two variables are our own — the enable flag and the deployment environment. The rest are read by the OpenTelemetry SDK itself, so their names are unchanged.

| Variable | Purpose |
| --- | --- |
| `PUBLIRA_TRACING_ENABLED` | Enables tracing (`true` / `1`, and so on). Unset or uninterpretable values mean disabled |
| `PUBLIRA_DEPLOYMENT_ENVIRONMENT` | `development` (default) / `staging` / `production`. Determines `deployment.environment.name` and the default sampling rate |
| `OTEL_TRACES_EXPORTER` | `otlp` (default) / `console` / `none` |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` / `grpc` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | The destination (for example `http://jaeger:4318`) |
| `OTEL_SERVICE_NAME` | Overrides `service.name` |
| `OTEL_RESOURCE_ATTRIBUTES` | Additional resource attributes |
| `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` | The sampler. Setting it bypasses the defaults above |

To watch the behavior without a collection backend, `OTEL_TRACES_EXPORTER=console` prints spans to standard output.

```bash
PUBLIRA_TRACING_ENABLED=true OTEL_TRACES_EXPORTER=console task server:dev-server
```

The Dev Container bundles Jaeger, with its UI at `http://localhost:16686`, and passes the processes `PUBLIRA_TRACING_ENABLED=true` and its OTLP endpoint; [Dependency services](../CONTRIBUTING.md#dependency-services) in `CONTRIBUTING.md` lists its ports. Leaving `PUBLIRA_DEPLOYMENT_ENVIRONMENT` unset there samples every root span.

## Metrics (OpenTelemetry)

`publira server` and `publira worker` export OpenTelemetry metrics. **They are disabled by default**: unless `PUBLIRA_METRICS_ENABLED` is set, no MeterProvider is installed, every instrument records into OpenTelemetry's no-op one, and nothing is exported. The flag is separate from `PUBLIRA_TRACING_ENABLED` because a backend that accepts traces does not necessarily accept metrics — the Dev Container's Jaeger does not.

Each process reports under one `service.name`, its default: `publira-api-server` for `publira server` and `publira-worker` for `publira worker`. `publira server --with-worker` reports under `publira-api-server`, the Outbox instruments included. The other resource attributes are those of its traces ([Resource attributes](#resource-attributes)). `publiractl job` exports none: it exits after one pass.

What is recorded:

| Instruments | Process | Where they are described |
| --- | --- | --- |
| `publira.outbox.*` | `publira worker` | [`cmd/publira/README.md`](cmd/publira/README.md#logs-and-metrics) |
| `publira.auditlog.*` | `publira server` | [Operational monitoring for the asynchronous audit log](#operational-monitoring-for-the-asynchronous-audit-log) |
| `http.server.*` (the image routes) and `http.client.*` (revalidation, email-renderer) | both | `otelhttp`'s semantic conventions |
| `db.client.operation.duration` (every database call, by `database/sql` method) | both | `XSAM/otelsql` |

Connect RPCs record no metrics (`otelconnect.WithoutMetrics`); their latency is on their spans.

| Variable | Purpose |
| --- | --- |
| `PUBLIRA_METRICS_ENABLED` | Enables metrics (`true` / `1`, and so on). Unset or uninterpretable values mean disabled |
| `OTEL_METRICS_EXPORTER` | `otlp` (default) / `prometheus` / `console` / `none` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | Where `otlp` pushes to. `OTEL_EXPORTER_OTLP_PROTOCOL` / `OTEL_EXPORTER_OTLP_METRICS_PROTOCOL` pick `http/protobuf` or `grpc` |
| `OTEL_METRIC_EXPORT_INTERVAL` | Milliseconds between pushes. Default `60000` |
| `OTEL_EXPORTER_PROMETHEUS_HOST` / `OTEL_EXPORTER_PROMETHEUS_PORT` | Where `prometheus` serves `/metrics`. Default `localhost:9464`, which nothing outside the container can reach: set the host to `0.0.0.0` to scrape it. Two processes sharing one network namespace — a Kubernetes pod, or host networking — need a port each, or the second cannot listen and exports nothing |

Every variable but the first is read by the OpenTelemetry SDK itself. With `otlp`, a process that shuts down pushes what it recorded since the last push before it exits; with `prometheus` nothing is pushed, so what happened after the last scrape leaves with the process.

```bash
PUBLIRA_METRICS_ENABLED=true OTEL_METRICS_EXPORTER=console task server:dev-worker
```

## Secret encryption configuration (AES-GCM)

There is a foundation for encrypting secrets at rest with AES-GCM. For now, set the following environment variables when it is applied to a path that stores a secret field.

- `PUBLIRA_SECRET_ENCRYPTION_KEYS`
  - Format: `key-id-1:base64key,key-id-2:base64key`
  - `base64key` is a 16/24/32-byte AES key encoded in Base64 (standard or URL-safe)
- `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID`
  - Names a key-id contained in `PUBLIRA_SECRET_ENCRYPTION_KEYS`
  - New encryptions use this key-id

A sealed value names the key that sealed it (`enc:v1:<key-id>:…`), so any key in the set opens it, and a value saved again with the same plaintext is sealed again under the primary key (`secretupdate.KeepIfSame`). `publiractl db reseal` seals every stored value again under the primary key without anyone saving it, which is what lets a rotation remove the old key. Rotating a key is an operator procedure: [Rotating the secret encryption keys](../docs/en/3-operations/12-security/1-rotating-secrets.md#rotating-the-secret-encryption-keys).

Notes:

- Never log a key or a plaintext
- On an encryption or decryption failure, do not continue — treat it as a failure

## Authentication (JWT access tokens)

The API issues **HS256 JWT access tokens** from an email address and a password (`Login` / `Logout`), from an Apple or Google ID token (`LoginWithIdToken`), or, on the storefront, from a passkey alone (`BeginPasskeyLogin` / `FinishPasskeyLogin`).  
Browser cookies are managed on the Next.js side as JWE with `jose`, and only `Authorization: Bearer <token>` is sent to the API.

| Item | Value |
| --- | --- |
| Environment variable | `PUBLIRA_AUTH_JWT_SECRET` (**required**, at least 32 bytes. There is no fallback: if it is unset or too short, `publira server` fails to start. Whoever holds it can sign a token with any `sub` and audience and call every API and the image routes, so issue one per environment, for example with `openssl rand -base64 32`) |
| TTL | 24h |
| Audience | `public` / `admin` / `platform` / `media` / `admin-media` / `admin-mfa-verify` / `admin-mfa-enroll` / `platform-mfa-verify` / `platform-mfa-enroll` |
| Revocation | `users.credentials_version` / `platform_users.credentials_version` (incremented on a password change and the like) |
| Next cookie | `PUBLIRA_AUTH_SECRET` (**required**, at least 32 bytes. It is for JWE and is separate from the API's JWT secret. There is no fallback: if it is unset or too short, an exception is raised) / cookie names such as `publira_web_storefront_auth` |

### Sign in with Apple and Google

Each tenant enables the providers its readers may sign in with through the Admin API's `TenantSettingsService.UpdateTenantSignInSettings`: for Google, the OAuth client IDs of its web application and its iOS app; for Apple, the Services ID the storefront signs in with, and the team, key ID, and `.p8` key of a Sign in with Apple key. The iOS app signs in with the bundle identifier of the tenant's iOS app association. The key is sealed with `PUBLIRA_SECRET_ENCRYPTION_KEYS` before it is stored, and no RPC returns it. `TenantService.GetTenant` answers the providers that are ready and their public client IDs.

`AuthService.LoginWithIdToken` verifies the token against the provider's published keys (`https://appleid.apple.com/auth/keys`, `https://www.googleapis.com/oauth2/v3/certs`), refuses a nonce it has accepted before, and finds the reader by the linked provider account, by the address the provider vouches for, or creates one. While the tenant has closed sign-up through `TenantSettingsService.UpdateTenantSignUpSettings`, a sign-in that would create an account is refused, as `CreateUser` is, with `failed_precondition` and the reason `SIGN_UP_CLOSED`; a sign-in to an account that exists, whether through its link or its address, still succeeds. `LinkIdentity` links a provider account to the signed-in reader from a fresh ID token checked the same way, whatever address it carries, so a reader whose provider hides or differs from the account's address can still sign in to that account with it. `ListMyIdentities` and `UnlinkIdentity` manage the links; an account without a password or a passkey keeps its last one, and an account without a password confirms `DeleteMe` and `RequestEmailChange` with a fresh ID token or a passkey assertion instead.

An Apple sign-in or link may carry its authorization code. `publira worker` exchanges it at `https://appleid.apple.com/auth/token` for a refresh token the link keeps, sealed, and revokes that token at `https://appleid.apple.com/auth/revoke` when the link or the account is deleted (`apple_sign_in_code_exchange` / `apple_sign_in_token_revoke` outbox events).

### Passkeys on the storefront

A signed-in reader registers passkeys (WebAuthn) with `BeginPasskeyRegistration` / `FinishPasskeyRegistration` and manages them with `ListMyPasskeys` / `RenamePasskey` / `DeletePasskey`; `ListMyIdentities` reports `has_passkey`. The library (`internal/tenantwebauthn`), the ceremony storage (`user_webauthn_ceremonies`), and the stored credential (`user_webauthn_credentials`) are the console's.

| Item | Value |
| --- | --- |
| Relying party | The storefront's own host as the RP ID and its origin as the only one accepted, derived from the tenant row. Credentials and ceremonies carry `relying_party` (`site` or `admin_console`), so a console passkey never signs a reader in, and a storefront passkey is never a console factor, even where the two hosts share a hostname |
| Registration | A resident key and user verification required, since the passkey has to name the account by itself; the reader's existing passkeys excluded. At most 20 per account |
| Sign-in | `BeginPasskeyLogin` answers request options that name no account. `FinishPasskeyLogin` spends the ceremony, looks the credential up by its ID within the tenant and the storefront's RP ID, checks the assertion against the user handle, and issues a session as `Login` does. A refused assertion is `unauthenticated`, as a wrong password is |
| Sign-in ceremony | Kept in `user_webauthn_ceremonies` with no account until its finish. A begin spends none of the origin's sign-in allowance (`login_attempts_per_source`), which counts failed passwords; it keeps a digest of the origin instead, and drops all but the newest 100 sign-in ceremonies that origin has open on the tenant, along with the tenant's sign-in ceremonies that expired unfinished |
| Address | A passkey sign-in is refused for a suspended account and for one without `email_verified_at`, as `Login` refuses them. A passkey is registered from a session, and a session always began with a confirmed address, so registering one confirms nothing: it proves the reader holds the authenticator, not that the address is theirs |
| Last way in | `DeletePasskey` is `failed_precondition` for the last passkey of an account with neither a password nor a linked provider, and `UnlinkIdentity` lets such an account unlink its last provider while it holds a passkey. Only a passkey for the storefront's current host counts |
| Confirmation | `BeginPasskeyConfirmation` begins an assertion over the reader's own passkeys; its result goes in `passkey_credential_json` of `DeleteMe` or `RequestEmailChange` in place of a password or an ID token, and confirms that one request. A reader who owes an agreement to revised legal pages may still call it, as they may call `DeleteMe` |
| Flood control | `BeginPasskeyRegistration`, `RenamePasskey`, `DeletePasskey`, and `BeginPasskeyConfirmation` spend the reader's `passkey` allowance in the platform policy |

## API namespace separation

`publira server` (`server/cmd/publira`) serves all three Connect namespaces under `/rpc` on one listener, `:8000` (changeable with `PUBLIRA_PUBLIC_API_ADDR`), beside `GET /images/…`, `/livez`, and `/readyz`:

- `publira.v1` — `CatalogService`, `AuthService`, and the rest of the public API
- `publira.admin.v1` — `AdminSeriesService`, `AdminAuthService`, `AdminEngagementService`, and the rest of the tenant console's API
- `publira.platform.v1` — the Platform Console's API

The reverse proxy forwards `/images` and the public API's `/rpc/publira.v1.…` to it, prefixes kept, on every host, and answers the rest of `/rpc` itself, and web-storefront, web-admin, and web-platform dial the same listener directly over the private network. The proto packages produce non-colliding procedure paths, so one mux carries all three. The process answers every namespace on every path that reaches it: what keeps the consoles' RPCs off the internet is the edge, and behind it each refuses a caller without an operator session or the [web service credential](#web-service-credential) before any handler runs, and is answered on its own login. Next.js revalidation on a publication state change needs `PUBLIRA_REVALIDATE_TOKEN`, and its destinations are the `web-*` apps whose internal URL (`PUBLIRA_WEB_*_INTERNAL_URL`) is set.

## Database users

Each namespace connects with its own dedicated PostgreSQL login user, which keeps privileges minimal. `publira server` holds one pool per login and picks the pool by the namespace the procedure path names, so the three never share a connection; an image is answered on the `publira_public` pool on a storefront host and on the `publira_admin` pool on a console host.

| Namespace or process | DB user | Environment variable | Local default |
| --- | --- | --- | --- |
| `publira.platform.v1` | `publira_platform` | `PUBLIRA_PLATFORM_DB_URL` | `postgres://publira_platform:platformpass@db:5432/publira?sslmode=disable` |
| `publira.admin.v1` | `publira_admin` | `PUBLIRA_ADMIN_DB_URL` | `postgres://publira_admin:adminpass@db:5432/publira?sslmode=disable` |
| `publira.v1` | `publira_public` | `PUBLIRA_PUBLIC_DB_URL` | `postgres://publira_public:publicpass@db:5432/publira?sslmode=disable` |
| worker | `publira_outbox` | `PUBLIRA_WORKER_DB_URL` | `postgres://publira_outbox:outboxpass@db:5432/publira?sslmode=disable` |
| worker periodic jobs | `publira_ticker` | `PUBLIRA_TICKER_DB_URL` | `postgres://publira_ticker:tickerpass@db:5432/publira?sslmode=disable` |
| worker maintenance jobs | `publira_content_stats` | `PUBLIRA_CONTENT_STATS_DB_URL` | `postgres://publira_content_stats:contentstatspass@db:5432/publira?sslmode=disable` |
| publiractl db | the owner of the database and the schema, with `CREATEROLE` (the superuser locally) | `PUBLIRA_DB_URL`, with no fallback | none: the command refuses to run without it |
| publiractl job project-episode-reads | `publira_content_stats` | `PUBLIRA_EPISODE_READ_PROJECTION_DB_URL`, falling back to `PUBLIRA_CONTENT_EVENTS_DB_URL` → `PUBLIRA_CONTENT_STATS_DB_URL` → `PUBLIRA_DB_URL` | `postgres://publira_content_stats:contentstatspass@db:5432/publira?sslmode=disable` |
| publiractl job aggregate-content-stats | `publira_content_stats` | `PUBLIRA_CONTENT_STATS_DB_URL`, falling back to `PUBLIRA_DB_URL` | `postgres://publira_content_stats:contentstatspass@db:5432/publira?sslmode=disable` |
| publiractl job aggregate-rankings | `publira_content_stats` | `PUBLIRA_CONTENT_RANKING_DB_URL`, falling back to `PUBLIRA_CONTENT_STATS_DB_URL` → `PUBLIRA_DB_URL` | `postgres://publira_content_stats:contentstatspass@db:5432/publira?sslmode=disable` |
| publiractl job purge-content-events | `publira_content_stats` | `PUBLIRA_CONTENT_EVENTS_DB_URL`, falling back to `PUBLIRA_CONTENT_STATS_DB_URL` → `PUBLIRA_DB_URL` | `postgres://publira_content_stats:contentstatspass@db:5432/publira?sslmode=disable` |
| publiractl job purge-ranking-snapshots | `publira_content_stats` | `PUBLIRA_CONTENT_RANKING_DB_URL`, falling back to `PUBLIRA_CONTENT_STATS_DB_URL` → `PUBLIRA_DB_URL` | `postgres://publira_content_stats:contentstatspass@db:5432/publira?sslmode=disable` |
| publiractl job purge-mfa-challenges | `publira_content_stats` | `PUBLIRA_MFA_CHALLENGE_DB_URL`, falling back to `PUBLIRA_CONTENT_STATS_DB_URL` → `PUBLIRA_DB_URL` | `postgres://publira_content_stats:contentstatspass@db:5432/publira?sslmode=disable` |
| publiractl job purge-withdrawn-comments | `publira_content_stats` | `PUBLIRA_COMMENT_PURGE_DB_URL`, falling back to `PUBLIRA_CONTENT_STATS_DB_URL` → `PUBLIRA_DB_URL` | `postgres://publira_content_stats:contentstatspass@db:5432/publira?sslmode=disable` |
| publiractl job purge-orphan-images | `publira_content_stats` | `PUBLIRA_ORPHAN_IMAGES_DB_URL`, falling back to `PUBLIRA_CONTENT_STATS_DB_URL` → `PUBLIRA_DB_URL` | `postgres://publira_content_stats:contentstatspass@db:5432/publira?sslmode=disable` |
| publiractl job build-recommend-features | `publira_content_stats` | `PUBLIRA_RECOMMEND_FEATURES_DB_URL`, falling back to `PUBLIRA_CONTENT_STATS_DB_URL` → `PUBLIRA_DB_URL` | `postgres://publira_content_stats:contentstatspass@db:5432/publira?sslmode=disable` |
| publiractl job close-royalty-statements | `publira_content_stats` | `PUBLIRA_CONTENT_STATS_DB_URL`, falling back to `PUBLIRA_DB_URL` | `postgres://publira_content_stats:contentstatspass@db:5432/publira?sslmode=disable` |
| publiractl job sync-google-play-voided-purchases | `publira_content_stats` | `PUBLIRA_CONTENT_STATS_DB_URL`, falling back to `PUBLIRA_DB_URL` | `postgres://publira_content_stats:contentstatspass@db:5432/publira?sslmode=disable` |
| publiractl job build-search-index | `publira_content_stats` | `PUBLIRA_CONTENT_STATS_DB_URL`, falling back to `PUBLIRA_DB_URL` | `postgres://publira_content_stats:contentstatspass@db:5432/publira?sslmode=disable` |

`publira_platform`, `publira_content_stats`, `publira_outbox`, and `publira_ticker` access data across every tenant; `publira_admin` and `publira_public` have RLS enabled and are scoped by tenant ID. The first four are members of `publira_rls_bypass`, and the baseline seed puts a policy of that name on every table under row-level security that lets its members read and write every row, and none of them carries the `BYPASSRLS` attribute. The grants still decide which tables each of them reaches.

The platform console's own tables (`platform_*`) sit outside that split. They carry no row-level security — the console spans tenants, so a tenant isolation policy would have nothing to isolate on — which leaves the grant as the only control over the operators' password hashes and the platform SMTP credentials. The baseline seed therefore revokes every privilege on the whole `platform_` prefix from `publira_public`, `publira_admin`, `publira_content_stats`, and `publira_outbox`; matching the prefix rather than a list is what covers a table a later migration adds, since the blanket grants of the next seed run would otherwise grant it to all of them. `publira_platform` keeps them, `publira_public` is granted back read on the platform policy, on the columns of the Web Push settings that publish the public key, on the platform's default currency, and on the object store and the search engine, which the storefront's images, the readers' icon uploads, and the public API's search are read with, `publira_admin` read on the platform policy, the default currency, the retention defaults, and the object store, and on `from_address` alone of the platform SMTP settings, which is the address a tenant on the platform's mail is sent from, `publira_outbox` is granted back read on the six its mail and push paths need and on `platform_search_config`, which names the engines its catalog index handler writes to, and write on `platform_user_password_reset_tokens`, where it issues the console's reset links, `publira_content_stats` is granted back read on the retention defaults, the object store, the search engine, and the default currency a royalty statement is closed in, and write on the columns of the search engine a build moves, and `publira_ticker` — which the revoke does not name, holding no blanket grant to take away — reaches only the four its own per-table list gives it. `TestPlatformTablesAreOutOfReachOfTheTenantRoles` and its neighbours in `internal/db` read the prefix out of the catalog, so the day a tenth `platform_` table lands they assert on it too.

`PUBLIRA_WORKER_DB_URL` resolves on its own, with no fallback to `PUBLIRA_DB_URL`: leaving it unset lands on the development default in the table above and fails to authenticate anywhere that role's password is not `outboxpass`, rather than silently running the worker on the migration tooling's connection. Local development sets it to `publira_outbox` too — a `dev-env` profile writes that URL, and the Dev Container leaves the variable unset and takes the same role from the default — so the grants that role holds, `CREATE ON SCHEMA public` among them, are exercised on the first local run instead of on a production deploy.

`PUBLIRA_TICKER_DB_URL` resolves on its own for the same reason, and the worker opens it as a second pool: the periodic jobs run inside that process but must not inherit the `CREATE ON SCHEMA public` their host holds for `rivermigrate`. `publira_ticker` is also the one role the seed grants table by table — it is named in no blanket `GRANT ... ON ALL TABLES` and in no `ALTER DEFAULT PRIVILEGES`, so a table a later migration adds reaches it only when someone puts it in that list. The jobs read a known set of catalog, follow, announcement, and recipient tables and write a handful of them, which is little enough to enumerate, and `TestTickerRole*` in `internal/db` runs them on this connection so a query that starts reading a table the seed never granted fails there rather than in production.

River's tables, sequences, enum, and function belong to whichever role created them, and `rivermigrate` alters them in place on a later River release. A database that ran the worker on another connection before it had a role of its own therefore keeps an owner the worker cannot alter, which surfaces as `must be owner of table river_job` at startup the next time River ships a schema change. `db/seeds/baseline/010_river_object_owner.sql` hands those objects to `publira_outbox`; it runs with the rest of the seed and with `publiractl db roles`, so running either again against an existing database is the fix.

### Connection pools

Every pool a process opens is bounded by the same three variables, read at startup by `publira server`, `publira worker`, and `publiractl` alike. A value that is set and invalid stops the process with the variable's name instead of falling back to the default.

| Variable | Default | What it bounds |
| --- | --- | --- |
| `PUBLIRA_DB_MAX_OPEN_CONNS` | `10` | The connections one pool holds at once, in use and idle together. At least `3`. A caller past it waits for a connection to be returned |
| `PUBLIRA_DB_MAX_IDLE_CONNS` | the value of `PUBLIRA_DB_MAX_OPEN_CONNS` | The returned connections a pool keeps open for the next caller, from `0` to `PUBLIRA_DB_MAX_OPEN_CONNS` |
| `PUBLIRA_DB_CONN_MAX_IDLE_TIME` | `5m` | How long a connection nobody uses is kept before it is closed, as a Go duration. `0` keeps it |

The bound is per pool, not per process. `publira server` and `publira worker` hold three pools each and `publira server --with-worker` holds six, while a server given [`--role`](cmd/publira/README.md#serving-some-roles---role) holds one per role and a worker given [`--queue`](cmd/publira/README.md#hosting-some-queues---queue) holds the `publira_outbox` one River connects as and one more per login its queues' jobs connect as, so the database has to accept

```text
(the pools of every server and worker process, summed) × PUBLIRA_DB_MAX_OPEN_CONNS
```

connections from them, plus one pool for each `publiractl` command running at the same time, inside `max_connections` less the slots PostgreSQL reserves for superusers (`superuser_reserved_connections`, `3` by default). One server and one worker at the defaults use 60 of PostgreSQL's default 100.

A server serving the storefront and given `PUBLIRA_PUBLIC_DB_REPLICA_URL` holds one more pool, on the replica it names, signed in as `publira_public` and bounded by the same three variables. Its connections are made to the replica rather than the primary, so they count against the replica's `max_connections`, while the primary still sees the server's `publira_public` pool: a request the replica answers takes a connection there only for the moment it reads the primary's write position. `internal/readreplica` documents which requests the replica answers and when.

A request to `publira.v1` or `publira.admin.v1` holds one connection of its pool from start to end, bound to the tenant it names, and at most `PUBLIRA_DB_MAX_OPEN_CONNS − 1` of them do at once: the last connection is kept for the queries that run outside a tenant, which those same requests make as well. The image routes give their connection back once the image's row is read, before the object is fetched and converted.

### Local development

`task db:setup` applies `db/seeds/baseline/`, which creates the six login users in the table above without a password, and then `db/seeds/dev/000_role_passwords.sql`, which gives them the development passwords the local defaults above connect with.

### Production

`publiractl db roles` creates the users from the same files and sets the password each is given, after `publiractl db migrate` and on the same connection; [its README](cmd/publiractl/README.md#db) has the flags and the order of first use. `task db:seed ENV=prod` applies the same files through `psql` and leaves every new user without a password, to be set with `ALTER ROLE ... PASSWORD` or with `publiractl db roles`.

Then set each variable (`PUBLIRA_PLATFORM_DB_URL`, `PUBLIRA_CONTENT_STATS_DB_URL`, `PUBLIRA_WORKER_DB_URL`, `PUBLIRA_TICKER_DB_URL`, `PUBLIRA_ADMIN_DB_URL`, `PUBLIRA_PUBLIC_DB_URL`) to a URL containing the matching password. The servers and each of the worker's pools read only the variables named for the roles they connect as, and never fall back from one to another, so an unset one leaves that pool on a development password it cannot authenticate with; the `publiractl job` subcommands an operator runs by hand fall through the chain in the table above and end on `PUBLIRA_DB_URL`, so set `PUBLIRA_CONTENT_STATS_DB_URL` for them rather than relying on that end.

## Notes on initial data

- Using AuthService requires at least some data in `tenants` and `users`.
- Use a `bcrypt` hash for `users.password_hash`.
- Health checks (shared by the server, the worker, and the web apps):
  - `GET /livez` — process liveness. Always `200` with a plain `ok`. Intended for a K8s livenessProbe.
  - `GET /readyz` — readiness of the dependencies. `200` when healthy, `503` when not. Intended for a K8s readinessProbe or a load balancer.
  - Server / worker: at minimum a DB `Ping`
  - `publira server` holds a pool per namespace and names one check per pool — `db.public`, `db.admin`, `db.platform`, and `db.public.replica` when it is given a replica — so a failure says which login, or which server, stopped answering. The edge forwards the public API under `/rpc`, and `/images`, alone, so its `/readyz` is not an outsider's to read.
  - Web (`web-admin` / `web-storefront` / `web-platform`): the upstream API's `/readyz` plus Redis (the Redis check is skipped when `PNCH_REDIS_URL` is disabled)
  - Example `/readyz` responses (JSON):
    - Healthy: `{"status":"ok","checks":{"db":{"status":"ok"}}}`
    - Dependency failure: `{"status":"unavailable","checks":{"db":{"status":"error","error":"..."}}}` (HTTP 503)
    - Startup gate not yet open: `{"status":"starting","checks":{...}}` (HTTP 503)
