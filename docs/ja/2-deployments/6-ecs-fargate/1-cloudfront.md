---
title: ECSの前に置くCloudFront
description: Fargate上のAmazon ECSで動くインストール環境の内部向けApplication Load Balancerの前にCloudFrontを置き、VPCの外から確認します。
published: 2026-10-29
source_updated: 2026-10-22
---

このページは[Fargate上のAmazon ECS](./index.md)の手順8で、それより前の手順と同じシェルで実行します。コマンドでは、それらの手順で定義した`VPC`、`VPC_CIDR`、`ALB`、`allow`などの変数と関数を使います。

CloudFrontは、読者が接続するエッジです。[エッジが行うこと](../4-edge/index.md#エッジが行うべきこと)が求めるとおり、`us-east-1`の証明書ですべてのテナントのホストのTLSを終端し、平文のHTTPをHTTPSにリダイレクトし、呼び出し元に選ばせてはならないヘッダーを取り除き、それ以外のすべてをロードバランサーに転送します。

## VPCオリジン

ロードバランサーは内部向けなので、CloudFrontはVPCオリジンとして、HTTPSでこれに到達します。

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

ステータスが`Deployed`になると（`aws cloudfront get-vpc-origin --id <the VPC origin ID> --query VpcOrigin.Status`で確認できます）、CloudFrontはVPC内に`CloudFront-VPCOrigins-Service-SG`という名前のセキュリティグループを作成しています。このグループだけがロードバランサーに到達できるようにします。

```bash
CLOUDFRONT_SG=$(aws ec2 describe-security-groups \
  --filters Name=vpc-id,Values="$VPC" Name=group-name,Values=CloudFront-VPCOrigins-Service-SG \
  --query 'SecurityGroups[0].GroupId' --output text)
allow "$ALB_SG" 443 "$CLOUDFRONT_SG"
```

このグループは自分のアカウントのVPCオリジンに属するものです。ロードバランサーをインターネット向けではなく内部向けにしているのはそのためです。インターネット向けのロードバランサーでは、CloudFrontのマネージドプレフィックスリスト`com.amazonaws.global.cloudfront.origin-facing`を許可することになります。これは自分のディストリビューションだけでなく、すべてのCloudFrontディストリビューションの接続元です。そのため、自分のディストリビューションをそのロードバランサーに向けた呼び出し元は、下の関数を経由せずに、好きな`Forwarded`と`X-Forwarded-Host`を付けてロードバランサーに到達できてしまいます。

## ヘッダー

すべてのビューワーリクエストに対して動くCloudFront Functionが、他の何よりも先に、トレースコンテキストのヘッダー、`Forwarded`、`X-Forwarded-Host`、`X-Forwarded-CountryRegion`を取り除き、最後のヘッダーには読者の地域を設定します。`strip-request-headers.js`：

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

`traceparent`、`tracestate`、`baggage`は、[トレースコンテキスト](../4-edge/index.md#トレースコンテキスト)が求めるとおりに取り除きます。CloudFrontとロードバランサーは、呼び出し元が送った`Forwarded`と`X-Forwarded-Host`をそのまま渡し、Publiraは、[クライアントのアドレス](../4-edge/index.md#クライアントのアドレス)と[リクエストの送り先のホスト](../4-edge/index.md#リクエストの送信先のホスト)で説明しているとおり、その両方を読みます。CloudFrontもロードバランサーもこの2つのヘッダーを自分では書き込まないため、ここで取り除いておけば、Webアプリはブラウザーが送った`Host`を読み、どのプロセスでも`PUBLIRA_FORWARDED_HEADER_ENABLED`をデフォルトのままにできます。

`X-Forwarded-CountryRegion`は、[読者の地域](../4-edge/index.md#読者の地域)で説明しているとおり、読者の地域をテナントのGoogleタグゲートウェイに伝えます。CloudFrontは読者のアドレスから地域を調べ、国コードを`CloudFront-Viewer-Country`に、読者のいる第1階層の地方区分のコード（ISO 3166-2のコードで国の後に続く部分）を`CloudFront-Viewer-Country-Region`に入れます。関数はこの2つを、`JP-13`のような、このヘッダーの形式につなげます。関数がこの2つのヘッダーを見られるのは、ビヘイビアのオリジンリクエストポリシーがそれらを転送する場合だけです。下のデフォルトのビヘイビアで`Managed-AllViewerAndCloudFrontHeaders-2022-06`を使うのはそのためです。CloudFrontがどの地域にも割り当てないリクエストは、呼び出し元が送ったものも含めて、このヘッダーを持たずにロードバランサーに届きます。

## キャッシュポリシー

`/images`以外のすべてのパスは、ブラウザーが送ったすべてのヘッダー、Cookie、クエリ文字列とともに、キャッシュせずに転送します。マネージドキャッシュポリシー`Managed-CachingDisabled`と、マネージドオリジンリクエストポリシー`Managed-AllViewerAndCloudFrontHeaders-2022-06`を使います。後者は、ブラウザーが送ったヘッダーに、読者の国や地域など、CloudFront自身が書き込むヘッダーを加えます。ページは読者のセッションCookieによって変わり、WebアプリはValkeyに独自のキャッシュを持っていて、サーバーとワーカーからの再検証がそれを最新に保ちます。CloudFrontにコピーを置くと、そのコピーには再検証が届きません。このポリシーは、テナントを決める`Host`ヘッダーと、モバイルアプリがリクエストの署名に使う`Authorization`ヘッダーを転送します。

`/images`はキャッシュする価値があります。`publira server`は、読者がログインせずに見られる画像を最大1時間の`public`とし、読者の認証情報が必要な画像を、CloudFrontが保存しない`private`とします。サーバーは形式を`Accept`ヘッダーから、テナントをホストから選び、読者の認証情報を`Authorization`またはクエリ文字列から受け取ります。そのため、それぞれをキャッシュされたコピーを探すためのキーに含めます。

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

`MinTTL`を`0`にしているのは、CloudFrontが`private`や`no-store`を含め、すべての応答の`Cache-Control`に従うようにするためです。`DefaultTTL`を`0`にしているのは、このヘッダーのない応答を保存しないためです。

## ディストリビューション

1つのディストリビューションで1つのテナントを提供します。そのドメインと管理画面のホストを、両方を指定した証明書で提供します。ディストリビューションが持てる証明書は1つで、テナントの証明書はそのテナント専用なので、[テナントの追加](./2-operating.md#テナントの追加)で説明しているとおり、次のテナントには専用のディストリビューションを用意します。`distribution.json`：

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

- **ID。** `4135ea2d-…`は`Managed-CachingDisabled`、`33f36d7e-…`は`Managed-AllViewerAndCloudFrontHeaders-2022-06`、`216adef6-…`は`Managed-AllViewer`です。ロードバランサーのDNS名は`aws elbv2 describe-load-balancers --load-balancer-arns "$ALB" --query 'LoadBalancers[0].DNSName'`で出力できます。
- **メソッド。** ページはフォームを送信し、APIは`POST`で呼び出されるため、デフォルトのビヘイビアはすべてのメソッドを受け付けます。`/images`は読み取りにだけ応答します。
- **アップロードのタイムアウト。** CloudFrontには、ここで問題になるボディの上限がないため、アップロードやWebhookはそのまま通ります。`OriginReadTimeout`は、CloudFrontがロードバランサーの応答を待つ時間で、設定しなければ30秒です。120はクォータを引き上げずに設定できる最大値で、エピソード全体のページが届いた後、管理画面がそれを保存する時間を確保できます。
- **関数**は両方のビヘイビアに関連付けます。関数を指定しないビヘイビアは、呼び出し元のヘッダーをそのまま転送してしまいます。

ディストリビューションのデプロイが終わったら、両方のホスト名を、`d111111abcdef8.cloudfront.net`のようなそのドメイン名に向けます。それぞれに`CNAME`レコードを作成するか、ゾーンがRoute 53にある場合はエイリアスレコードを作成します。

## クライアントのアドレス

Publiraはすべてのリクエストについて、その背後にいる読者のアドレスを記録します。[クライアントのアドレス](../4-edge/index.md#クライアントのアドレス)で説明しているとおり、アドレスはエッジが書き込む`X-Forwarded-For`ヘッダーから読みます。CloudFrontは、呼び出し元が書いた内容の後ろに読者のアドレスを追加し、ロードバランサーは、CloudFrontの接続元のアドレスを追加します。読者のためにAPIを呼び出すWebアプリは、さらにロードバランサーのアドレスを追加します。`publira server`はこれらのアドレスを右からたどり、信頼するアドレスを1つずつ飛ばしていくため、`PUBLIRA_TRUSTED_PROXIES`は読者より後のすべての中継点を含んでいなければなりません。

- **VPCのアドレス範囲**。ロードバランサーとWebアプリの接続元です。
- **CloudFrontのオリジン向けアドレス範囲**。AWSが`CLOUDFRONT_ORIGIN_FACING`というサービス名で公開しているもので、CloudFrontがロードバランサーに到達するときの接続元アドレスです。

```bash
TRUSTED_PROXIES="$VPC_CIDR,$(curl -s https://ip-ranges.amazonaws.com/ip-ranges.json \
  | jq -r '[.prefixes[] | select(.service == "CLOUDFRONT_ORIGIN_FACING") | .ip_prefix] | join(",")')"
echo "$TRUSTED_PROXIES"
```

`web-storefront`も、テナントのGoogleタグゲートウェイに渡す読者のアドレスを求めるために同じアドレスをたどるため、同じ値を受け取ります。[サービスを起動する](./index.md#6-サービスを起動する)の`publira-server.json`と`web-storefront.json`の`<see The client address>`をこの値に書き換え、両方のタスク定義を登録し直して、両方のサービスをそれでデプロイします。

```bash
for family in publira-server web-storefront; do
  aws ecs register-task-definition --cli-input-json "file://$family.json" > /dev/null
  aws ecs update-service --cluster publira --service "$family" --task-definition "$family" > /dev/null
done
```

AWSはこれらのアドレス範囲を時折変更し、変更のたびに`AmazonIpSpaceChanged`のSNSトピックで告知します。変数を更新するまで、新しい範囲を経由して届いたリクエストは、読者のアドレスではなくCloudFrontのアドレスで記録されます。その範囲の背後にいる読者は全員同じアドレスになりますが、誰もそのアドレスを選ぶことはできません。これらより広い範囲は信頼しないでください。読者が接続できる範囲を信頼すると、どの読者も好きなアドレスを名乗れるようになります。

## エッジを確認する

DNSレコードが応答するようになったら、VPCの外からルーティングを確認します。

```bash
curl -sI https://comics.example.com/ | head -1
curl -s https://comics.example.com/readyz
curl -s -X POST -H 'Content-Type: application/json' -d '{}' \
  https://comics.example.com/rpc/publira.v1.TenantService/GetTenant
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{}' \
  https://comics.example.com/rpc/publira.admin.v1.AdminAuditLogService/ListAuditLogs
curl -sI http://comics.example.com/ | grep -i '^location'
```

1つ目は`web-storefront`から`200`を返し、2つ目はそのレディネスを返します。`publira server`とValkeyに到達できていれば`"status":"ok"`です。3つ目は`publira server`に届き、サーバーは空のリクエストを`invalid_argument`で拒否します。4つ目はテナント管理画面のAPIを呼び出し、ロードバランサーはそれを転送せずに`404`で応答します。最後のものは、`https://comics.example.com/`へのCloudFrontのリダイレクトを返します。管理画面のホストでも同じことを実行してください。そこでも管理画面のAPIは`404`を返します。管理画面はこのAPIをエッジ経由ではなく、VPC経由で呼び出すためです。

その後、Fargate上のAmazon ECSのページの[ログインする](./index.md#9-ログインする)に戻ってください。
