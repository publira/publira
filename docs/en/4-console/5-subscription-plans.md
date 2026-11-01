---
title: Subscription plans
description: Sell readers a plan billed every period through Stripe that opens the whole catalog, some labels, or some series, and see what a subscriber does on the site.
published: 2026-10-25
updated: 2026-11-01
---

A subscription plan lets a reader pay every period, through Stripe, and read every episode the plan covers without buying each one. Selling one takes three things that have to agree, the same three a sale of an episode takes: a recurring Price in the tenant's Stripe account, a plan in the tenant console that names it, and the webhook through which Stripe tells the install that a reader subscribed, paid, renewed, fell behind, or canceled. Stripe bills the reader, but only the webhook opens the plan's episodes to them and closes them again, so a setup with any of the three wrong takes the reader's money and leaves the episodes locked, or leaves them open to a reader who has stopped paying. This page walks through all three in that order, and ends with a test subscription that proves they agree.

Every plan is sold through Stripe on the site, and a tenant that takes payments through PAY.JP cannot create one. A plan can also name the subscription the tenant's app sells it as in the App Store and in Google Play, as [Creating a plan](#creating-a-plan) describes. The tenant's app sends a reader who wants a plan to the site's plan page when it sells through **Web checkout**, as [In-app purchase and sign-in](../5-mobile-app/5-purchases-and-sign-in.md#selling-episodes-in-the-app) describes.

**Payments** › **Subscription plans** is for a **Tenant admin**; an Editor or an Auditor does not see that screen.

## Before you start

The tenant takes payments through Stripe, with **Payment settings** on **Payments** › **Payment methods** showing **Ready**, as [Selling episodes](./4-selling-episodes.md#stripe) describes. The console reads every plan's Price from the Stripe account of the secret key saved there, so a plan cannot be saved until it is.

Stripe's webhook endpoint needs four events beside the seven a sale of an episode needs:

- `customer.subscription.updated`, sent when a subscription renews, falls behind on a payment, is set to cancel, or changes plan.
- `customer.subscription.deleted`, sent when a subscription ends.
- `invoice.payment_failed`, sent when Stripe fails to collect a renewal.
- `invoice.paid`, sent when Stripe is paid a subscription's invoice, the first one and every renewal.

Without the first three, a subscription is recorded when its checkout is paid and never follows Stripe afterwards: its episodes close when the period paid for ends, even for a reader whose renewal went through, and a reader who cancels keeps reading until that day. Without `invoice.paid`, no payment is recorded, so the plans' income is in no revenue figure and on no royalty statement, as [What a payment pays the Authors](#what-a-payment-pays-the-authors) describes. A payment made before the event was added is not recorded afterwards. Add them to the endpoint in test mode, and again to the live-mode endpoint before going live.

## Creating the Price in Stripe

In the Stripe Dashboard, in the same account and mode as the secret key:

1. Add a product to the product catalog for the plan. Its name is what Stripe shows the reader on its checkout page and on their invoices.
2. Give it a **Recurring** price of one fixed amount, and choose its billing period: daily, weekly, monthly, yearly, or a custom one such as every 3 months.
3. Open the price and copy its ID, which starts with `price_`.

The console refuses a Price that is not one fixed amount every period: a one-off price, a usage-based or metered one, a tiered one, and one that lets the customer choose what to pay. It refuses an archived Price too. The plan bills the amount, the currency, and the billing period that Price states, and the site quotes the plan in that currency, so create the Price in the tenant's currency. A Price's amount never changes in Stripe: to charge a different amount, create a new Price and enter its ID on the plan, as [Changing, unpublishing, and deleting a plan](#changing-unpublishing-and-deleting-a-plan) describes.

Test-mode and live-mode Prices are separate, each with its own ID. When you move to live keys, create the Price again in live mode and enter its ID on the plan, as [Testing before going live](#testing-before-going-live) describes.

### The customer portal

A subscriber changes their card or cancels in Stripe's customer portal, which **Manage billing** on the site opens. The portal is configured in the tenant's own Stripe Dashboard, under the billing settings, and nothing about it is set in the console: open its settings and save them, in test mode and again in live mode, so that Stripe has a configuration to open the portal with. There you choose whether a reader can cancel, and whether a cancellation takes effect at once or at the end of the period they paid for.

A reader who subscribed in the tenant's app, through the App Store or through Google Play, changes and cancels that subscription in the store. Stripe's portal cannot open it, and **My Page** does not offer **Manage billing** for it. It offers **Manage in the App Store** or **Manage in Google Play**, which open the page where the reader manages the subscriptions on their store account.

The portal can also let a reader switch to another product's price. A reader who switches to a Price another of the tenant's plans bills is recorded on that plan from then on, and reads what it opens. Offer only Prices that a plan bills there: a reader switched to a Price no plan bills stays on the plan they subscribed to, paying the new price.

## Creating a plan

On **Payments** › **Subscription plans**, choose **New plan**, fill in the form, and choose **Create plan**:

- **Name** is what readers see the plan as on the site, up to 100 characters.
- **Description** is plain text shown with the plan, up to 2000 characters.
- **Stripe Price ID** is the `price_` ID copied above. What the plan costs and how often it bills are read from Stripe when the plan is saved, and the console shows them as Stripe states them.
- **App Store product ID** and **Google Play product ID** name the subscription the tenant's app sells the plan as in each store, and either can be left empty. The app sells the plan through a store only while **How the app sells episodes** is **In-app purchase**, and only when the plan names a product of that store. Create the product in the store at the plan's price and billing period, as an auto-renewable subscription in App Store Connect and as a subscription with a base plan in Play Console, as [What each store needs for in-app purchase](../5-mobile-app/5-purchases-and-sign-in.md#what-each-store-needs-for-in-app-purchase) describes. The console does not check the ID with the store, so an ID with no product behind it fails at the first purchase, which the app reports as not sold.
- **Opens** decides which episodes the plan opens:
  - **Whole catalog**: every episode of the site.
  - **Labels**: every episode of the series filed under the labels you choose, up to 100. A series filed under one of them later is opened too.
  - **Series**: every episode of the series you choose, up to 100.
- **Publish** lists the plan on the site, where readers can subscribe to it. Leave it unchecked to prepare a plan before offering it.

![The edit screen of Night pass, yearly: ¥9,800 a year, Unpublished, 0 subscribers, and App Store and Google Play under Stores above the form, then Name, Description, Stripe Price ID, App Store product ID and Google Play product ID both holding night_pass_yearly, Opens with Labels chosen, the Labels picker holding Night Label, Publish unchecked, and Save changes.](./subscription-plans-form.png)

The form says which field to correct when Stripe holds no Price of one fixed amount every period under that ID, and when another plan already bills it: each plan bills a Price of its own, so a second plan at the same amount needs a second Price in Stripe. A store product ID is likewise one plan's own, and the form marks the field of an ID another plan is already sold as, and of one holding a character the store does not take: an App Store product ID holds letters, digits, underscores, and periods, and a Google Play one lowercase letters, digits, underscores, and periods, starting with a letter or a digit. It refuses any plan while Stripe is not the tenant's payment provider with payments enabled. A tenant holds at most 20 plans.

## The list of plans

**Payments** › **Subscription plans** lists every plan, in the order they were created, with what it costs every period, what it opens, the **Stores** whose app sells it, whether it is **Published** or **Unpublished**, and how many **Subscribers** it has. A subscriber is a reader whose subscription to the plan is paid up, or whose renewal Stripe is still trying to collect. **Edit** opens a plan's form, with its price, its status, its subscribers, and its stores above it.

![The Subscription plans list: Night pass at ¥980 a month opening 1 label, sold in no store, published, with 0 subscribers; All-access pass at ¥1,500 a month opening the whole catalog, sold in the App Store and Google Play, published, with 1 subscriber; and Night pass, yearly at ¥9,800 a year opening 1 label, sold in the App Store and Google Play, unpublished, with 0 subscribers, each with Edit and Delete.](./subscription-plans-list.png)

## Changing, unpublishing, and deleting a plan

A change to a plan's **Name**, **Description**, or **Opens** reaches every subscriber at once: what the plan opens is what each of its subscribers reads from the moment it is saved.

A new **Stripe Price ID** changes what the plan costs for the readers who subscribe from then on. A reader who already subscribed keeps paying the Price they started at, and stays on the plan. To change what they pay, change their subscriptions in the Stripe Dashboard.

Unchecking **Publish** takes the plan off the site: it is no longer listed, and no locked episode offers it. Unpublishing ends no subscription. Its subscribers keep reading what it opens, and Stripe keeps billing them, until each of them cancels; to end their subscriptions yourself, cancel them in the Stripe Dashboard.

**Delete** removes a plan that nobody has subscribed to. A plan any reader has subscribed to, now or in the past, is kept as the record of what they paid for, and the console asks you to unpublish it instead. So is a plan that a reader's most recent checkout was for, paid or not.

## What a plan opens

A subscription opens the episodes its plan covers, on the site and in the tenant's app, for as long as Stripe reports it in good standing and its current period has not ended:

- **Active**, or in a trial, while its period runs. A subscription set to cancel at the end of its period stays open until then.
- **Past due**, while Stripe retries a renewal it failed to collect. This is the grace a reader gets to fix their card, and how long it lasts is the retry schedule in the tenant's Stripe billing settings, which also decides what the subscription becomes once Stripe gives up: canceled or unpaid.

A subscription that is canceled, unpaid, paused, or whose first payment never went through opens nothing.

An episode a subscriber also bought is still listed as their purchase, and stays theirs for its reading period after the subscription ends. Readers can hold one subscription at a time.

## What a payment pays the Authors

Every payment Stripe takes for a plan, the first one and every renewal, is recorded when the `invoice.paid` notification reaches the install. It counts in the tenant's revenue on the day it was paid, apart from the purchases, and a refund made in the Stripe Dashboard is taken off that day.

The royalty statement of the month the period it paid for ends in shares it among the episodes of the plan the subscriber finished during that period, and pays each episode's part to its Authors at their shares. A payment whose subscriber finished none of them is shared with no one, and stays the publisher's. The rule, and how a refund after the close is taken back, is in [Reports and royalties](./6-reports-and-royalties.md#subscription-payments).

## What a reader sees

The site's plan page, `https://<tenant-domain>/plans`, lists the published plans with what each costs every period, its description, and the labels or the works it covers that the site shows. A reader reaches it from **Subscribe**, which a locked episode offers beside the purchase when a published plan covers it, and from **See plans** on **My Page**. Nothing else on the site links to it, so link to it yourself where you tell readers about a plan.

1. The reader chooses **Subscribe** on a plan. A reader who is not signed in is offered **Sign in to subscribe** instead, and one who already holds a plan is told which one and sent to **My Page**. When that plan is billed through the App Store or Google Play, the message names the store.
2. Stripe's checkout page takes the payment, with a promotion code if the reader has one, as for an episode. Leaving it brings the reader back to the plan page, which tells them they have not been charged.
3. Once paid, the reader comes back to **My Page**, which thanks them and says the plan appears once the payment is confirmed. The plan's episodes open when the webhook's notification reaches the install, usually within seconds.

From then on **My Page** opens with **Your plan**: the plan's name and, depending on where the subscription stands, when it renews, when it ends after a cancellation, a payment to fix, or that it has ended. **Manage billing** opens Stripe's customer portal, where the reader updates their card, reads their invoices, or cancels, and what they change there reaches the site through the webhook. A reader who subscribed in the app sees which store bills the plan, and **Manage in the App Store** or **Manage in Google Play** in place of **Manage billing**. A payment that did not go through, and a plan that is on hold, tell that reader to update the payment method in the store rather than under **Manage billing**. A plan that has ended offers **See plans**, as one Stripe billed does. A reader whose store subscription has ended can subscribe on the site: the plan page lists the plans the site sells and offers **Subscribe**.

While **Payment settings** is not **Ready**, the plan page says the site cannot take subscriptions at the moment, and no locked episode offers a plan. Choosing PAY.JP as the payment provider deletes the Stripe credentials: the site then stops selling plans, Stripe's notifications about the subscriptions already sold are refused, and Stripe goes on billing those readers, so cancel them in the Stripe Dashboard before switching.

Deleting a reader's account cancels their subscription in Stripe at once, without refunding the period they paid for, as [Reader accounts](./2-readers/1-accounts.md#deleting-a-reader) describes.

## When a subscription does not follow Stripe

The deliveries listed for the webhook endpoint in the Stripe Dashboard show the cause, as they do for a purchase, and the statuses mean what [When a payment does not open the episode](./4-selling-episodes.md#when-a-payment-does-not-open-the-episode) describes. Three causes are particular to subscriptions:

- **A reader paid, and My Page shows no plan.** The `checkout.session.completed` delivery failed. Once it is fixed and the delivery is resent, the subscription is recorded and its episodes open.
- **A renewal, a cancellation, or a failed payment does not show on My Page.** The endpoint does not send `customer.subscription.updated`, `customer.subscription.deleted`, or `invoice.payment_failed`. Add them. The install reads the whole subscription from Stripe whenever a notification about it arrives, so the next one brings each subscription up to date.
- **A payment is in no revenue figure and on no royalty statement.** The endpoint does not send `invoice.paid`, or its delivery failed. Add the event, and resend the failed delivery: a payment is recorded once however often its notification arrives.

## Testing before going live

Test the whole setup in Stripe's test mode before readers can subscribe. Only a subscription shows that the webhook works, and only a cancellation shows that it follows Stripe afterwards.

1. Set up Stripe with its **test** secret key, and add all eleven events to the test-mode endpoint, as above. Check that **Payment settings** shows **Ready**.
2. In test mode, create the recurring Price, and save the customer portal's settings.
3. Create a series for the test, shown on **Web and app** or **Web only** and published now, with a paid episode in it, published now and sold on the web, as [Testing before going live](./4-selling-episodes.md#testing-before-going-live) describes for a sale.
4. Create a plan with the test Price that opens that series, with **Publish** checked.
5. On the site, sign in with a reader account that holds no console role: staff read every published episode free, so the episode offers them nothing. Open the paid episode, and choose **Subscribe**.
6. On the plan page, choose **Subscribe**, and pay with the test card `4242 4242 4242 4242`, any future expiry date, and any three-digit security code.
7. Back on **My Page**, wait for **Your plan** to show the plan and when it renews, then open the episode: it reads without a purchase. If the plan does not appear within a minute, read the delivery in the Stripe Dashboard, as [When a subscription does not follow Stripe](#when-a-subscription-does-not-follow-stripe) describes.
8. Choose **Manage billing**, and cancel the subscription in the portal. Back on **My Page**, **Your plan** shows the cancellation: the day it ends, or that it has ended if the portal cancels at once. Cancel the subscription in the Stripe Dashboard as well, if it is still running, and reload the episode: it is locked again.

When the test passes, uncheck **Publish** on the test plan and set the test series' **Shown on** to **Not shown anywhere**. The test plan now has a subscriber in its history, so it cannot be deleted; it stays in the list unpublished. Then replace the test secret key with the live one, add the live-mode endpoint with all eleven events, enter its signing secret, and save. Create the plan's Price again in live mode, save the customer portal's settings in live mode, and create the plans readers will subscribe to with the live Prices.
