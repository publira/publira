---
title: CloudFrontを使った公開
description: Amazon ECS(Fargate)で動かすPubliraの内部向けApplication Load Balancerの前にCloudFrontを置き、VPCの外から動作を確かめます。
published: 2026-10-29
updated: 2026-10-31
source_updated: 2026-10-22
---

このページは[Amazon ECS(Fargate)](./index.md)の手順8です。それまでの手順と同じシェルで実行し、そこで定義した`VPC`、`VPC_CIDR`、`ALB`などの変数や、`allow`などの関数を使います。

読者が接続する先はCloudFrontです。CloudFrontは`us-east-1`の証明書ですべてのテナントのホストのTLSを終端し、HTTPのリクエストをHTTPSにリダイレクトします。さらに、呼び出し元に値を決めさせてはいけないヘッダーを取り除き、残りはすべてロードバランサーに転送します。これが[リバースプロキシで必要な設定](../4-edge/index.md#リバースプロキシで必要な設定)の求めることです。

## VPCオリジン

ロードバランサーは内部向けなので、CloudFrontはVPCオリジンとしてHTTPSでロードバランサーに接続します。

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

VPCオリジンのステータスが`Deployed`になると、CloudFrontがVPC内に`CloudFront-VPCOrigins-Service-SG`という名前のセキュリティグループを作っています。ステータスは`aws cloudfront get-vpc-origin --id <the VPC origin ID> --query VpcOrigin.Status`で確かめられます。ロードバランサーへの接続は、このセキュリティグループからのものだけを許可します。

```bash
CLOUDFRONT_SG=$(aws ec2 describe-security-groups \
  --filters Name=vpc-id,Values="$VPC" Name=group-name,Values=CloudFront-VPCOrigins-Service-SG \
  --query 'SecurityGroups[0].GroupId' --output text)
allow "$ALB_SG" 443 "$CLOUDFRONT_SG"
```

このセキュリティグループは自分のアカウントのVPCオリジンのためのもので、ロードバランサーをインターネット向けにせず内部向けにしているのはこのためです。インターネット向けのロードバランサーでは、CloudFrontのマネージドプレフィックスリスト`com.amazonaws.global.cloudfront.origin-facing`からの接続を許可することになります。ところが、このリストは自分のディストリビューションだけでなく、すべてのCloudFrontディストリビューションの接続元を含みます。第三者が自分のディストリビューションをそのロードバランサーに向ければ、次に説明する関数を通らずにロードバランサーまで届き、`Forwarded`と`X-Forwarded-Host`に好きな値を入れて送れてしまいます。

## ヘッダー

すべてのビューアーリクエストでCloudFront Functionを実行し、ほかの何よりも先にトレースコンテキストのヘッダー、`Forwarded`、`X-Forwarded-Host`、`X-Forwarded-CountryRegion`を取り除きます。そのうえで、最後の`X-Forwarded-CountryRegion`には読者の地域を設定します。次の内容で`strip-request-headers.js`を作ります。

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

`traceparent`、`tracestate`、`baggage`を取り除くのは、[トレースコンテキスト](../4-edge/index.md#トレースコンテキスト)の要件です。CloudFrontもロードバランサーも、呼び出し元が送った`Forwarded`と`X-Forwarded-Host`をそのまま転送し、Publiraはそのどちらも読みます。詳しくは[クライアントのアドレス](../4-edge/index.md#クライアントのアドレス)と[リクエストの送信先のホスト](../4-edge/index.md#リクエストの送信先のホスト)で説明しています。CloudFrontもロードバランサーもこの2つのヘッダーを自分では書かないので、ここで取り除けば、Webアプリはブラウザーが送った`Host`を読みます。どのプロセスでも`PUBLIRA_FORWARDED_HEADER_ENABLED`は既定値のままで構いません。

`X-Forwarded-CountryRegion`は、[読者の地域](../4-edge/index.md#読者の地域)で説明しているとおり、読者の地域をテナントのGoogleタグゲートウェイに伝えるヘッダーです。CloudFrontは読者のアドレスから地域を調べ、`CloudFront-Viewer-Country`に国コードを、`CloudFront-Viewer-Country-Region`に第1レベルの行政区画のコードを入れます。行政区画のコードは、ISO 3166-2のコードで国コードに続く部分です。関数はこの2つをつないで、`JP-13`のようなヘッダーの形式にします。関数がこの2つのヘッダーを受け取れるのは、ビヘイビアのオリジンリクエストポリシーがそれらを転送する場合だけです。後述の既定のビヘイビアで`Managed-AllViewerAndCloudFrontHeaders-2022-06`を使っているのはそのためです。CloudFrontがどの地域にも当てはめられなかったリクエストは、このヘッダーを持たずにロードバランサーに届きます。呼び出し元が自分で付けたヘッダーも残りません。

## キャッシュポリシー

`/images`以外のパスは、キャッシュせずに、ブラウザーが送ったヘッダー、Cookie、クエリ文字列をすべて付けたまま転送します。使うのは、マネージドキャッシュポリシーの`Managed-CachingDisabled`と、マネージドオリジンリクエストポリシーの`Managed-AllViewerAndCloudFrontHeaders-2022-06`です。後者は、ブラウザーが送ったヘッダーに加えて、読者の国や地域などCloudFrontが自分で書くヘッダーも転送します。ページの内容は読者のセッションCookieで変わります。また、WebアプリはValkeyに独自のキャッシュを持ち、サーバーとワーカーからの再検証でそれを最新に保っています。CloudFrontにコピーを置いても、そのコピーには再検証が届きません。このポリシーは、テナントを決める`Host`ヘッダーと、モバイルアプリがリクエストの署名に使う`Authorization`ヘッダーも転送します。

`/images`はキャッシュする意味があります。`publira server`は、読者がログインせずに見られる画像を最大1時間の`public`とし、読者の認証情報が必要な画像を`private`とします。CloudFrontは`private`の画像を保存しません。`publira server`は画像の形式を`Accept`ヘッダーから、テナントをホストから決め、読者の認証情報を`Authorization`かクエリ文字列から受け取ります。そのため、これらはすべてキャッシュのキーに含めます。

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

`MinTTL`を`0`にするのは、`private`や`no-store`を含め、CloudFrontがすべての応答の`Cache-Control`に従うようにするためです。`DefaultTTL`を`0`にするのは、`Cache-Control`のない応答を保存しないためです。

## ディストリビューション

1つのディストリビューションが受け持つテナントは1つです。そのテナントのドメインと管理画面のホストを受け持ち、両方の名前を含む証明書を使います。ディストリビューションに設定できる証明書は1つで、証明書はテナントごとに別なので、次のテナントには別のディストリビューションを作ります。手順は[テナントの追加](./2-operating.md#テナントの追加)で説明しています。次の内容で`distribution.json`を作ります。

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

設定にある`4135ea2d-…`は`Managed-CachingDisabled`、`33f36d7e-…`は`Managed-AllViewerAndCloudFrontHeaders-2022-06`、`216adef6-…`は`Managed-AllViewer`のIDです。ロードバランサーのDNS名は`aws elbv2 describe-load-balancers --load-balancer-arns "$ALB" --query 'LoadBalancers[0].DNSName'`で表示できます。

ページはフォームを送信し、APIは`POST`で呼び出すので、既定のビヘイビアではすべてのメソッドを許可します。`/images`が応答するのは読み取りだけです。

CloudFrontには、ここで問題になるようなボディのサイズの上限がないので、アップロードやWebhookはそのまま通ります。`OriginReadTimeout`はCloudFrontがロードバランサーの応答を待つ時間で、指定しなければ30秒です。120秒は、クォータを引き上げずに設定できる最大の値です。これだけあれば、エピソードのページがすべて届いたあと、管理画面がそれを保存し終えるまでの時間を確保できます。

関数は両方のビヘイビアに関連付けます。関数を指定していないビヘイビアは、呼び出し元が送ったヘッダーを何も変えずに転送してしまいます。

ディストリビューションのデプロイが終わったら、両方のホスト名を、`d111111abcdef8.cloudfront.net`のようなディストリビューションのドメイン名に向けます。ホスト名ごとに`CNAME`レコードを作るか、ゾーンがRoute 53にあればエイリアスレコードを作ります。

## クライアントのアドレス

Publiraはリクエストごとに、その向こうにいる読者のアドレスを記録します。[クライアントのアドレス](../4-edge/index.md#クライアントのアドレス)で説明しているとおり、アドレスはリバースプロキシが書く`X-Forwarded-For`ヘッダーから読みます。CloudFrontは、呼び出し元が書いた値の後ろに読者のアドレスを追加し、ロードバランサーはCloudFrontの接続元のアドレスを追加します。Webアプリが読者に代わってAPIを呼び出すときは、さらにロードバランサーのアドレスが加わります。`publira server`はこれらのアドレスを右からたどり、信頼するアドレスを飛ばしていきます。そのため、`PUBLIRA_TRUSTED_PROXIES`には、読者のあとに経由するすべての中継のアドレスを含める必要があります。

- ロードバランサーとWebアプリの接続元になる、VPCのアドレス範囲
- CloudFrontがロードバランサーに接続するときの、オリジン向けのアドレス範囲。AWSは`CLOUDFRONT_ORIGIN_FACING`というサービス名で公開しています

```bash
TRUSTED_PROXIES="$VPC_CIDR,$(curl -s https://ip-ranges.amazonaws.com/ip-ranges.json \
  | jq -r '[.prefixes[] | select(.service == "CLOUDFRONT_ORIGIN_FACING") | .ip_prefix] | join(",")')"
echo "$TRUSTED_PROXIES"
```

`web-storefront`も同じアドレスをたどって、テナントのGoogleタグゲートウェイに渡す読者のアドレスを求めるので、同じ値を設定します。[サービスを起動する](./index.md#6-サービスを起動する)の`publira-server.json`と`web-storefront.json`にある`<see The client address>`をこの値に置き換えてください。そのうえで両方のタスク定義を登録し直し、両方のサービスにデプロイします。

```bash
for family in publira-server web-storefront; do
  aws ecs register-task-definition --cli-input-json "file://$family.json" > /dev/null
  aws ecs update-service --cluster publira --service "$family" --task-definition "$family" > /dev/null
done
```

AWSはこれらの範囲をときどき変え、そのたびに`AmazonIpSpaceChanged`のSNSトピックで知らせます。変数を更新するまで、新しい範囲を通って届いたリクエストは、読者ではなくCloudFrontのアドレスで記録されます。その範囲を通る読者は全員が同じアドレスになりますが、読者がそのアドレスを選べるわけではありません。信頼する範囲をこれより広げないでください。読者が接続してくる範囲まで信頼すると、どの読者も好きなアドレスを名乗れるようになります。

## VPCの外からの確認

DNSレコードが応答するようになったら、VPCの外からルーティングを確かめます。

```bash
curl -sI https://comics.example.com/ | head -1
curl -s https://comics.example.com/readyz
curl -s -X POST -H 'Content-Type: application/json' -d '{}' \
  https://comics.example.com/rpc/publira.v1.TenantService/GetTenant
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{}' \
  https://comics.example.com/rpc/publira.admin.v1.AdminAuditLogService/ListAuditLogs
curl -sI http://comics.example.com/ | grep -i '^location'
```

1つ目には`web-storefront`が`200`を返します。2つ目にはレディネスが返り、`publira server`とValkeyに接続できていれば`"status":"ok"`です。3つ目は`publira server`に届き、空のリクエストが`invalid_argument`で拒否されます。4つ目はテナント管理画面のAPIを呼び出しますが、ロードバランサーは転送せずに`404`を返します。最後には、CloudFrontが`https://comics.example.com/`へのリダイレクトを返します。管理画面のホストでも同じことを確かめてください。管理画面のホストでも、管理画面のAPIには`404`が返ります。管理画面はこのAPIをリバースプロキシを通さず、VPC内で呼び出すからです。

確かめ終わったら、Amazon ECS(Fargate)のページの[ログインする](./index.md#9-ログインする)に戻ってください。
