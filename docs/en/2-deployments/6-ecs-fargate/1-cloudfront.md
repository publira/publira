---
title: CloudFront in front of ECS
description: Put CloudFront in front of the internal Application Load Balancer of an install on Amazon ECS on Fargate, and check it from outside the VPC.
published: 2026-10-21
updated: 2026-10-22
---

This page is step 8 of [Amazon ECS on Fargate](./index.md), and runs in the same shell as the steps before it: its commands use the variables and the functions those steps defined, such as `VPC`, `VPC_CIDR`, `ALB`, and `allow`.

CloudFront is the edge readers connect to: it terminates TLS for every tenant's hosts with the certificate in `us-east-1`, redirects plain HTTP to HTTPS, removes the headers a caller must not choose, and forwards everything else to the load balancer, as [What the edge has to do](../4-edge/index.md#what-the-edge-has-to-do) requires.

## The VPC origin

The load balancer is internal, so CloudFront reaches it as a VPC origin, over HTTPS:

```bash
aws cloudfront create-vpc-origin --vpc-origin-endpoint-config "{
  \"Name\": \"publira\",
  \"Arn\": \"$ALB\",
  \"HTTPPort\": 80,
  \"HTTPSPort\": 443,
  \"OriginProtocolPolicy\": \"https-only\",
  \"OriginSslProtocols\": { \"Quantity\": 1, \"Items\": [\"TLSv1.2\"] }
}" --query 'VpcOrigin.Id' --output text
```

Once its status is `Deployed`, which `aws cloudfront get-vpc-origin --id <the VPC origin ID> --query VpcOrigin.Status` shows, CloudFront has created a security group named `CloudFront-VPCOrigins-Service-SG` in the VPC. Let it, and nothing else, reach the load balancer:

```bash
CLOUDFRONT_SG=$(aws ec2 describe-security-groups \
  --filters Name=vpc-id,Values="$VPC" Name=group-name,Values=CloudFront-VPCOrigins-Service-SG \
  --query 'SecurityGroups[0].GroupId' --output text)
allow "$ALB_SG" 443 "$CLOUDFRONT_SG"
```

That group belongs to the VPC origins of your own account, which is why the load balancer is internal rather than on the internet. A load balancer on the internet would admit CloudFront's managed prefix list, `com.amazonaws.global.cloudfront.origin-facing`, which every CloudFront distribution connects from and not only yours: a caller who points a distribution of their own at it reaches the load balancer past the function below, with a `Forwarded` and an `X-Forwarded-Host` of their choosing.

## The headers

A CloudFront Function on every viewer request removes the trace context headers, `Forwarded`, `X-Forwarded-Host`, and `X-Forwarded-CountryRegion` before anything else sees the request, and sets the last of them to the reader's region. `strip-request-headers.js`:

```js
function handler(event) {
  var headers = event.request.headers;
  delete headers.traceparent;
  delete headers.tracestate;
  delete headers.baggage;
  delete headers.forwarded;
  delete headers["x-forwarded-host"];
  delete headers["x-forwarded-countryregion"];
  var country = headers["cloudfront-viewer-country"];
  var region = headers["cloudfront-viewer-country-region"];
  if (country && region) {
    headers["x-forwarded-countryregion"] = {
      value: country.value + "-" + region.value,
    };
  }
  return event.request;
}
```

```bash
aws cloudfront create-function --name publira-strip-request-headers \
  --function-config Comment=publira,Runtime=cloudfront-js-2.0 \
  --function-code fileb://strip-request-headers.js --query ETag --output text
aws cloudfront publish-function --name publira-strip-request-headers --if-match <the ETag above>
```

`traceparent`, `tracestate`, and `baggage` are removed as [Trace context](../4-edge/index.md#trace-context) requires. CloudFront and the load balancer pass on a `Forwarded` and an `X-Forwarded-Host` the caller sent, and Publira would read both, as [The client address](../4-edge/index.md#the-client-address) and [The host the request was sent to](../4-edge/index.md#the-host-the-request-was-sent-to) describe; neither of them writes either header itself, so removing them here leaves the web apps reading the `Host` the browser sent, and `PUBLIRA_FORWARDED_HEADER_ENABLED` at its default on every process.

`X-Forwarded-CountryRegion` carries the reader's region to a tenant's Google tag gateway, as [The reader's region](../4-edge/index.md#the-readers-region) describes. CloudFront looks the region up from the reader's address into `CloudFront-Viewer-Country`, a country code, and `CloudFront-Viewer-Country-Region`, the code of the reader's first-level subdivision that follows the country in its ISO 3166-2 code, and the function joins the two into the form the header takes, such as `JP-13`. A function sees those two headers only when the behaviour's origin request policy forwards them, which is why the default behaviour below uses `Managed-AllViewerAndCloudFrontHeaders-2022-06`. A request CloudFront places in no region reaches the load balancer without the header, a caller's included.

## The cache policies

Every path but `/images` is forwarded uncached, with every header, cookie, and query string the browser sent: the managed cache policy `Managed-CachingDisabled` and the managed origin request policy `Managed-AllViewerAndCloudFrontHeaders-2022-06`, which adds the headers CloudFront writes itself, the reader's country and region among them, to the ones the browser sent. The pages depend on the reader's session cookie, and the web apps keep a cache of their own in Valkey, which the revalidation from the server and the worker keeps current; a copy in CloudFront would be one that revalidation never reaches. It forwards the `Host` header, which picks the tenant, and the `Authorization` header the mobile app signs its requests with.

`/images` is worth caching. `publira server` marks an image a reader may be shown without signing in as `public` for up to an hour, and one that needs a reader's credential as `private`, which CloudFront does not store. It picks the format from the `Accept` header, and the tenant from the host, and takes a reader's credential from `Authorization` or from the query string, so each of those belongs in the key a cached copy is found by:

```bash
aws cloudfront create-cache-policy --cache-policy-config '{
  "Name": "publira-images",
  "MinTTL": 0,
  "DefaultTTL": 0,
  "MaxTTL": 86400,
  "ParametersInCacheKeyAndForwardedToOrigin": {
    "EnableAcceptEncodingGzip": false,
    "EnableAcceptEncodingBrotli": false,
    "HeadersConfig": {
      "HeaderBehavior": "whitelist",
      "Headers": { "Quantity": 3, "Items": ["Host", "Accept", "Authorization"] }
    },
    "CookiesConfig": { "CookieBehavior": "none" },
    "QueryStringsConfig": { "QueryStringBehavior": "all" }
  }
}' --query 'CachePolicy.Id' --output text
```

`MinTTL` is `0` so CloudFront follows the `Cache-Control` of every answer, `private` and `no-store` included, and `DefaultTTL` is `0` so an answer without one is not stored.

## The distribution

One distribution serves one tenant: its domain and its console host, with the certificate that names both. A distribution holds one certificate, and a tenant's certificate is its own, so the next tenant gets a distribution of its own, as [Adding a tenant](./2-operating.md#adding-a-tenant) describes. `distribution.json`:

```json
{
  "CallerReference": "publira-comics-example-com",
  "Comment": "comics.example.com",
  "Enabled": true,
  "HttpVersion": "http2and3",
  "IsIPV6Enabled": true,
  "Aliases": {
    "Quantity": 2,
    "Items": ["comics.example.com", "admin.comics.example.com"]
  },
  "ViewerCertificate": {
    "ACMCertificateArn": "<the certificate ARN in us-east-1>",
    "SSLSupportMethod": "sni-only",
    "MinimumProtocolVersion": "TLSv1.2_2021"
  },
  "Origins": {
    "Quantity": 1,
    "Items": [
      {
        "Id": "publira",
        "DomainName": "<the load balancer's DNS name>",
        "VpcOriginConfig": {
          "VpcOriginId": "<the VPC origin ID>",
          "OriginReadTimeout": 120,
          "OriginKeepaliveTimeout": 5
        }
      }
    ]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "publira",
    "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": {
      "Quantity": 7,
      "Items": ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"],
      "CachedMethods": { "Quantity": 2, "Items": ["GET", "HEAD"] }
    },
    "Compress": true,
    "CachePolicyId": "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
    "OriginRequestPolicyId": "33f36d7e-f396-46d9-90e0-52428a34d9dc",
    "FunctionAssociations": {
      "Quantity": 1,
      "Items": [
        {
          "EventType": "viewer-request",
          "FunctionARN": "arn:aws:cloudfront::<account>:function/publira-strip-request-headers"
        }
      ]
    }
  },
  "CacheBehaviors": {
    "Quantity": 1,
    "Items": [
      {
        "PathPattern": "/images*",
        "TargetOriginId": "publira",
        "ViewerProtocolPolicy": "redirect-to-https",
        "AllowedMethods": {
          "Quantity": 2,
          "Items": ["GET", "HEAD"],
          "CachedMethods": { "Quantity": 2, "Items": ["GET", "HEAD"] }
        },
        "Compress": false,
        "CachePolicyId": "<the publira-images cache policy ID>",
        "OriginRequestPolicyId": "216adef6-5c7f-47e4-b989-5492eafa07d3",
        "FunctionAssociations": {
          "Quantity": 1,
          "Items": [
            {
              "EventType": "viewer-request",
              "FunctionARN": "arn:aws:cloudfront::<account>:function/publira-strip-request-headers"
            }
          ]
        }
      }
    ]
  }
}
```

```bash
aws cloudfront create-distribution --distribution-config file://distribution.json \
  --query 'Distribution.[Id,DomainName]' --output text
```

- **The IDs.** `4135ea2d-…` is `Managed-CachingDisabled`, `33f36d7e-…` is `Managed-AllViewerAndCloudFrontHeaders-2022-06`, and `216adef6-…` is `Managed-AllViewer`. `aws elbv2 describe-load-balancers --load-balancer-arns "$ALB" --query 'LoadBalancers[0].DNSName'` prints the load balancer's DNS name.
- **The methods.** The default behaviour admits every method, since the pages post forms and the API is called with `POST`; `/images` answers reads alone.
- **The upload timeout.** CloudFront sets no limit on a body that matters here, so the uploads and webhooks pass it as they are. `OriginReadTimeout` is how long CloudFront waits for the load balancer to answer, 30 seconds unless set; 120 is the most it takes without raising the quota, and leaves the console time to store a whole episode's pages once they have arrived.
- **The function** is associated with both behaviours: a behaviour that names none forwards the caller's headers untouched.

Once the distribution is deployed, point both host names at its domain name, `d111111abcdef8.cloudfront.net` or the like: a `CNAME` record for each, or an alias record if the zone is in Route 53.

## The client address

Publira records the address of the reader behind every request, and reads it from the `X-Forwarded-For` header the edge writes, as [The client address](../4-edge/index.md#the-client-address) describes. CloudFront puts the reader's address there, appending it to whatever the caller wrote, and the load balancer appends the address CloudFront connected from. A web app that calls the API for a reader appends the load balancer's address in turn. `publira server` walks those addresses from the right and steps over each one it trusts, so `PUBLIRA_TRUSTED_PROXIES` has to cover every hop after the reader:

- **The VPC's range**, which the load balancer and the web apps connect from.
- **CloudFront's origin-facing ranges**, which AWS publishes under the service `CLOUDFRONT_ORIGIN_FACING`, for the address CloudFront reaches the load balancer from.

```bash
TRUSTED_PROXIES="$VPC_CIDR,$(curl -s https://ip-ranges.amazonaws.com/ip-ranges.json \
  | jq -r '[.prefixes[] | select(.service == "CLOUDFRONT_ORIGIN_FACING") | .ip_prefix] | join(",")')"
echo "$TRUSTED_PROXIES"
```

`web-storefront` walks the same addresses to find the reader's address it passes to a tenant's Google tag gateway, so it takes the same value. Write it in place of `<see The client address>` in the `publira-server.json` and the `web-storefront.json` of [Start the services](./index.md#6-start-the-services), register both task definitions again, and deploy both services with them:

```bash
for family in publira-server web-storefront; do
  aws ecs register-task-definition --cli-input-json "file://$family.json" > /dev/null
  aws ecs update-service --cluster publira --service "$family" --task-definition "$family" > /dev/null
done
```

AWS changes those ranges from time to time, and announces each change on the `AmazonIpSpaceChanged` SNS topic. Until you update the variable, a request that arrived through a new range is recorded with CloudFront's address rather than the reader's: every reader behind that range shares an address, but none of them can choose it. Trust no wider range than these: a trusted range that reaches readers lets any of them name an address of their choosing.

## Check the edge

Once the DNS records answer, check the routing from outside the VPC:

```bash
curl -sI https://comics.example.com/ | head -1
curl -s https://comics.example.com/readyz
curl -s -X POST -H 'Content-Type: application/json' -d '{}' \
  https://comics.example.com/rpc/publira.v1.TenantService/GetTenant
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{}' \
  https://comics.example.com/rpc/publira.admin.v1.AdminAuditLogService/ListAuditLogs
curl -sI http://comics.example.com/ | grep -i '^location'
```

The first answers `200` from `web-storefront`, and the second with its readiness, `"status":"ok"` once it reaches `publira server` and Valkey. The third reaches `publira server`, which refuses the empty request with `invalid_argument`. The fourth calls the tenant console's API, and the load balancer answers it with `404` without forwarding it. The last answers with CloudFront's redirect to `https://comics.example.com/`. Run the same on the console host, where the console's API answers `404` as well: the console calls it over the VPC, not through the edge.

Then go back to [Sign in](./index.md#9-sign-in) on the Amazon ECS on Fargate page.
