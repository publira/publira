---
title: ECS前方的CloudFront
description: 在AWS Fargate上之Amazon ECS安裝實例的內部Application Load Balancer前方設置CloudFront，並從VPC外部進行檢查。
published: 2026-11-03
source_updated: 2026-10-22
---

本頁是[在AWS Fargate上執行Amazon ECS](./index.md)的第8步，並在與先前步驟相同的shell中執行：其指令會使用那些步驟所定義的變數與函式，例如`VPC`、`VPC_CIDR`、`ALB`與`allow`。

CloudFront是讀者所連線的邊緣：它以`us-east-1`中的憑證為每個租戶的主機終止TLS、把純HTTP重新導向至HTTPS、移除呼叫端不得自行指定的標頭，並把其他所有內容轉送到負載平衡器，這是[邊緣必須做的事](../4-edge/index.md#邊緣必須做的事)的要求。

## VPC來源

負載平衡器是內部的，因此CloudFront以VPC來源的形式，透過HTTPS存取它：

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

當其狀態變為`Deployed`（可用`aws cloudfront get-vpc-origin --id <the VPC origin ID> --query VpcOrigin.Status`查看）後，CloudFront就已在VPC中建立了名為`CloudFront-VPCOrigins-Service-SG`的安全群組。請只允許該群組存取負載平衡器，其他一概不允許：

```bash
CLOUDFRONT_SG=$(aws ec2 describe-security-groups \
  --filters Name=vpc-id,Values="$VPC" Name=group-name,Values=CloudFront-VPCOrigins-Service-SG \
  --query 'SecurityGroups[0].GroupId' --output text)
allow "$ALB_SG" 443 "$CLOUDFRONT_SG"
```

該群組屬於您自己帳戶的VPC來源，這正是負載平衡器設為內部而不放在網際網路上的原因。若負載平衡器位於網際網路上，就必須允許CloudFront的受管前綴清單`com.amazonaws.global.cloudfront.origin-facing`，而所有CloudFront分佈（不只是您的）都是從這些位址連線的：任何人只要把自己的分佈指向它，就能繞過下方的函式存取負載平衡器，並帶上自行選擇的`Forwarded`與`X-Forwarded-Host`。

## 標頭

對每個檢視器請求執行的CloudFront Function，會在任何其他東西看到請求之前，移除追蹤脈絡標頭、`Forwarded`、`X-Forwarded-Host`與`X-Forwarded-CountryRegion`，並把最後一個標頭設為讀者的地區。`strip-request-headers.js`：

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

`traceparent`、`tracestate`與`baggage`依[追蹤脈絡](../4-edge/index.md#追蹤脈絡)的要求移除。CloudFront與負載平衡器會把呼叫端送來的`Forwarded`與`X-Forwarded-Host`原樣傳下去，而Publira會讀取兩者，如[用戶端位址](../4-edge/index.md#用戶端位址)與[請求所送往的主機](../4-edge/index.md#請求所送往的主機)所述；兩者本身都不會寫入這些標頭，因此在這裡移除它們，就能讓Web應用程式讀取瀏覽器送出的`Host`，並讓每個處理程序的`PUBLIRA_FORWARDED_HEADER_ENABLED`維持預設值。

`X-Forwarded-CountryRegion`會把讀者的地區傳給租戶的Google代碼閘道，如[讀者的地區](../4-edge/index.md#讀者的地區)所述。CloudFront會依讀者的位址查詢地區，寫入`CloudFront-Viewer-Country`（國家代碼）與`CloudFront-Viewer-Country-Region`（讀者所在一級行政區的代碼，即ISO 3166-2代碼中接在國家之後的部分），函式再把兩者合併為該標頭所採用的格式，例如`JP-13`。只有當行為的來源請求政策轉送這兩個標頭時，函式才看得到它們，這就是下方的預設行為使用`Managed-AllViewerAndCloudFrontHeaders-2022-06`的原因。CloudFront無法判定地區的請求，抵達負載平衡器時不會帶有該標頭，包括呼叫端自行送出的在內。

## 快取政策

除了`/images`以外的每個路徑都不經快取轉送，並帶上瀏覽器送出的每個標頭、Cookie與查詢字串：使用受管快取政策`Managed-CachingDisabled`，以及受管來源請求政策`Managed-AllViewerAndCloudFrontHeaders-2022-06`，後者會在瀏覽器送出的標頭之外，再加上CloudFront自己寫入的標頭，其中包括讀者的國家與地區。頁面取決於讀者的工作階段Cookie，而Web應用程式在Valkey中保有自己的快取，並由來自伺服器與worker的重新驗證保持最新；CloudFront中的副本將是重新驗證永遠觸及不到的副本。它會轉送用來選擇租戶的`Host`標頭，以及行動應用程式用來簽署請求的`Authorization`標頭。

`/images`則值得快取。`publira server`會把讀者無需登入即可查看的圖片標記為`public`，最長一小時；需要讀者認證資訊的圖片則標記為`private`，CloudFront不會儲存這類圖片。它依`Accept`標頭選擇格式、依主機選擇租戶，並從`Authorization`或查詢字串取得讀者的認證資訊，因此這些都必須納入用來尋找快取副本的鍵中：

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

`MinTTL`設為`0`，讓CloudFront遵循每個回應的`Cache-Control`，包括`private`與`no-store`；`DefaultTTL`設為`0`，讓沒有該標頭的回應不被儲存。

## 分佈

一個分佈服務一個租戶：其網域與主控台主機，並使用同時涵蓋兩者的憑證。一個分佈只能持有一張憑證，而租戶的憑證是它專屬的，因此下一個租戶要使用自己的分佈，如[新增租戶](./2-operating.md#新增租戶)所述。`distribution.json`：

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

- **ID**。`4135ea2d-…`是`Managed-CachingDisabled`，`33f36d7e-…`是`Managed-AllViewerAndCloudFrontHeaders-2022-06`，`216adef6-…`是`Managed-AllViewer`。`aws elbv2 describe-load-balancers --load-balancer-arns "$ALB" --query 'LoadBalancers[0].DNSName'`會印出負載平衡器的DNS名稱。
- **方法**。預設行為允許所有方法，因為頁面會提交表單，而API是以`POST`呼叫的；`/images`只回應讀取。
- **上傳逾時**。CloudFront對請求本文沒有任何在此有影響的限制，因此上傳與webhook都能原樣通過。`OriginReadTimeout`是CloudFront等待負載平衡器回應的時間，未設定時為30秒；120秒是不提高配額時可設定的上限，足以讓主控台在一整個章節的頁面抵達後將其儲存。
- **函式**與兩個行為都有關聯：未指定函式的行為會原封不動地轉送呼叫端的標頭。

分佈部署完成後，請把兩個主機名稱指向其網域名稱（例如`d111111abcdef8.cloudfront.net`）：為每個名稱建立`CNAME`記錄，若區域位於Route 53中，則建立別名記錄。

## 用戶端位址

Publira會記錄每個請求背後讀者的位址，並從邊緣寫入的`X-Forwarded-For`標頭讀取，如[用戶端位址](../4-edge/index.md#用戶端位址)所述。CloudFront會把讀者的位址放進該標頭，附加在呼叫端寫入的任何內容之後，負載平衡器再附加CloudFront連線時所用的位址。代替讀者呼叫API的Web應用程式，則會接著附加負載平衡器的位址。`publira server`會從右側逐一檢視這些位址，並跳過每一個它信任的位址，因此`PUBLIRA_TRUSTED_PROXIES`必須涵蓋讀者之後的每個轉送節點：

- **VPC的範圍**，負載平衡器與Web應用程式都從這裡連線。
- **CloudFront面向來源的範圍**，AWS以服務名稱`CLOUDFRONT_ORIGIN_FACING`公布，用於CloudFront存取負載平衡器時所用的位址。

```bash
TRUSTED_PROXIES="$VPC_CIDR,$(curl -s https://ip-ranges.amazonaws.com/ip-ranges.json \
  | jq -r '[.prefixes[] | select(.service == "CLOUDFRONT_ORIGIN_FACING") | .ip_prefix] | join(",")')"
echo "$TRUSTED_PROXIES"
```

`web-storefront`也會檢視相同的位址，以找出它要傳給租戶Google代碼閘道的讀者位址，因此它採用相同的值。請在[啟動服務](./index.md#6-啟動服務)的`publira-server.json`與`web-storefront.json`中，把`<see The client address>`換成這個值，重新註冊兩個任務定義，並以它們部署這兩個服務：

```bash
for family in publira-server web-storefront; do
  aws ecs register-task-definition --cli-input-json "file://$family.json" > /dev/null
  aws ecs update-service --cluster publira --service "$family" --task-definition "$family" > /dev/null
done
```

AWS會不時變更這些範圍，並在`AmazonIpSpaceChanged` SNS主題上公告每次變更。在您更新變數之前，經由新範圍抵達的請求會以CloudFront的位址而非讀者的位址被記錄：位於該範圍之後的所有讀者都會共用同一個位址，但沒有人能自行選擇它。請不要信任比這些更寬的範圍：若受信任的範圍涵蓋讀者，任何讀者都能指定自己想要的位址。

## 檢查邊緣

DNS記錄可以解析後，請從VPC外部檢查路由：

```bash
curl -sI https://comics.example.com/ | head -1
curl -s https://comics.example.com/readyz
curl -s -X POST -H 'Content-Type: application/json' -d '{}' \
  https://comics.example.com/rpc/publira.v1.TenantService/GetTenant
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{}' \
  https://comics.example.com/rpc/publira.admin.v1.AdminAuditLogService/ListAuditLogs
curl -sI http://comics.example.com/ | grep -i '^location'
```

第一個指令會由`web-storefront`回應`200`；第二個會回應其就緒狀態，在它能連線到`publira server`與Valkey後為`"status":"ok"`。第三個會抵達`publira server`，後者以`invalid_argument`拒絕這個空的請求。第四個呼叫租戶主控台的API，負載平衡器不會轉送它，而是回應`404`。最後一個會回應CloudFront重新導向至`https://comics.example.com/`。請在主控台主機上執行相同的檢查，在那裡主控台的API同樣會回應`404`：主控台是透過VPC呼叫它，而不是經由邊緣。

接著回到「在AWS Fargate上執行Amazon ECS」頁面的[登入](./index.md#9-登入)。
