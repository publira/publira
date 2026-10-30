---
title: A web application firewall
description: What a web application firewall in front of an install adds, which managed rules to turn on, the requests of Publira they refuse unless you make exceptions for them, and keeping the consoles to your own networks.
published: 2026-10-30
---

A web application firewall (WAF) in front of the edge inspects each request and refuses the ones that look like an attack, such as SQL injection, cross-site scripting, path traversal, and probes for known vulnerabilities in common software, before they reach anything you run. Publira does not rely on one to be safe. A WAF is a layer in front of the checks Publira makes itself, which also stops scanners and attacks on a vulnerability before an upgrade has fixed it, and keeps the consoles off the internet where your staff work from networks you know.

An install on a cloud platform almost always has a managed load balancer or a CDN in front of it, and its WAF is the one to use: AWS WAF on CloudFront or an Application Load Balancer, Cloud Armor on a Google Cloud load balancer, or Cloudflare. The same WAF also limits how many requests one client may send, as [Rate limits](./5-rate-limits.md) describes.

## Turn on the managed rules

Each WAF ships rule sets its vendor maintains against the common attacks. Turn on these:

| WAF | Rule sets |
| --- | --- |
| AWS WAF | The [core rule set](https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-baseline.html) (`AWSManagedRulesCommonRuleSet`), the known bad inputs (`AWSManagedRulesKnownBadInputsRuleSet`), and the [SQL database](https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-use-case.html) rule group (`AWSManagedRulesSQLiRuleSet`), in the web ACL of the CloudFront distribution or the load balancer |
| Google Cloud Armor | The [preconfigured WAF rules](https://cloud.google.com/armor/docs/waf-rules) of the OWASP Core Rule Set 4.22, at least `sqli-v422-stable`, `xss-v422-stable`, `lfi-v422-stable`, `rfi-v422-stable`, `rce-v422-stable`, `protocolattack-v422-stable`, and `scannerdetection-v422-stable`, in the security policy of the load balancer's backend services. Start at sensitivity 1, which raises the fewest false positives, and raise it once the logs are clean |
| Cloudflare | The [Cloudflare Managed Ruleset and the Cloudflare OWASP Core Ruleset](https://developers.cloudflare.com/waf/managed-rules/) on Pro and above, or the Cloudflare Free Managed Ruleset on Free |

A rule that refuses a reader's or a provider's legitimate request breaks the install as surely as an outage, so let each rule record without refusing first, with its action overridden to Count in AWS WAF or in preview mode in Cloud Armor. Read what it would have refused over real traffic, make the exceptions below for what it caught, and only then let it refuse.

## Requests the managed rules refuse

The rule sets are written for the common web application, and some of what Publira serves is not that:

| Requests | What they carry | What refuses them | What to do |
| --- | --- | --- | --- |
| The uploads: `/api/v1/episode-pages` on a console host, the rest of `/api/v1/`, the pages that upload an image, and a reader's icon sent to the public API | A body of up to 256 MiB, 33 MiB, 11 MiB, and 15 MiB, as [Uploads in the tenant console](../../2-deployments/4-edge/index.md#uploads-in-the-tenant-console) and [Image uploads from a page](../../2-deployments/4-edge/index.md#image-uploads-from-a-page) describe | AWS WAF's `SizeRestrictions_BODY`, which refuses every body over 8 KB | Set that rule to Count; the edge's own limit on the size of a body is the one that matters |
| The webhooks under `/api/v1/webhook/` | A payment provider's event, or a reader's whole emailed reply with its HTML and its attachments | The body rules for cross-site scripting, SQL injection, and file inclusion, which a mail's HTML and text trip | Skip the managed rules on this path. Publira checks the signature each provider puts on the body, so a forged request is refused without them, and a refused one is retried and then lost, as [Webhooks](../../2-deployments/4-edge/index.md#webhooks) describes |
| What readers and staff write: comments, contact messages, and on a console host, pages, announcements, and replies | Text that may quote code, such as a reader asking why `<b>` shows up in a title | The body rules for cross-site scripting and SQL injection | Keep the rules. If the log shows them refusing such text, lower the sensitivity of the rule that does, or skip that rule on the console hosts alone, where only signed-in staff write |

The mobile app sends the public API its requests as binary Protocol Buffers (`application/proto`), whose text fields reach the WAF as the bytes the reader typed, so the body rules read them as they would read a form.

A WAF inspects only the start of a body: 8 KB on an Application Load Balancer and 16 KB on CloudFront by default in AWS WAF, up to 64 KB in Cloud Armor, and 1 MB on Cloudflare's Free plan and 128 KB on Enterprise. Leave AWS WAF's handling of a body past that at Continue, which inspects the part within the limit: Match, on a rule that blocks, refuses every upload.

## Keep the consoles to your networks

A console host serves your staff and your operators alone: readers, the mobile app, and every webhook reach the tenant's site, never a console host. When your staff work from networks you know, such as an office or a VPN, allow only those addresses to the console hosts, with an IP set in AWS WAF, a rule matching the source address in Cloud Armor, or a custom rule in Cloudflare, and the consoles' sign-in pages are off the internet. A member of staff opening an invitation or a password reset from elsewhere is refused too, so tell them to use the network the console allows.

## Bot challenges

A bot challenge or a sign-in prompt in front of a path is a WAF feature that refuses every client that cannot answer one, and neither the mobile app nor a webhook provider can. Keep both off the public API, the images, and the webhooks.

## The proxy you run

None of the [sample configurations](../../2-deployments/4-edge/1-sample-configurations.md) carries a WAF. A WAF module for a proxy you run, such as ModSecurity or Coraza with the OWASP Core Rule Set, takes the same exceptions as above.
