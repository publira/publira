---
title: CloudFrontを使った公開
description: Amazon ECS(Fargate)で動かすPubliraの内部向けApplication Load Balancerの前にCloudFrontを置き、VPCの外から動作を確認します。
published: 2026-10-29
source_updated: 2026-10-22
---

このページは[Amazon ECS(Fargate)](./index.md)の手順8にあたり、それまでの手順と同じシェルで実行します。コマンドでは、それまでの手順で定義した`VPC`、`VPC_CIDR`、`ALB`、`allow`などの変数と関数を使います。

読者が接続する先はCloudFrontです。CloudFrontは、`us-east-1`の証明書ですべてのテナントのホストのTLSを終端し、HTTPでのアクセスをHTTPSにリダイレクトし、呼び出し元に指定させてはならないヘッダーを取り除いたうえで、それ以外をすべてロードバランサーに転送します。この構成は[リバースプロキシで必要な設定](../4-edge/index.md#リバースプロキシで必要な設定)の要件を満たすためのものです。

## VPCオリジン

ロードバランサーは内部向けなので、CloudFrontはVPCオリジンとして、HTTPSでロードバランサーに接続します。

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

VPCオリジンのステータスが`Deployed`になった時点で、CloudFrontはVPC内に`CloudFront-VPCOrigins-Service-SG`という名前のセキュリティグループを作成しています。ステータスは`aws cloudfront get-vpc-origin --id <the VPC origin ID> --query VpcOrigin.Status`で確認できます。ロードバランサーへの接続は、このセキュリティグループからだけ許可します。

```bash
CLOUDFRONT_SG=$(aws ec2 describe-security-groups \
  --filters Name=vpc-id,Values="$VPC" Name=group-name,Values=CloudFront-VPCOrigins-Service-SG \
  --query 'SecurityGroups[0].GroupId' --output text)
allow "$ALB_SG" 443 "$CLOUDFRONT_SG"
```

このセキュリティグループは、自分のアカウントのVPCオリジンだけが使うものです。ロードバランサーをインターネット向けにせず内部向けにしているのはそのためです。インターネット向けのロードバランサーでは、CloudFrontのマネージドプレフィックスリスト`com.amazonaws.global.cloudfront.origin-facing`からの接続を許可することになります。このリストに含まれるのは自分のディストリビューションの接続元だけではなく、すべてのCloudFrontディストリビューションの接続元です。そのため、第三者が自分のディストリビューションをそのロードバランサーに向けると、後述の関数を通らずにロードバランサーに到達し、好きな値の`Forwarded`と`X-Forwarded-Host`を送れてしまいます。

## ヘッダー

すべてのビューアーリクエストでCloudFront Functionを実行し、ほかの処理より先に、トレースコンテキストのヘッダー、`Forwarded`、`X-Forwarded-Host`、`X-Forwarded-CountryRegion`を取り除きます。そのうえで、`X-Forwarded-CountryRegion`に読者の地域を設定します。`strip-request-headers.js`を次の内容で作成します。

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

`traceparent`、`tracestate`、`baggage`は、[トレースコンテキスト](../4-edge/index.md#トレースコンテキスト)の要件に従って取り除きます。CloudFrontとロードバランサーは、呼び出し元が送った`Forwarded`と`X-Forwarded-Host`をそのまま転送し、Publiraはその両方を読みます。この点は[クライアントのアドレス](../4-edge/index.md#クライアントのアドレス)と[リクエストの送信先のホスト](../4-edge/index.md#リクエストの送信先のホスト)で説明しています。CloudFrontもロードバランサーもこの2つのヘッダーを自分では書き込みません。そのため、ここで取り除いておけば、Webアプリはブラウザーが送った`Host`を読むことになり、どのプロセスでも`PUBLIRA_FORWARDED_HEADER_ENABLED`を既定値のままにできます。

[読者の地域](../4-edge/index.md#読者の地域)で説明しているとおり、`X-Forwarded-CountryRegion`は読者の地域をテナントのGoogleタグゲートウェイに伝えるヘッダーです。CloudFrontは読者のアドレスから地域を調べ、`CloudFront-Viewer-Country`に国コードを、`CloudFront-Viewer-Country-Region`に第1レベルの行政区画のコードを設定します。行政区画のコードは、ISO 3166-2のコードのうち国コードの後に続く部分です。関数はこの2つをつなげて、`JP-13`のようなヘッダーの形式にします。関数がこの2つのヘッダーを受け取れるのは、ビヘイビアのオリジンリクエストポリシーがそれらを転送する場合だけです。後述の既定のビヘイビアで`Managed-AllViewerAndCloudFrontHeaders-2022-06`を使っているのはそのためです。CloudFrontがどの地域にも割り当てられなかったリクエストは、このヘッダーなしでロードバランサーに届きます。呼び出し元が送ったヘッダーも残りません。

## キャッシュポリシー

`/images`以外のパスは、ブラウザーが送ったヘッダー、Cookie、クエリ文字列をすべて付けたまま、キャッシュせずに転送します。使うのはマネージドキャッシュポリシーの`Managed-CachingDisabled`と、マネージドオリジンリクエストポリシーの`Managed-AllViewerAndCloudFrontHeaders-2022-06`です。後者は、ブラウザーが送ったヘッダーに加えて、読者の国や地域などCloudFront自身が書き込むヘッダーも転送します。ページの内容は読者のセッションCookieによって変わります。また、WebアプリはValkeyに独自のキャッシュを持ち、サーバーとワーカーからの再検証でそのキャッシュを最新に保っています。CloudFrontにコピーを置いても、そのコピーには再検証が届きません。このオリジンリクエストポリシーは、テナントを決める`Host`ヘッダーと、モバイルアプリがリクエストの署名に使う`Authorization`ヘッダーも転送します。

`/images`はキャッシュする価値があります。`publira server`は、読者がログインせずに見られる画像には最大1時間の`public`を付け、読者の認証情報が必要な画像には`private`を付けます。`private`の画像はCloudFrontに保存されません。`publira server`は画像の形式を`Accept`ヘッダーで、テナントをホストで決め、読者の認証情報を`Authorization`かクエリ文字列から受け取ります。そのため、これらはどれもキャッシュのキーに含める必要があります。

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

`MinTTL`を`0`にしているのは、`private`や`no-store`も含め、CloudFrontがすべての応答の`Cache-Control`に従うようにするためです。`DefaultTTL`を`0`にしているのは、`Cache-Control`のない応答を保存しないためです。

## ディストリビューション

1つのディストリビューションで1つのテナントを扱います。対象はテナントのドメインと管理画面のホスト名で、証明書には両方の名前を含めます。ディストリビューションに設定できる証明書は1つだけで、証明書はテナントごとに別なので、次のテナントには別のディストリビューションを作ります。その手順は[テナントの追加](./2-operating.md#テナントの追加)で説明しています。`distribution.json`を次の内容で作成します。

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

- **ID**。`4135ea2d-…`は`Managed-CachingDisabled`、`33f36d7e-…`は`Managed-AllViewerAndCloudFrontHeaders-2022-06`、`216adef6-…`は`Managed-AllViewer`のIDです。ロードバランサーのDNS名は`aws elbv2 describe-load-balancers --load-balancer-arns "$ALB" --query 'LoadBalancers[0].DNSName'`で表示できます。
- **メソッド**。ページはフォームを送信し、APIは`POST`で呼び出されるので、既定のビヘイビアではすべてのメソッドを許可します。`/images`は読み取りにだけ応答します。
- **アップロードのタイムアウト**。CloudFrontには、ここで問題になるようなボディのサイズ制限はないので、アップロードやWebhookはそのまま通ります。`OriginReadTimeout`は、CloudFrontがロードバランサーの応答を待つ時間で、指定しなければ30秒です。120秒はクォータを引き上げずに設定できる上限です。この長さがあれば、エピソード全体のページが届いた後に、管理画面がそれらを保存する時間を確保できます。
- **関数**は両方のビヘイビアに関連付けます。関数を指定しないビヘイビアでは、呼び出し元が送ったヘッダーがそのまま転送されます。

ディストリビューションのデプロイが終わったら、両方のホスト名を`d111111abcdef8.cloudfront.net`のようなディストリビューションのドメイン名に向けます。それぞれに`CNAME`レコードを作成するか、ゾーンがRoute 53にある場合はエイリアスレコードを作成します。

## クライアントのアドレス

Publiraは、リクエストごとにその送り主である読者のアドレスを記録します。[クライアントのアドレス](../4-edge/index.md#クライアントのアドレス)で説明しているとおり、アドレスはCloudFrontとロードバランサーが書き込む`X-Forwarded-For`ヘッダーから読みます。CloudFrontは、呼び出し元が書いた値の後ろに読者のアドレスを追加します。ロードバランサーは、CloudFrontが接続してきたアドレスを追加します。Webアプリが読者に代わってAPIを呼び出すときは、さらにロードバランサーのアドレスが追加されます。`publira server`はこれらのアドレスを右から順にたどり、信頼するアドレスを飛ばしていきます。そのため、`PUBLIRA_TRUSTED_PROXIES`には、読者より後に経由するすべてのアドレスを含める必要があります。

- **VPCのアドレス範囲**。ロードバランサーとWebアプリはこの範囲から接続します。
- **CloudFrontのオリジン向けのアドレス範囲**。AWSが`CLOUDFRONT_ORIGIN_FACING`というサービス名で公開している範囲で、CloudFrontはここからロードバランサーに接続します。

```bash
TRUSTED_PROXIES="$VPC_CIDR,$(curl -s https://ip-ranges.amazonaws.com/ip-ranges.json \
  | jq -r '[.prefixes[] | select(.service == "CLOUDFRONT_ORIGIN_FACING") | .ip_prefix] | join(",")')"
echo "$TRUSTED_PROXIES"
```

`web-storefront`も同じアドレスをたどって、テナントのGoogleタグゲートウェイに渡す読者のアドレスを求めるので、同じ値を使います。[サービスの起動](./index.md#6-サービスを起動する)の`publira-server.json`と`web-storefront.json`で、`<see The client address>`をこの値に置き換えてください。そのうえで両方のタスク定義を登録し直し、新しいタスク定義で両方のサービスをデプロイします。

```bash
for family in publira-server web-storefront; do
  aws ecs register-task-definition --cli-input-json "file://$family.json" > /dev/null
  aws ecs update-service --cluster publira --service "$family" --task-definition "$family" > /dev/null
done
```

AWSはこれらの範囲をときどき変更し、変更のたびに`AmazonIpSpaceChanged`のSNSトピックで通知します。変数を更新するまでは、新しい範囲を通って届いたリクエストは、読者ではなくCloudFrontのアドレスで記録されます。その範囲を経由する読者はみな同じアドレスになりますが、どの読者もそのアドレスを自分で選ぶことはできません。信頼する範囲をこれより広げてはいけません。読者が接続してくる範囲まで信頼すると、どの読者も好きなアドレスを名乗れるようになります。

## VPCの外からの確認

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

1つ目のコマンドには`web-storefront`が`200`を返します。2つ目にはレディネスが返り、`publira server`とValkeyに接続できていれば`"status":"ok"`になります。3つ目は`publira server`に届き、空のリクエストが`invalid_argument`で拒否されます。4つ目はテナント管理画面のAPIを呼び出しますが、ロードバランサーはこれを転送せずに`404`を返します。最後のコマンドには、CloudFrontが`https://comics.example.com/`へのリダイレクトを返します。管理画面のホスト名でも同じことを確認してください。管理画面はAPIをCloudFrontを通さずVPC内で呼び出すので、管理画面のホスト名でも管理画面のAPIには`404`が返ります。

確認が済んだら、[Amazon ECS(Fargate)のログインの手順](./index.md#9-ログインする)に戻ってください。
