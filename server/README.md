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
- The catalog search tests start an OpenSearch and an Elasticsearch node with `StartOpenSearch` / `StartElasticsearch`, on images that carry the analysis plugins. Each runs the image named by its variable when that is set, and otherwise builds one from [`infra/docker/opensearch`](../infra/docker/opensearch/Dockerfile) or [`infra/docker/elasticsearch`](../infra/docker/elasticsearch/Dockerfile), which Docker's build cache keeps for the next run. CI builds both once and sets the variables.

  | Variable | Image |
  | --- | --- |
  | `PUBLIRA_TEST_OPENSEARCH_IMAGE` | An image built from `infra/docker/opensearch/Dockerfile` |
  | `PUBLIRA_TEST_ELASTICSEARCH_IMAGE` | An image built from `infra/docker/elasticsearch/Dockerfile` |

- Requirement: Docker must be usable locally (the affected tests skip when it is not running)
- For a faster run, `go test -short ./...` skips the integration tests that start containers

## Entrypoint details

- `publira server` (the API and image delivery) and `publira worker` (Outbox drain / scheduled publishing / free window boundaries / tenant day roll / pinned announcement expiry / scheduled maintenance): [cmd/publira/README.md](cmd/publira/README.md)
- publiractl (manual runs of the maintenance jobs: backfills, recovery, dry-run purges): [cmd/publiractl/README.md](cmd/publiractl/README.md)

## Graceful shutdown

On SIGINT / SIGTERM the long-lived processes (`publira server` / `publira worker`) drain in-flight requests and then run their shutdown hooks — stopping the River client, flushing the asynchronous audit log and the pending OpenTelemetry spans, and closing the DB pool — on one shared 30-second deadline. Whatever has not finished by then is cut off; a dropped audit log entry is counted in the metrics and named in the structured log.

Give the orchestrator a SIGKILL grace period longer than 30 seconds (on Kubernetes, a `terminationGracePeriodSeconds` of 45 or more). Draining readiness at the load balancer is configured separately.

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

### Raw MIME over HTTPS

`internal/inboundprovider/mime` reads one whole RFC 5322 mail posted as the request body with `Content-Type: message/rfc822`, for anything that can hand a received mail to an HTTPS endpoint and has no provider of its own: a Cloudflare Email Worker, a Postfix `pipe` transport running `curl`, a script. Nothing on that side signs what it posts, so its one field is a webhook token (`webhook_token`, secret and required) that the tenant chooses and the sender sends as the basic auth password, the same way SendGrid does: `https://inbound:<token>@<tenant-domain>/api/v1/webhook/email/mime`. A post with another token is refused as unsigned, and one whose body is not a mail with a `From` is refused as malformed.

The `X-Envelope-To` request header names the envelope recipients, comma-separated, and they are matched ahead of the mail's `To` and `Cc`. A mail an alias or a forward passed on often no longer names `contact+<message public id>@<inbound domain>` in its headers, while the side that received it still knows the address it was delivered to: a Cloudflare Email Worker's `message.to`, Postfix's `${recipient}`. The Worker and the Postfix transport that post this way are on the [Email page](../docs/en/4-console/3-setup/6-email.md#posting-raw-mail-from-cloudflare-email-routing) of the documentation.

The **Email** page under **Integrations** in `web-admin` is where a tenant administrator does this: it shows the webhook URL to register on the tenant's domain and, once a domain is saved, the reply address pattern `contact+*@<inbound domain>`.

### Receiving replies on a development machine

No provider has a CLI that forwards to `localhost` the way the Stripe and PAY.JP CLIs do: both deliver from the internet, so the edge needs a public HTTPS URL in front of it. Open a tunnel to `localhost:3080` that rewrites the `Host` header to the seed tenant's domain, which is what `web-storefront` resolves the tenant from:

```bash
cloudflared tunnel --url http://localhost:3080 --http-host-header localhost:3080
# or
ngrok http 3080 --host-header=localhost:3080
```

The console shows the webhook URL on the tenant's own domain, which no provider can reach on a development machine, so register the tunnel's host in its place: `https://inbound:<token>@<tunnel-host>/api/v1/webhook/email/sendgrid` for SendGrid, `https://<tunnel-host>/api/v1/webhook/email/resend` for Resend, and a Route forwarding to `https://<tunnel-host>/api/v1/webhook/email/mailgun/json` for Mailgun. The inbound domain still has to be a real one whose MX records you control, such as `reply-dev.<a domain you own>`, pointed at `mx.sendgrid.net` with priority 10 or at the MX records Resend or Mailgun shows for it.

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

The Dev Container starts the S3-compatible RustFS and connects to it path-style (endpoint `http://rustfs:9000`, bucket `publira`, with the local-only credentials `publira` / `publirapass`). For the full list of values and the console URL, see [../README.md](../README.md#object-storage-for-development-rustfs).

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
| Free (`price = 0`) | The episode's rotating media token (see [Media tokens](#media-tokens-audience-media)) and its synthetic `sub` | `public, max-age=3600` |

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

`PlatformSetupService/CreateInitialUser`, which creates the first operator with the `platform_super_admin` role while the platform has none, takes the credential as well, and is refused with `unauthenticated` to any caller without it. The edge forwards `/rpc` and `/api` on every host, so an install whose first operator has not been created yet, or that runs no Platform Console at all, would otherwise hand the platform to whoever reaches a tenant's site first. The Platform Console's setup screen sends the credential from its server. `CheckSetupStatus` stays open, since the setup screen asks it before anyone has signed in.

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
| `opensearch` | OpenSearch, ranked by relevance, matching a Latin word with one wrong character and, with the default analysis, a title written in kanji from a query typed in kana. A series search can be narrowed and sorted by every filter and order `ListPublishedSeries` takes, and is ranked by relevance when it names no order |
| `elasticsearch` | Elasticsearch, searched and written exactly as `opensearch` is: the index definition, the queries, the bulk writes, and the alias swaps are common to both, and the backend's integration tests run against an Elasticsearch 9 node as well as an OpenSearch one. The engine is reached with HTTP basic auth or none, so an API key and a private CA are not supported: a node with security on needs a certificate the server already trusts |

An engine other than `sql` is saved with its `http://` or `https://` URL, the alias the catalog indices are named after (`publira-catalog` unless given; give each environment sharing a cluster an alias of its own), and optionally an HTTP basic auth username and password, which need an `https://` URL. The password is sealed with `PUBLIRA_SECRET_ENCRYPTION_KEYS` and never returned. With the default analysis every node needs the `analysis-kuromoji` and `analysis-icu` plugins, which neither the `opensearchproject/opensearch` nor the `elasticsearch` image ships: install them with `bin/opensearch-plugin install analysis-kuromoji analysis-icu` or `bin/elasticsearch-plugin install analysis-kuromoji analysis-icu` while the node is stopped. [`infra/docker/opensearch`](../infra/docker/opensearch/Dockerfile) builds an OpenSearch image that has them, and the root `compose.yaml` runs it in its `search` profile. `TestPlatformSearchConnection` and `publiractl search test` report the product and version the engine answers with and whether each plugin is installed, and fail on a missing one while the saved analysis is the default.

The engine keeps one catalog index for each locale a reader can search in (`locale.Supported`), behind the saved alias with the locale appended in lowercase — `publira-catalog-ja`, `publira-catalog-zh-hans` — and each holds every tenant's series, creators, and labels. A series document in a locale's index carries the title and the synopsis `series_translation_for` picks for that locale, so a series with no translation in it is found by the one shown in its place, and a title order sorts by that title; a creator's or a label's document is the same in every index. `SearchPublishedSeries` searches the index of the request's `locale`, and `SearchPublishedCreators` and `SearchPublishedLabels`, which take none, the index of the tenant's default locale. On `sql` the scans match the same translation. Every index is built from the one saved analysis.

A save does not move the search onto an index nobody has built. The row keeps the saved configuration and the one the search answers from side by side:

- `sql`, or the engine, URL, alias, and analysis the search already answers from with other credentials, is answered from at once.
- Any other target, or another analysis on the same one, is built by the worker's `maintenance.build_search_index` job, and so is the target the search answers from when its indices were built for other locales than the server searches in, which the row records as `serving_locales`: a release that adds a locale, and an install still on the single index from before the catalog was indexed per locale, get their indices this way with nothing saved. The job looks for a build every 30 seconds and fills the indices from the database, and the search moves onto them once they hold the catalog. Until then `publira server` keeps answering from the previous indices, and the worker writes every `catalog_index_sync` event into both targets, or into the serving aliases alone when the build fills new indices behind the same aliases and writes every tenant again once they have moved. A build for other locales counts as a target of its own here, since it fills indices behind aliases the search does not read yet. The single index of an install that predates per-locale indices is left behind the saved alias itself once the search has moved off it, and nothing reads or writes it after that.
- A build that fails is recorded on the row and reported by `GetPlatformSearchSettings` and `publiractl search show`; the search stays where it was, and the job tries again on its next pass.

`publira server` and `publira worker` reread the row within 30 seconds, so a save reaches them without a restart. Every write to a series, a creator, or a label, and every write to an episode or a free window that changes what its series is narrowed or sorted by, queues a `catalog_index_sync` outbox event in its own transaction; so do the ticker jobs when a free window opens or closes and when a scheduled episode is published. A save that changes a tenant's locales queues one naming the whole tenant, since the translation a series falls back to in a locale it has none in moves with the default locale. The worker rewrites the named row's document from the database, or replaces it with a tombstone no search finds when the row is published nowhere, and once a search can find that write it records a `next_cache_revalidation` for the cache tag web-storefront holds the searches of that kind under; on `sql` with no build due it marks those events done as it claims them. `publiractl search reindex` rebuilds the index on the saved engine, for a mapping a release changed or an index that was lost; see [publiractl](cmd/publiractl/README.md#search).

### Text analysis

The mapping of the catalog index is the server's: the searches name its fields, and the documents are written to it. Its `settings.analysis` is the platform's, one definition for every tenant and every locale's index, since they share the indices, saved as a JSON object through `UpdatePlatformSearchSettings` (`analysis_update_mode` and `analysis`) or `publiractl search set --analysis-file`, and put back to the default with `--default-analysis`. `GetPlatformSearchSettings` answers the definition in use, the default included. The default, [`analysis.json`](internal/catalogsearch/opensearchbackend/analysis.json), is built for Japanese on `analysis-kuromoji` and `analysis-icu`; a platform whose titles are in another language replaces it with one built on that language's plugin, such as `analysis-nori` for Korean or `analysis-smartcn` for Chinese, both shipped by OpenSearch and Elasticsearch.

A definition has to define the three names the mapping refers to, one per role:

| Name | Kind | Role |
| --- | --- | --- |
| `written_form` | analyzer | The title, the name, and the synopsis as they are written |
| `alternate_form` | analyzer | The alternate form a query may be typed in, which a title is also indexed in, and which an entered reading is analyzed in: the kana reading for Japanese. A language with no alternate form makes it the written form again |
| `exact_match` | normalizer | The exact match of a title or a name, which ranks above any partial match, and the order of the hits of one score |

A save refuses a definition over 64 KiB, one that is not a JSON object, one missing a role, and one the engine will not create an index from: whenever a save changes the analysis, or takes a saved one to another target, the server creates an empty index beside the alias with it and drops it again, and the engine's reason is the refusal. An engine that cannot be asked refuses the save as `unavailable`. Nothing is written either way.

A saved definition is built like a new target: the worker fills a new index behind the alias from the database and moves the alias onto it, and the storefront answers from the index it has until then. Whatever the definition, a query with a Han, Hiragana, Katakana, or Hangul character in it is never matched fuzzily, since one edit there makes another word rather than a typo, and is matched in the alternate form as well.

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
| `service.name` | `publira server` resolves it per Connect namespace, because it serves all three from one process: `publira-api-server` for `publira.v1`, `publira-admin-api-server` for `publira.admin.v1`, and `publira-platform-api-server` for `publira.platform.v1`, with the first of them also carrying what is not an RPC — the database spans and the outbound calls — and `publira-image-server` for the image routes. `publira worker` defaults to `publira-worker` and adds one per periodic job on top — `publira-publish-episodes` / `publira-apply-free-windows` / `publira-roll-tenant-day` / `publira-expire-pinned-announcements` / `publira-apply-series-publications` / `publira-apply-campaign-banners` — and one per maintenance job, the same name `publiractl job` reports for that job, carried by the span each run hangs off, so they stay apart in a trace UI now that they share a process. `publira server --with-worker` resolves the union of both, with `publira-api-server` as the default and the Outbox drain's spans still under `publira-worker`. `publiractl job` resolves it per job, so it becomes `publira-project-episode-reads` / `publira-aggregate-content-stats` / `publira-aggregate-rankings` / `publira-purge-content-events` / `publira-purge-ranking-snapshots` / `publira-purge-mfa-challenges` / `publira-purge-withdrawn-comments` / `publira-purge-orphan-images` / `publira-build-recommend-features` / `publira-close-royalty-statements` / `publira-sync-google-play-voided-purchases`. Overridable with `OTEL_SERVICE_NAME` |
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

The Dev Container bundles Jaeger (its UI is at `http://localhost:16686`). For the details, see [../README.md](../README.md#distributed-tracing-jaeger).

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

A sealed value names the key that sealed it (`enc:v1:<key-id>:…`), so any key in the set opens it, and a value saved again with the same plaintext is sealed again under the primary key (`secretupdate.KeepIfSame`). `publiractl db reseal` seals every stored value again under the primary key without anyone saving it, which is what lets a rotation remove the old key. Rotating a key is an operator procedure: [Rotating the secret encryption keys](../docs/en/3-operations/12-security.md#rotating-the-secret-encryption-keys).

Notes:

- Never log a key or a plaintext
- On an encryption or decryption failure, do not continue — treat it as a failure

## Authentication (JWT access tokens)

The API issues **HS256 JWT access tokens** from an email address and a password (`Login` / `Logout`), from an Apple or Google ID token (`LoginWithIdToken`), or, on the storefront, from a passkey alone (`BeginPasskeyLogin` / `FinishPasskeyLogin`).  
Browser cookies are managed on the Next.js side as JWE with `jose`, and only `Authorization: Bearer <token>` is sent to the API.

| Item | Value |
| --- | --- |
| Environment variable | `PUBLIRA_AUTH_JWT_SECRET` (**required**, at least 32 bytes. There is no fallback: if it is unset or too short, `publira server` fails to start) |
| TTL | 24h |
| Audience | `public` / `admin` / `platform` / `media` / `admin-media` / `admin-mfa-verify` / `admin-mfa-enroll` / `platform-mfa-verify` / `platform-mfa-enroll` |
| Revocation | `users.credentials_version` / `platform_users.credentials_version` (incremented on a password change and the like) |
| Next cookie | `PUBLIRA_AUTH_SECRET` (**required**, at least 32 bytes. It is for JWE and is separate from the API's JWT secret. There is no fallback: if it is unset or too short, an exception is raised) / cookie names such as `publira_web_storefront_auth` |

### Sign in with Apple and Google

Each tenant enables the providers its readers may sign in with through the Admin API's `TenantSettingsService.UpdateTenantSignInSettings`: for Google, the OAuth client IDs of its web application and its iOS app; for Apple, the Services ID the storefront signs in with, and the team, key ID, and `.p8` key of a Sign in with Apple key. The iOS app signs in with the bundle identifier of the tenant's iOS app association. The key is sealed with `PUBLIRA_SECRET_ENCRYPTION_KEYS` before it is stored, and no RPC returns it. `TenantService.GetTenant` answers the providers that are ready and their public client IDs.

`AuthService.LoginWithIdToken` verifies the token against the provider's published keys (`https://appleid.apple.com/auth/keys`, `https://www.googleapis.com/oauth2/v3/certs`), refuses a nonce it has accepted before, and finds the reader by the linked provider account, by the address the provider vouches for, or creates one. `LinkIdentity` links a provider account to the signed-in reader from a fresh ID token checked the same way, whatever address it carries, so a reader whose provider hides or differs from the account's address can still sign in to that account with it. `ListMyIdentities` and `UnlinkIdentity` manage the links; an account without a password or a passkey keeps its last one, and an account without a password confirms `DeleteMe` and `RequestEmailChange` with a fresh ID token or a passkey assertion instead.

An Apple sign-in or link may carry its authorization code. `publira worker` exchanges it at `https://appleid.apple.com/auth/token` for a refresh token the link keeps, sealed, and revokes that token at `https://appleid.apple.com/auth/revoke` when the link or the account is deleted (`apple_sign_in_code_exchange` / `apple_sign_in_token_revoke` outbox events).

### Passkeys on the storefront

A signed-in reader registers passkeys (WebAuthn) with `BeginPasskeyRegistration` / `FinishPasskeyRegistration` and manages them with `ListMyPasskeys` / `RenamePasskey` / `DeletePasskey`; `ListMyIdentities` reports `has_passkey`. The library, the ceremony storage, and the stored credential are the console's, described under **Passkeys** below.

| Item | Value |
| --- | --- |
| Relying party | The storefront's own host as the RP ID and its origin as the only one accepted, derived from the tenant row. Credentials and ceremonies carry `relying_party` (`site` or `admin_console`), so a console passkey never signs a reader in, and a storefront passkey is never a console factor, even where the two hosts share a hostname |
| Registration | A resident key and user verification required, since the passkey has to name the account by itself; the reader's existing passkeys excluded. At most 20 per account |
| Sign-in | `BeginPasskeyLogin` answers request options that name no account. `FinishPasskeyLogin` spends the ceremony, looks the credential up by its ID within the tenant and the storefront's RP ID, checks the assertion against the user handle, and issues a session as `Login` does. A refused assertion is `unauthenticated`, as a wrong password is |
| Sign-in ceremony | Kept in `user_webauthn_ceremonies` with no account until its finish. Each begin spends one of the origin's sign-in allowance (`login_attempts_per_source`), and a sign-in that succeeds gives it back; a begin also drops the tenant's sign-in ceremonies that expired unfinished |
| Address | A passkey sign-in is refused for a suspended account and for one without `email_verified_at`, as `Login` refuses them. A passkey is registered from a session, and a session always began with a confirmed address, so registering one confirms nothing: it proves the reader holds the authenticator, not that the address is theirs |
| Last way in | `DeletePasskey` is `failed_precondition` for the last passkey of an account with neither a password nor a linked provider, and `UnlinkIdentity` lets such an account unlink its last provider while it holds a passkey. Only a passkey for the storefront's current host counts |
| Confirmation | `BeginPasskeyConfirmation` begins an assertion over the reader's own passkeys; its result goes in `passkey_credential_json` of `DeleteMe` or `RequestEmailChange` in place of a password or an ID token, and confirms that one request |

### Media tokens (audience `media`)

A browser cannot attach an `Authorization` header to an `<img>` request. So for a reader who may view a paid episode, `GetEpisodeDetail` returns the body image URLs with a `t=<JWT>` query appended.

| Item | Value |
| --- | --- |
| Audience | `media` (separate from `public`; it does not pass to the API, and pasting an access token into the URL does not open the image) |
| TTL | 15 minutes |
| Scope | Only the single episode it was issued for (claim `eid`) |
| Revocation | The same `users.credentials_version` as the access token |

The token only states who the reader is; whether the image may be viewed is decided by the image routes, which consult purchases and access_tickets on every request, under the same rules as the API.

Bodies that are free to everyone — `price = 0`, or a priced episode inside an open `episode_free_windows` period — get a token of the same audience with a different shape, because their reader may hold no credential at all and still needs key material for the encrypted body:

| Item | Value |
| --- | --- |
| Subject | The synthetic `anonymous-free-episode`. A `users.public_id` is exactly 12 Base58 characters, so it resolves to no user and the token names no grant |
| TTL | Two 24-hour rotation windows. `iat` is the start of the current window, so a token in hand always has at least one full window left |
| Scope | Only the single episode it was issued for (claim `eid`) |
| Revocation | None to revoke: it carries no reader, and rotation is what ends a copied URL |

Every reader who opens one free episode within one window is handed the identical URL, which is what keeps a free page shareable. Access is still decided entirely by the public rule — published, and `price = 0` — so an unpublished episode and a paid episode without a grant are `403` whether the token is present or not.

### Admin media tokens (audience `admin-media`)

Episode image previews in the admin UI also go through the browser's `<img>` / `next/image`, so they carry no `Authorization` either. `ListEpisodeImages` / `UploadEpisodeImages` / `ReorderEpisodeImages` / `DeleteEpisodeImage` / `ReplaceEpisodeImage` return the body image URLs with a `t=<JWT>` query appended.

| Item | Value |
| --- | --- |
| Audience | `admin-media` (separate from both `media` and `admin`; it unlocks nothing on a tenant site and does not pass to the admin API) |
| TTL | 15 minutes |
| Scope | Only the single episode it was issued for (claim `eid`) |
| Revocation | The same `users.credentials_version` as the access token |

The token only states who the administrator is; on a console host the image routes consult the tenant membership and the admin role (`tenant_admin` / `tenant_editor` / `tenant_auditor`) on every request. It does not look at the publication state or the price.

## Admin MFA (TOTP and passkeys)

A tenant member signing in to the admin console can hold a second factor: a TOTP authenticator (RFC 6238), any number of passkeys or security keys (WebAuthn), or both, plus ten one-time recovery codes that stand in for whichever it holds. `AdminAuthService` carries the whole flow — `StartMfaEnrollment` / `ConfirmMfaEnrollment` / `VerifyMfa` / `DisableMfa` / `RegenerateMfaRecoveryCodes` / `GetMfaStatus` for the authenticator, and `BeginPasskeyRegistration` / `FinishPasskeyRegistration` / `BeginPasskeyVerification` / `FinishPasskeyVerification` / `ListPasskeys` / `RenamePasskey` / `DeletePasskey` for passkeys. `DisableMfa` takes the authenticator off and leaves passkeys alone.

| Item | Value |
| --- | --- |
| Algorithm | TOTP, 30-second period, SHA-1, 6 digits, a 160-bit secret — what every mainstream authenticator app assumes when the otpauth URI omits it |
| Acceptance window | The current step and one on either side |
| Replay | A step is accepted once. `user_mfa_totp.last_verified_step` is what refuses a code that is still inside the window but was already spent, and `user_mfa_used_challenges` refuses a challenge token that already bought a session |
| Secret at rest | Encrypted with `secretcrypto` (`PUBLIRA_SECRET_ENCRYPTION_KEYS`). `StartMfaEnrollment` is the only response the plaintext appears in |
| Recovery codes | Ten per batch, shown once at enrollment, regeneration, or the registration of a passkey on an account with no unused code, stored as bcrypt hashes. Spending one leaves the row with `used_at` set. They go when the account's last factor does |
| Failure limit | Five refused codes or passkey assertions lock the account for 15 minutes. The counter is per account in `user_mfa_lockouts`, shared by both factors, and covers login, disabling, and regeneration alike |
| Audit | `admin_mfa_enrolled`, `admin_mfa_verified` (success and failure, with the factor as the reason: `totp`, `recovery_code`, or `passkey`), `admin_mfa_recovery_code_used`, `admin_mfa_disabled`, `admin_mfa_recovery_codes_regenerated`, `admin_mfa_passkey_registered`, `admin_mfa_passkey_renamed`, `admin_mfa_passkey_removed` in `audit_logs` |

### The challenge that stands in for half a session

`Login` does not issue an access token to an account that still owes a factor. It answers with a short-lived challenge token instead, under an audience of its own — `admin-mfa-verify` when the account has a confirmed authenticator or a passkey, `admin-mfa-enroll` when it has neither and the platform policy requires one. A verify challenge names the factors the account holds in `methods`. The challenge lives five minutes and carries `users.credentials_version`, so a password change ends a pending one.

`VerifyMfa` exchanges a verify challenge and a code for the access token, and `FinishPasskeyVerification` a verify challenge and an assertion. `ConfirmMfaEnrollment` and `FinishPasskeyRegistration` do the same for an enroll challenge: each returns the recovery codes and the session in one response, which is what finishes a login that was stopped at enrollment.

A challenge buys one session, claimed by its `jti` in `user_mfa_used_challenges`; `publiractl job purge-mfa-challenges` deletes those rows once their token has expired, and the passkey ceremonies nobody finished along with them. An enroll challenge is presented twice by design, to `StartMfaEnrollment` and then to `ConfirmMfaEnrollment`, and is claimed by the confirmation in the transaction that enables the factor: a second confirmation with the same token is refused as an invalid session, even after the factor has been turned off. Two confirmations racing on one enrollment enable it once, and the one that loses is refused with `mfa is already enabled` and writes no recovery codes. An enroll challenge is refused as an invalid session once the account holds a confirmed authenticator or a passkey, whichever login enrolled it, so a second login's challenge cannot enroll a factor of its own past the owner's.

### Requiring the factor

`mfa_required_for_tenant_admin` in the platform policy (`PlatformPolicyService` or `publiractl policy set`, off when nothing is saved) turns enrollment from something a tenant admin may do into something it must do before it gets a session. Only `tenant_admin` is covered: an editor or an auditor may enroll and is never held back for not having.

Taking the authenticator off needs the authenticator or a recovery code. Removing a passkey needs the session alone, and is refused with `failed_precondition` when it is the account's last factor and the policy requires one of its role. Minting a new batch of recovery codes needs the authenticator.

### Passkeys

| Item | Value |
| --- | --- |
| Library | `github.com/go-webauthn/webauthn`, through `internal/tenantwebauthn`, which also carries the software authenticator the tests sign with (`webauthntest`) |
| Relying party | Derived from the tenant row through `tenantorigin`, never from the request. The RP ID is the console's own host, never the storefront's, even when the console is served under the storefront's domain, so a passkey registered on the storefront never answers the console; the only origin accepted is the console's. The RP name is the tenant's name |
| Registration | User verification required, a discoverable credential preferred, no attestation requested, the account's existing credentials excluded |
| Ceremony state | The challenge, the account, the RP ID, and the expiry, five minutes after the begin, in `user_webauthn_ceremonies`. Nothing of it is handed to the client: the finish finds the row by the challenge the response was signed over and deletes it, which spends it whatever the verification then answers. An account may have up to five ceremonies of each kind open at once, so several tabs or devices can sign in side by side; a begin past that drops the oldest |
| Stored per credential | `user_webauthn_credentials`: the relying party (`admin_console` here), the RP ID, the credential ID (unique per tenant), the COSE public key, the signature counter, the AAGUID, the transports, the backup-eligible and backed-up flags, its owner's name for it, `created_at`, `last_used_at` |
| Counter | An assertion whose counter does not move past the stored one is refused, unless both are zero, which is what an authenticator that keeps no counter reports |
| Errors | A refused assertion is `unauthenticated` with the reason `MFA_PASSKEY_REFUSED`; a refused registration is `invalid_argument` with the same reason. An assertion counts toward the failure limit only when it was checked against a ceremony the account had open |

A passkey registered for an RP ID the console no longer derives — after its console host moves, whether to a new `admin_domain` or with the tenant's domain under the default `admin.` host — is not counted as a factor and is not listed, and the account's recovery codes stay while one is stored, since moving the console back makes it a factor again.

## Platform operator MFA (TOTP)

An operator of the Platform Console holds the same second factor, through the same RPCs on `PlatformAuthService`, with the same algorithm, acceptance window, replay checks, recovery codes, and failure limit as the table above. What differs is where it is kept and what requires it:

| Item | Value |
| --- | --- |
| Tables | `platform_user_mfa_totp`, `platform_user_mfa_recovery_codes`, `platform_user_mfa_used_challenges`, keyed to `platform_users` and reachable by `publira_platform` alone, apart from the purge below |
| Challenge audiences | `platform-mfa-verify` / `platform-mfa-enroll`. A platform challenge names no tenant, and neither console accepts the other's |
| Authenticator entry | Issuer `Publira Platform Console`, account the operator's email address |
| Requirement | `mfa_required_for_platform_operator` in the platform policy (`PlatformPolicyService` or `publiractl policy set --mfa-required-for-platform-operator`, off when nothing is saved). It covers every operator role, `platform_auditor` included. `UpdatePlatformPolicy` keeps the saved value when a request leaves it unset, and refuses to switch it on with `failed_precondition` on a server without a secret manager, where no operator could enroll |
| Audit | `operator_mfa_enrolled`, `operator_mfa_verified` (success and failure), `operator_mfa_recovery_code_used`, `operator_mfa_disabled`, `operator_mfa_recovery_codes_regenerated` in `platform_audit_logs`, filed under the operator with the operator as the target |

`publiractl job purge-mfa-challenges` drains `platform_user_mfa_used_challenges` along with `user_mfa_used_challenges`, which is why `publira_content_stats` may read and delete that one table.

## View events (soft PV) and anonymous actors

`ContentViewService.RecordContentView` records a view event in `content_events` for the series or episode detail page a reader opened. This is the Phase 1 soft PV, and it means nothing more than "the reader opened the page" (hard PV, which observes whether the body was actually read, comes later). The target is resolved before anything is written, so an unpublished, cross-tenant, or missing public ID is `not_found`; once it resolves, the recording is decoupled from the main processing and the RPC succeeds even when the write fails.

The detail RPCs deliberately record nothing: their callers cache them, so recording lives in its own RPC and the reader's request is the only thing that files a view.

| Item | Value |
| --- | --- |
| Event type | `episode_view` (episode target) / `series_view` (series target) |
| actor | `user_id` while signed in, otherwise the `anonymous_id` from the `publira_aid` cookie (`content_events.actor_key` unifies them with `COALESCE`) |
| Debounce | Fixed 30-minute epoch buckets (`floor(unix / 1800)`) plus `ON CONFLICT DO NOTHING` against a partial UNIQUE index. It is not a sliding window |
| `series_id` | Resolved from `episodes` rather than taken from client input |
| Authentication | Optional. A rejected or unverifiable bearer does not fail the call; the view falls back to the `publira_aid` cookie, and is recorded only if the request carried one. No identifier is minted for a caller that presented a session |
| Prefetch | Nothing is recorded when `Sec-Purpose` / `Purpose` / `X-Purpose` / `X-Moz` / `Next-Router-Prefetch` indicate a speculative request |
| Payload | `{"pv_kind":"soft"}` only. No personal data such as an IP address, a User-Agent, or an email address is stored |

### The `publira_aid` cookie

A cookie whose only purpose is counting signed-out readers. Its value is a UUIDv7 assigned by the server and contains nothing else. When the cookie is absent, or its value does not parse as a UUID, a new one is assigned and returned in the response's `Set-Cookie`.

| Attribute | Value                                  |
| --------- | -------------------------------------- |
| Name      | `publira_aid`                          |
| Path      | `/`                                    |
| Max-Age   | 180 days                               |
| Others    | `HttpOnly` / `Secure` / `SameSite=Lax` |

## Rating events

`RatingService.RateEpisode` records a signed-in reader's reaction to one episode, on a 1–5 scale with no neutral point. The reader's own score lives in `episode_ratings`, and every press that raises it files a `rating` event as well. Unlike a view event, it is an explicit action by the reader, so a failure is returned as an error rather than swallowed.

| Item | Value |
| --- | --- |
| Event type | `rating` |
| actor | `user_id` (sign-in required; anonymous reactions are not accepted) |
| Target | `series_id` + `episode_id`, both resolved from `episodes` rather than taken from client input |
| Score | `rating_score` carries the points the press added, not the score the reader now stands at |
| Append-only | Pressing again appends another event; `episode_ratings` holds the score itself |

There is no RPC for withdrawing or lowering a reaction, and none for rating a series directly. How expressive one press is follows `tenant_config.episode_rating_mode`, which a series may override in `series_listings.episode_rating_mode`: `single` stores the whole 5 on the first press, `multiple` lets the reader press their way up to it.

| RPC | Answers |
| --- | --- |
| `RatingService.GetMyEpisodeRating` | This reader's score for one episode, the readers who have reacted to it, and the press mode governing it |
| `RatingService.GetMySeriesRating` | The mean of this reader's own scores across the episodes of one series they reacted to |

### The derived series rating

A series is rated by the episodes it is made of. `CatalogService.GetSeriesDetail` carries `rating_average` and `rating_count` on the series, both derived on read and both absent — `0` — until the reactions reach the daily aggregates.

| Item | Value |
| --- | --- |
| Source | The `series` rows of `content_daily_stats`, which already roll up every episode of the series |
| Rate | `rating_sum / complete_count`, so a long or widely read series does not outrank a beloved one on volume |
| Prior | Twenty imagined completed reads at the tenant's own mean, which a series with few finished reads is pulled towards. The mean comes from `tenant_rating_totals`, which `aggregate-content-stats` restates on the run that changes it |
| Scale | Held to 1–5, the scale the reaction itself is given on |
| `rating_count` | `series_rating_counts`, a trigger-maintained tally of the readers who reacted, counting each reader once per series |

## Completion events and read-through

`EpisodeReadService.MarkEpisodeAsRead` stores the business state — one `episode_reads` row per member and episode, keeping the first read time. Each stored read is also projected into `content_events` as an `episode_complete` event, which is what the aggregates and the ranking read; the two are kept apart so retention, re-aggregation, and metric definitions do not have to share one table.

| Item | Value |
| --- | --- |
| Event type | `episode_complete` |
| actor | `user_id` (sign-in required, so a completion has no anonymous form) |
| Source | `source_table = 'episode_reads'`, `source_id = episode_reads.id`. The partial UNIQUE index on `(tenant_id, source_table, source_id)` is what makes the projection replayable |
| `occurred_at` | The read's own `read_at`, so a late projection still files the event on the day the member finished |
| `series_id` | Resolved from `episodes` rather than taken from client input |
| Failure | Swallowed. The read is already stored, and `publiractl job project-episode-reads` files whatever the request path lost |

### The member's own reading history

`EpisodeReadService.ListMyEpisodeReads` reads those same rows back for the member who wrote them, most recently finished first, with the episode and series each one names. It is the reader's counterpart of the operator's read-through report: cursor-paginated like every list RPC (`proto/README.md`), session-scoped, and `Cache-Control: private, no-store`.

| Item | Value |
| --- | --- |
| Order | `read_at` descending, `episode_reads.id` as the tiebreaker, over `idx_episode_reads_tenant_user_read_at` |
| Publication | Re-checked. An episode whose series or listing is no longer published drops out, so the history never names something the storefront has taken down |
| Access | Not re-checked. The member did finish the episode, so an expired rental stays in the history the way an expired purchase stays in `ListMyPurchases` |

### Read-through rate

`content_daily_stats` carries the two halves of the rate per episode, rolled up to the series by summing its episodes:

| Column | Meaning |
| --- | --- |
| `complete_count` | `episode_complete` events on that day |
| `member_view_count` | `episode_view` events on that day whose `user_id` is set |

The rate is `complete_count / member_view_count` over a range of days. A period with no member views has no rate at all rather than a rate of zero; the console shows an em dash there. `AdminEngagementService.ListEpisodeReadThrough` reports the last 28 complete days in the tenant's own time zone, the same calendar day the audit log's date filter means, and names that zone in the response.

## Comment events

`CommentService.PostEpisodeComment` under the `immediate` comment mode and `AdminCommentService.ApproveComment` under `approval_required` are the two ways a comment becomes public, and each files a `comment` event in the transaction that publishes it. A comment that never became public files none: one waiting for approval has no event, and neither has one removed or withdrawn while it was still waiting.

| Item | Value |
| --- | --- |
| Event type | `comment` |
| actor | `user_id` (sign-in required, so a comment has no anonymous form) |
| Source | `source_table = 'episode_comments'`, `source_id = episode_comments.id`. The partial UNIQUE index on `(tenant_id, source_table, source_id)` is what keeps a comment approved after a restore from filing a second event |
| `occurred_at` | The comment's own `published_at`, so the event falls on the day the comment became readable rather than the day it was written |
| `series_id` | Resolved from `episodes` rather than taken from client input |
| Failure | Returned. The event shares the transaction that published the comment, because no batch replays this projection the way `project-episode-reads` replays completions |

### Comment counts

`content_daily_stats.comment_count` is built from `episode_comments` rather than from those events: it counts the comments whose `published_at` falls on that day and that are still `published` when the aggregate runs. A comment hidden or withdrawn afterwards keeps the event it earned, leaves the count from the next rebuild of its day, and does not disturb a row `aggregate-content-stats` already wrote for a past day. The ranking snapshots and the recommendation features read that column alongside the other engagement totals.

## Reading positions

`EpisodeReadService.SaveReadingPosition` and `GetMyReadingPosition` carry where a member stopped inside an episode, as one `episode_reading_positions` row per member and episode. `GetMySeriesProgress` answers the same member's standing in one series — the episode they moved in most recently, the position they left in it, whether `episode_reads` already records it as finished, and every episode of the series they have finished — so `CatalogService.GetSeriesDetail` keeps returning the same bytes to everyone. That last list is read from `episode_reads` rather than derived from the progress row, because finishing an episode and saving a position in it are separate writes.

| Item | Value |
| --- | --- |
| Session | Required. Every one of these RPCs answers for the signed-in member alone and responds `Cache-Control: private, no-store` |
| Isolation | The member policy `episode_reads` uses: `app.current_tenant_id` and `app.current_user_id` both have to match the row |
| `page_index` | Zero-based and below `page_count`. A page outside the episode is `invalid_argument`, an episode with no pages `failed_precondition` |
| `page_count` | Counted from `episode_images` on every save, never taken from the request |
| Access | Publication and paid-body access are checked on save and on read alike, so an unpublished episode or an expired rental has no position to resume |

## API namespace separation

`publira server` (`server/cmd/publira`) serves all three Connect namespaces under `/rpc` on one listener, and under `/api` as well until 0.3.0 removes it, `:8000` (changeable with `PUBLIRA_PUBLIC_API_ADDR`), beside `GET /images/…`, `/livez`, and `/readyz`:

- `publira.v1` — `CatalogService`, `AuthService`, and the rest of the public API
- `publira.admin.v1` — `AdminSeriesService`, `AdminAuthService`, `AdminEngagementService`, and the rest of the tenant console's API
- `publira.platform.v1` — the Platform Console's API

The reverse proxy forwards `/rpc`, `/api`, and `/images` to it, prefixes kept, on every host, and web-storefront, web-admin, and web-platform dial the same listener directly over the private network. The proto packages produce non-colliding procedure paths, so one mux carries all three. The namespaces are kept apart by the login each is answered on and by their authentication, not by where they are reachable: a Connect handler answers gRPC, gRPC-Web, and the Connect protocol on one route, so both consoles' RPCs are reachable through the edge on every tenant site, and each refuses a caller without an operator session or the [web service credential](#web-service-credential) before any handler runs. Next.js revalidation on a publication state change needs `PUBLIRA_REVALIDATE_TOKEN`, and its destinations are the `web-*` apps whose internal URL (`PUBLIRA_WEB_*_INTERNAL_URL`) is set.

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
| `PUBLIRA_DB_MAX_OPEN_CONNS` | `10` | The connections one pool holds at once, in use and idle together. At least `2`. A caller past it waits for a connection to be returned |
| `PUBLIRA_DB_MAX_IDLE_CONNS` | the value of `PUBLIRA_DB_MAX_OPEN_CONNS` | The returned connections a pool keeps open for the next caller, from `0` to `PUBLIRA_DB_MAX_OPEN_CONNS` |
| `PUBLIRA_DB_CONN_MAX_IDLE_TIME` | `5m` | How long a connection nobody uses is kept before it is closed, as a Go duration. `0` keeps it |

The bound is per pool, not per process. `publira server` and `publira worker` hold three pools each and `publira server --with-worker` holds six, while a server given [`--role`](cmd/publira/README.md#serving-some-roles---role) holds one per role, so the database has to accept

```text
(the pools of every server and worker process, summed) × PUBLIRA_DB_MAX_OPEN_CONNS
```

connections from them, plus one pool for each `publiractl` command running at the same time, inside `max_connections` less the slots PostgreSQL reserves for superusers (`superuser_reserved_connections`, `3` by default). One server and one worker at the defaults use 60 of PostgreSQL's default 100.

A request to `publira.v1` or `publira.admin.v1` holds one connection of its pool from start to end, bound to the tenant it names, and at most `PUBLIRA_DB_MAX_OPEN_CONNS − 1` of them do at once: the last connection is kept for the queries that run outside a tenant, which those same requests make as well. The image routes give their connection back once the image's row is read, before the object is fetched and converted.

### Local development

`task db:setup` applies `db/seeds/baseline/`, which creates the six login users in the table above without a password, and then `db/seeds/dev/000_role_passwords.sql`, which gives them the development passwords the local defaults above connect with.

### Production

`publiractl db roles` creates the users from the same files and sets the password each is given, after `publiractl db migrate` and on the same connection; [its README](cmd/publiractl/README.md#db) has the flags and the order of first use. `task db:seed ENV=prod` applies the same files through `psql` and leaves every new user without a password, to be set with `ALTER ROLE ... PASSWORD` or with `publiractl db roles`.

Then set each variable (`PUBLIRA_PLATFORM_DB_URL`, `PUBLIRA_CONTENT_STATS_DB_URL`, `PUBLIRA_WORKER_DB_URL`, `PUBLIRA_TICKER_DB_URL`, `PUBLIRA_ADMIN_DB_URL`, `PUBLIRA_PUBLIC_DB_URL`) to a URL containing the matching password. The servers and each of the worker's three pools read only the variables named for the roles they connect as, and never fall back from one to another, so an unset one leaves that pool on a development password it cannot authenticate with; the `publiractl job` subcommands an operator runs by hand fall through the chain in the table above and end on `PUBLIRA_DB_URL`, so set `PUBLIRA_CONTENT_STATS_DB_URL` for them rather than relying on that end.

## Notes on initial data

- Using AuthService requires at least some data in `tenants` and `users`.
- Use a `bcrypt` hash for `users.password_hash`.
- Health checks (shared by the server, the worker, and the web apps):
  - `GET /livez` — process liveness. Always `200` with a plain `ok`. Intended for a K8s livenessProbe.
  - `GET /readyz` — readiness of the dependencies. `200` when healthy, `503` when not. Intended for a K8s readinessProbe or a load balancer.
  - Server / worker: at minimum a DB `Ping`
  - `publira server` holds a pool per namespace and names one check per pool — `db.public`, `db.admin`, `db.platform` — so a failure says which login stopped answering. The edge forwards `/rpc`, `/api`, and `/images` alone, so its `/readyz` is not an outsider's to read.
  - Web (`web-admin` / `web-storefront` / `web-platform`): the upstream API's `/readyz` plus Redis (the Redis check is skipped when `PNCH_REDIS_URL` is disabled)
  - Example `/readyz` responses (JSON):
    - Healthy: `{"status":"ok","checks":{"db":{"status":"ok"}}}`
    - Dependency failure: `{"status":"unavailable","checks":{"db":{"status":"error","error":"..."}}}` (HTTP 503)
    - Startup gate not yet open: `{"status":"starting","checks":{...}}` (HTTP 503)
