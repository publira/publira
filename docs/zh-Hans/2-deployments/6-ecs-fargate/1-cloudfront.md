---
title: ECS前方的CloudFront
description: 在Fargate上的Amazon ECS安装实例的内部Application Load Balancer前方部署CloudFront，并从VPC外部进行检查。
published: 2026-11-03
source_updated: 2026-10-22
---

本页是[Fargate上的Amazon ECS](./index.md)的第8步，与之前的步骤在同一个shell中运行：它的命令会用到那些步骤定义的变量和函数，例如`VPC`、`VPC_CIDR`、`ALB`和`allow`。

CloudFront是读者连接的边缘：它用`us-east-1`中的证书为每个租户的主机名终止TLS，把普通HTTP重定向到HTTPS，移除调用方不得自行指定的请求头，并把其余所有内容转发给负载均衡器，这是[边缘必须做什么](../4-edge/index.md#边缘必须做什么)所要求的。

## VPC源站

负载均衡器是内部的，所以CloudFront以VPC源站的方式通过HTTPS访问它：

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

当其状态变为`Deployed`（可用`aws cloudfront get-vpc-origin --id <the VPC origin ID> --query VpcOrigin.Status`查看）后，CloudFront就已在VPC中创建了名为`CloudFront-VPCOrigins-Service-SG`的安全组。只允许它访问负载均衡器，不允许其他任何来源：

```bash
CLOUDFRONT_SG=$(aws ec2 describe-security-groups \
  --filters Name=vpc-id,Values="$VPC" Name=group-name,Values=CloudFront-VPCOrigins-Service-SG \
  --query 'SecurityGroups[0].GroupId' --output text)
allow "$ALB_SG" 443 "$CLOUDFRONT_SG"
```

该安全组属于您自己账户的VPC源站，这就是负载均衡器设为内部而不是面向互联网的原因。面向互联网的负载均衡器要放行CloudFront的托管前缀列表`com.amazonaws.global.cloudfront.origin-facing`，而所有CloudFront分配（不只是您的）都从这些地址连接：调用方只要把自己的分配指向它，就能绕过下文的函数访问负载均衡器，并带上自己任意指定的`Forwarded`和`X-Forwarded-Host`。

## 请求头

一个CloudFront函数在每个查看器请求上运行，在任何其他组件看到请求之前，移除追踪上下文请求头、`Forwarded`、`X-Forwarded-Host`和`X-Forwarded-CountryRegion`，并把最后一个设置为读者所在的地区。`strip-request-headers.js`：

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

`traceparent`、`tracestate`和`baggage`按照[追踪上下文](../4-edge/index.md#追踪上下文)的要求移除。CloudFront和负载均衡器会把调用方发送的`Forwarded`和`X-Forwarded-Host`原样传递下去，而Publira会读取两者，如[客户端地址](../4-edge/index.md#客户端地址)和[请求所发往的主机](../4-edge/index.md#请求所发往的主机)所述；两者自己都不会写入这两个请求头，所以在这里移除它们后，Web应用读取的就是浏览器发送的`Host`，而每个进程的`PUBLIRA_FORWARDED_HEADER_ENABLED`也可以保持默认值。

`X-Forwarded-CountryRegion`把读者所在的地区传给租户的Google tag gateway，如[读者所在地区](../4-edge/index.md#读者所在地区)所述。CloudFront根据读者的地址查出地区，写入`CloudFront-Viewer-Country`（国家代码）和`CloudFront-Viewer-Country-Region`（读者所在一级行政区的代码，即ISO 3166-2代码中国家之后的部分），函数再把两者拼接成该请求头所用的形式，例如`JP-13`。只有当行为的源请求策略转发这两个请求头时，函数才能看到它们，这就是下文默认行为使用`Managed-AllViewerAndCloudFrontHeaders-2022-06`的原因。CloudFront无法确定地区的请求，到达负载均衡器时不带该请求头，调用方自己发送的也不例外。

## 缓存策略

除`/images`之外的所有路径都不经缓存转发，并带上浏览器发送的所有请求头、Cookie和查询字符串：即托管缓存策略`Managed-CachingDisabled`和托管源请求策略`Managed-AllViewerAndCloudFrontHeaders-2022-06`，后者会在浏览器发送的请求头之外，加上CloudFront自己写入的请求头，其中包括读者所在的国家和地区。页面依赖读者的会话Cookie，而Web应用在Valkey中有自己的缓存，由服务器和worker进程发起的重新验证保持其最新；CloudFront中的副本则是重新验证永远无法触及的。该策略会转发用于确定租户的`Host`请求头，以及移动应用用来签名请求的`Authorization`请求头。

`/images`值得缓存。`publira server`把读者无需登录即可查看的图片标记为`public`，最长一小时；需要读者凭据的图片则标记为`private`，CloudFront不会保存它。它根据`Accept`请求头选择格式，根据主机名确定租户，并从`Authorization`或查询字符串中获取读者的凭据，所以这些都应该包含在查找缓存副本所用的键中：

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

`MinTTL`为`0`，这样CloudFront会遵循每个应答的`Cache-Control`，包括`private`和`no-store`；`DefaultTTL`为`0`，这样没有该请求头的应答不会被保存。

## 分配

一个分配服务一个租户：即其域名和控制台主机名，使用同时包含两者的证书。一个分配只持有一个证书，而每个租户都有自己的证书，所以下一个租户要使用单独的分配，如[添加租户](./2-operating.md#添加租户)所述。`distribution.json`：

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

- **ID**。`4135ea2d-…`是`Managed-CachingDisabled`，`33f36d7e-…`是`Managed-AllViewerAndCloudFrontHeaders-2022-06`，`216adef6-…`是`Managed-AllViewer`。`aws elbv2 describe-load-balancers --load-balancer-arns "$ALB" --query 'LoadBalancers[0].DNSName'`会打印负载均衡器的DNS名称。
- **方法**。默认行为允许所有方法，因为页面会提交表单，API也以`POST`调用；`/images`只应答读取请求。
- **上传超时**。CloudFront对请求体没有会影响这里的限制，所以上传和webhook可以原样通过。`OriginReadTimeout`是CloudFront等待负载均衡器应答的时间，未设置时为30秒；120是不提高配额时可设置的最大值，足以让控制台在一整个章节的页面到达后把它们保存下来。
- **函数**同时关联到两个行为：没有关联函数的行为会原样转发调用方的请求头。

分配部署完成后，把两个主机名都指向它的域名（`d111111abcdef8.cloudfront.net`之类）：为每个主机名添加`CNAME`记录；如果区域在Route 53中，也可以添加别名记录。

## 客户端地址

Publira会记录每个请求背后的读者地址，并从边缘写入的`X-Forwarded-For`请求头中读取它，如[客户端地址](../4-edge/index.md#客户端地址)所述。CloudFront把读者的地址追加到调用方写入的任何内容之后，负载均衡器再追加CloudFront连接时所用的地址。代读者调用API的Web应用会接着追加负载均衡器的地址。`publira server`从右往左遍历这些地址，跳过每个它信任的地址，所以`PUBLIRA_TRUSTED_PROXIES`必须覆盖读者之后的每一跳：

- **VPC的地址范围**，负载均衡器和Web应用从这里发起连接。
- **CloudFront面向源站的地址范围**，AWS以服务名`CLOUDFRONT_ORIGIN_FACING`发布这些范围，CloudFront从其中的地址访问负载均衡器。

```bash
TRUSTED_PROXIES="$VPC_CIDR,$(curl -s https://ip-ranges.amazonaws.com/ip-ranges.json \
  | jq -r '[.prefixes[] | select(.service == "CLOUDFRONT_ORIGIN_FACING") | .ip_prefix] | join(",")')"
echo "$TRUSTED_PROXIES"
```

`web-storefront`遍历同样的地址，以找出它传给租户的Google tag gateway的读者地址，所以它使用相同的值。请在[启动服务](./index.md#6-启动服务)的`publira-server.json`和`web-storefront.json`中，把`<see The client address>`替换为该值，重新注册这两个任务定义，并用它们部署这两个服务：

```bash
for family in publira-server web-storefront; do
  aws ecs register-task-definition --cli-input-json "file://$family.json" > /dev/null
  aws ecs update-service --cluster publira --service "$family" --task-definition "$family" > /dev/null
done
```

AWS会不时更改这些范围，并在`AmazonIpSpaceChanged` SNS主题上公布每次更改。在您更新该变量之前，经由新范围到达的请求会以CloudFront的地址而不是读者的地址被记录：该范围之后的所有读者共用一个地址，但没有人能自行选择它。不要信任比这些更宽的范围：如果可信范围覆盖到读者，任何读者都能指定自己想要的地址。

## 检查边缘

DNS记录生效后，从VPC外部检查路由：

```bash
curl -sI https://comics.example.com/ | head -1
curl -s https://comics.example.com/readyz
curl -s -X POST -H 'Content-Type: application/json' -d '{}' \
  https://comics.example.com/rpc/publira.v1.TenantService/GetTenant
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{}' \
  https://comics.example.com/rpc/publira.admin.v1.AdminAuditLogService/ListAuditLogs
curl -sI http://comics.example.com/ | grep -i '^location'
```

第一条命令由`web-storefront`返回`200`；第二条返回其就绪状态，在它能访问`publira server`和Valkey后为`"status":"ok"`。第三条到达`publira server`，后者以`invalid_argument`拒绝这个空请求。第四条调用租户控制台的API，负载均衡器不转发它，直接返回`404`。最后一条返回CloudFront发出的到`https://comics.example.com/`的重定向。在控制台主机名上运行同样的命令，控制台的API在那里也会返回`404`：控制台通过VPC调用它，而不是经过边缘。

然后回到Fargate上的Amazon ECS页面的[登录](./index.md#9-登录)。
