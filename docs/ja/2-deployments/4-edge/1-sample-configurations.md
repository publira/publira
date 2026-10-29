---
title: サンプル設定
description: エッジが果たすべきことを満たす、リポジトリ内のTraefik・nginx・Caddyのサンプル設定と、それをインストール環境に合わせる方法。
published: 2026-10-29
source_updated: 2026-10-25
---

リポジトリには、[エッジが果たすべきこと](./index.md#エッジが行うべきこと)の要件どおりにリクエストをルーティングし、ヘッダー、ボディ、タイムアウトを扱うリバースプロキシのサンプル設定が3つ同梱されています。Traefik、nginx、Caddyに1つずつです。ただし1つの要件は、サンプルを動かすインストール環境の側に残ります。TLSリスナーです。TraefikとnginxのサンプルではTLSリスナーを自分で追加する必要があり、Caddyのサンプルでは、HTTPSで提供するホスト名を渡すとCaddyがTLSリスナーを追加します。これらはあくまで例であり、エッジの定義ではありません。[Docker Compose](../3-docker-compose.md)のインストール環境はCaddyのサンプルを動かします。独自のプロキシを動かすインストール環境は、どのサンプルから始めてもかまいません。マネージドのロードバランサー、Ingress、Gatewayで構成するエッジはこれらの要件に従えばよく、サンプルはどれも必要ありません。そのようなGatewayとIngressの例は[Kubernetesでのエッジ](../5-kubernetes/1-edge.md)に、Application Load Balancerの前に置くCloudFrontの例は[ECSの前に置くCloudFront](../6-ecs-fargate/1-cloudfront.md)にあります。

| プロキシ | ファイル | バックエンドのアドレスを書く場所 | 証明書を自分で取得するか |
| --- | --- | --- | --- |
| Traefik | [`infra/proxy/traefik/`](https://github.com/publira/publira/tree/main/infra/proxy/traefik) | `dynamic/services.yaml` | はい。追加したACMEリゾルバーで取得します |
| nginx | [`infra/proxy/nginx/`](https://github.com/publira/publira/tree/main/infra/proxy/nginx) | `upstreams.conf` | いいえ |
| Caddy | [`infra/proxy/caddy/Caddyfile`](https://github.com/publira/publira/blob/main/infra/proxy/caddy/Caddyfile) | 環境変数`PUBLIRA_UPSTREAM_*` | はい。`PUBLIRA_EDGE_TLS_HOSTS`のホスト名について取得します |

動かすプロキシのファイルは、インストールするリリースのものを使ってください。3つのサンプルに共通する内容は、[ルーティングの契約](https://github.com/publira/publira/blob/main/infra/proxy/README.md)にルールごとに書かれています。

## 各サンプルが行うこと

- **ルーティング。** 各サンプルは、[ホストのリスト](#ホストのリスト)のとおりに渡される4つのリストのホスト名をルーティングし、そのすべてに[ルーティング](./index.md#ルーティング)のパスのルールを適用します。`/rpc`のそれ以外のパスには、サンプル自身が404を返します。テナントの画像ホストでは、[テナントの画像ホスト](./index.md#テナントの画像ホスト)が任せているとおり`/images`だけを転送し、それ以外のパスにはすべてサンプル自身が404を返します。どのリストにもないホストはどこにも届かず、サンプルがすべてのパスで404を返します。これはサンプルの選択であり、Publiraが求めることではありません。
- **クライアントのアドレス。** Traefikは`X-Forwarded-For`を設定し、`strip-forwarded`ミドルウェアで`Forwarded`を取り除きます。nginxとCaddyは`Forwarded`をクライアントのアドレスだけに設定し、`X-Forwarded-For`を取り除きます。どのサンプルの後ろでも、`PUBLIRA_FORWARDED_HEADER_ENABLED`は有効のままにしてください。
- **ホスト。** どのサンプルも`Host`を変更せずに渡し、`X-Forwarded-Host`と`X-Forwarded-Proto`は呼び出し元のものを渡すのではなく自分で設定します。ただし、信頼する[プロキシの前にあるホップ](#プロキシの前にあるホップ)からのリクエストは例外です。
- **トレースコンテキスト。** どのサンプルも3つのヘッダーを取り除きます。Traefikでは`strip-trace-context`ミドルウェアで取り除くため、すべてのエントリーポイントに`strip-forwarded`と並べてこのミドルウェアが必要です。
- **読者の地域。** どのサンプルも自分では地域を調べないため、各サンプルはすべてのリクエストから`X-Forwarded-CountryRegion`を取り除きます。ただし、信頼する[プロキシの前にあるホップ](#プロキシの前にあるホップ)からのリクエストは例外で、その値を渡します。Traefikでは`web-storefront-trusted-hop`以外のすべてのルーターにある`strip-country-region`ミドルウェアで取り除くため、追加するルーターにもこのミドルウェアが必要です。
- **アップロードとWebhook。** TraefikとCaddyは、自分で追加しない限りボディのサイズに制限を設けません。nginxは既定で1MBを超えるものを拒否するため、サンプルではその上限を、管理画面のホストの`/api/v1/episode-pages`で`256m`に、それ以外の`/api/v1/`配下で`33m`に、ページのパスで`11m`に引き上げています。Traefikは、指定しない限り60秒以内に全体が届かないリクエストを打ち切ります。この設定はパスごとではなくエントリーポイントごとであるため、サンプルでは`transport.respondingTimeouts.readTimeout`で、`web`エントリーポイントのすべてのリクエストに300秒を与えています。nginxが最大60秒待つのはボディ全体ではなくボディの2回の読み取りの間であり、Caddyは時間をまったく制限しないため、どちらのサンプルもこれを変更していません。
- **TLS。** どのサンプルも、TLSリスナーを与えるまで（Caddyの場合はHTTPSで提供するホスト名を与えるまで）、平文のHTTPで待ち受けます。その方法は[サンプルでTLSを終端する](#サンプルでtlsを終端する)で説明します。

サンプルを手直しするときは、これらをそれぞれ維持し、追加するエントリーポイントや`server`ブロックにも同じヘッダー、制限、タイムアウトを与えてください。

## バックエンドのアドレス

各サンプルはバックエンドのアドレスをルーティングとは別に持っています。コミットされているアドレスは開発用コンテナを指しているため、最初に置き換えるのがこのアドレスです。

| バックエンド | アドレス |
| --- | --- |
| `web-storefront` | `web-storefront`の、待ち受けているポート |
| `web-admin` | `web-admin`の、待ち受けているポート |
| `web-platform` | `web-platform`の、待ち受けているポート（動かす場合） |
| `api` | `publira server`の、ポート`8000`（`PUBLIRA_PUBLIC_API_ADDR`で別のポートを設定しない場合） |

## ホストのリスト

ホスト名はプロキシの環境から取得するため、そのためにルーティングのファイルを編集する必要はありません。各変数には、ポートを付けないホスト名をスペース区切りで書きます。1つのホストはいずれか1つの変数に属します。

| 変数 | 内容 | プロセス |
| --- | --- | --- |
| `PUBLIRA_EDGE_SITE_HOSTS` | 各テナントのドメイン | `web-storefront` |
| `PUBLIRA_EDGE_ADMIN_HOSTS` | 各テナントの管理画面のホスト | `web-admin` |
| `PUBLIRA_EDGE_PLATFORM_HOSTS` | プラットフォーム管理画面のホスト | `web-platform` |
| `PUBLIRA_EDGE_IMAGE_HOSTS` | 各テナントの画像ホスト | `publira server`（`/images`のみ） |

```text
PUBLIRA_EDGE_SITE_HOSTS=comics.example.com manga.example.org
PUBLIRA_EDGE_ADMIN_HOSTS=admin.comics.example.com studio.manga.example.org
PUBLIRA_EDGE_PLATFORM_HOSTS=platform.example.com
PUBLIRA_EDGE_IMAGE_HOSTS=images.comics.example.com
```

各サンプルは、それぞれのやり方でこれらを読み込みます。

- **Traefik**は`dynamic/routes.yaml`をテンプレートとして展開するため、変数はTraefikプロセスの環境に置きます。
- **nginx**は公式のnginxイメージを通じて受け取ります。このイメージは、コンテナの起動時に変数を`default.conf.template`に埋め込みます。`nginx`ディレクトリは`/etc/nginx/conf.d`ではなく`/etc/nginx/templates`にマウントしてください。イメージが結果を自身の`conf.d/default.conf`に上書きするためです。このイメージを使わない場合は、ファイルの最初のコメントにあるとおり、`envsubst`で自分でファイルを展開してください。
- **Caddy**は、Caddyfileを読み込むときに変数を埋め込みます。

プラットフォーム管理画面を動かさないインストール環境では、`PUBLIRA_EDGE_PLATFORM_HOSTS`を空にし、バックエンドのアドレスから`web-platform`のアドレスを省いてかまいません。`PUBLIRA_EDGE_IMAGE_HOSTS`は、画像ホストを持つテナントがない間と、画像ホストがこのプロキシではなく専用のロードバランサーを通じて`publira server`に届く場合には、空のままにします。どちらの場合もルーティングのブロックは削除しません。どのサンプルもリストが空のままで有効です。

各サンプルは、プロキシの起動時に一度だけリストを読み込みます。[テナントを追加する](./index.md#テナントを追加する)ときは、そのドメインを`PUBLIRA_EDGE_SITE_HOSTS`に、管理画面のホストを`PUBLIRA_EDGE_ADMIN_HOSTS`に、画像ホストを与える場合はそれを`PUBLIRA_EDGE_IMAGE_HOSTS`に追加し、新しい環境でプロキシを再起動してください。リロードでは古いリストのままです。nginxやCaddyにファイルだけで追加した証明書も、反映にはリロードが必要です。`nginx -s reload`または`caddy reload --config /etc/caddy/Caddyfile`で、どちらも処理中の接続を切断しません。証明書を自分で取得するCaddyは、`PUBLIRA_EDGE_TLS_HOSTS`に追加した名前で再起動したときにその証明書を要求します。ACMEリゾルバーを持つTraefikは、ルーティングがその名前を指定した時点で要求します。

[Docker Compose](../3-docker-compose.md)のインストール環境では、リストは`.env`にあり、`docker compose up -d proxy`でそのリストを使ってプロキシを作り直します。作り直されたプロキシは、新しい名前の証明書を取得します。

## プロキシの前にあるホップ

ロードバランサー、CDN、TLS終端装置がサンプルに接続する場合、プロキシの接続相手はそのホップになります。サンプルを同梱されたままの状態で使うと、すべてのリクエストがホップのアドレスで記録されます。監査ログには全員に同じアドレスが表示され、Publiraがクライアントのアドレスごとに設けている制限をすべての読者が共有することになります。

読者自身のアドレスを記録するには、次のようにします。

- **ホップが`X-Forwarded-For`、`X-Forwarded-Host`、`X-Forwarded-Proto`を自分で設定します。** 値は、ホップに接続してきたアドレス、ブラウザーが要求したホスト、ブラウザーが使ったスキームで、呼び出し元の値を渡したり、それに追記したりはしません。Traefikはホップからの3つすべてを信頼し、Webアプリは`X-Forwarded-Host`からテナントを特定します。そのため、Traefikの後ろで`X-Forwarded-For`だけを設定するホップがあると、呼び出し元がテナントを選べてしまいます。Caddyは、自分の前にあるプロキシを信頼していない場合、既定で3つすべてを設定します。
- **プロキシはそのホップのアドレスだけを信頼し、** クライアントのアドレスをホップのヘッダーから取得します。Traefikとnginxのサンプルには、この設定がコメントアウトされた状態で含まれており、ドキュメント用のアドレス範囲`192.0.2.0/24`を指定しています。コメントを外し、その範囲をホップのアドレスに置き換えてください。Caddyのサンプルは、アドレスを環境から読み込みます。
  - Traefik：`traefik.yaml`の`web`エントリーポイント（またはホップが接続するエントリーポイント）の`forwardedHeaders.trustedIPs`です。加えて、同じアドレスをスペース区切りでTraefikプロセスの環境の`PUBLIRA_EDGE_TRUSTED_PROXIES`に設定します。`dynamic/routes.yaml`は、ホップの地域を渡すためにこれを読み込みます。
  - nginx：`default.conf.template`の先頭近くにある`set_real_ip_from`と、その下の`real_ip_header`、`real_ip_recursive`です。`set_real_ip_from`の行はアドレスまたはアドレス範囲ごとに1行書きます。加えて、その下の`geo`ブロックに同じアドレスを、` 1;`で終わる行として1つずつ書きます。
  - Caddy：Caddyプロセスの環境の`PUBLIRA_EDGE_TRUSTED_PROXIES`に、アドレスをスペース区切りで設定します。Caddyfileのグローバルオプションにある`trusted_proxies static`がこれを読み込みます。
  - Docker Composeのインストール環境：[前段のCDNやロードバランサー](../3-docker-compose.md#前に置くcdnやロードバランサー)のとおり、`.env`の`PUBLIRA_EDGE_TRUSTED_PROXIES`です。

これで、どのサンプルもホップが指定する`X-Forwarded-Proto`を渡すようになります。読者はHTTPSを使っていても、ホップは平文のHTTPでプロキシに届くためです。同様に、ホップが指定する`X-Forwarded-CountryRegion`も渡すため、読者の地域を知っているホップは、プロキシを通じてその地域を[Googleタグゲートウェイ](./index.md#読者の地域)に渡せます。そのようなホップはこのヘッダーを自分で設定し、呼び出し元が送ってきた値を置き換えます。地域を知らないホップはこのヘッダーを取り除きます。プロキシは、信頼するホップが送ってきたものをそのまま渡すためです。nginxとCaddyは、ホップの`X-Forwarded-For`のうち信頼するアドレスではない一番右のアドレスを取り、そのアドレスだけを`Forwarded`で渡し、`X-Forwarded-Host`は引き続き自分で設定します。そのため、nginxとCaddyの前にあるホップは`PUBLIRA_TRUSTED_PROXIES`に登録する必要がありません。Traefikはホップの`X-Forwarded-For`に、ホップ自身のアドレスを追記して渡します。そのため`publira server`がそのアドレスを飛ばしてホップの指定したアドレスを採用するのは、自身もホップを信頼している場合だけです。プライベートネットワーク上のホップは既定で信頼され、CDNのようにパブリックなアドレスを持つホップは、`PUBLIRA_TRUSTED_PROXIES`にその範囲を列挙した時点で信頼されます。それ以外のアドレスからのリクエストは、この設定がない場合と同じように扱われます。

信頼するのはホップ自身のアドレスだけにしてください。読者からも届くアドレス範囲を信頼すると、どの読者も好きなアドレスを名乗れてしまいます。

## サンプルでTLSを終端する

以下の変更で、各サンプルにTLSリスナーを追加し、平文のHTTPをリダイレクトでHTTPSに送ります。CaddyとTraefikは、与えられたすべての名前について、Let's Encryptまたは別のACME認証局から証明書を取得し、期限が切れる前に更新できます。認証局はその名前でポート80または443を通じてプロキシに到達する必要があるため、先にDNSレコードを用意し、両方のポートをインターネットに開いておきます。certbotのような別のACMEクライアント、独自の認証局、証明書サービスなど、ほかの場所で発行された証明書は、プロキシが読み込むファイルに書き出します。その場合、更新はそのツールの役割になり、プロキシは更新後のファイルを読み込み直す必要があります。

[Docker Compose](../3-docker-compose.md)のインストール環境は、ACMEの連絡先を設定すると、以下のとおりCaddyのサンプルを動かし、リストにあるすべてのホストについてTLSを終端します。

### Caddy

Caddyプロセスの環境で、`PUBLIRA_EDGE_TLS_HOSTS`に4つのリストにあるすべてのホスト名をスペース区切りで設定し、`PUBLIRA_EDGE_ACME_EMAIL`に認証局のアカウントを登録する連絡先のアドレスを設定します。するとCaddyは名前ごとに証明書を取得して更新し、ポート443で提供し、それらの名前への平文のHTTPをHTTPSにリダイレクトします。

```text
PUBLIRA_EDGE_TLS_HOSTS=comics.example.com admin.comics.example.com platform.example.com images.comics.example.com
PUBLIRA_EDGE_ACME_EMAIL=ops@example.com
```

Caddyは証明書を`/data`の下に保存するため、このディレクトリにはコンテナより長く残るボリュームを割り当ててください。空の状態から始まるボリュームでは、Caddyがすべての証明書を要求し直します。どのリストにもないホストには証明書がないため、TLSハンドシェイクが失敗します。平文のHTTPでは、引き続きサンプル自身が404を返します。

ほかの場所で発行された証明書を使う場合は、サイトブロックのアドレスである`:80 {$PUBLIRA_EDGE_TLS_HOSTS}`をホスト名に置き換え、ブロックの中に`tls /etc/caddy/tls/fullchain.pem /etc/caddy/tls/privkey.pem`を追加します。Caddyは自分で証明書を取得する代わりにこれらのファイルを使います。ただし、平文のHTTPでも待ち受けるブロックでは、これらのファイルを受け付けません。Caddyはこれらのファイルをコンテナの中で読むため、ファイルを置いたディレクトリを読み取り専用で`/etc/caddy/tls`にマウントしてください。Docker Composeのインストール環境では、`proxy`サービスの`volumes`に`- <directory>:/etc/caddy/tls:ro`を追加し、`docker compose up -d proxy`を実行して、マウントを付けた状態でサービスを作り直します。ポート80のサイトが1つも残らないため、Caddyはリストにあるかどうかにかかわらず、すべてのホストへの平文のHTTPをHTTPSにリダイレクトします。そのため、どのリストにもないホストには、サンプルの404の代わりにこのリダイレクトが返り、その後TLSハンドシェイクが失敗します。

### nginx

`default.conf.template`にある5つの`server`ブロックそれぞれで、`listen 80`を`listen 443 ssl`に変更します。どのリストにもないホストに応答する最初のブロックには、`default_server`を残しておきます。そのうえで、同じファイルの末尾に証明書と、平文のHTTPをリダイレクトするサーバーを追加します。

```nginx
ssl_certificate     /etc/nginx/tls/fullchain.pem;
ssl_certificate_key /etc/nginx/tls/privkey.pem;

server {
    listen 80 default_server;
    return 308 https://$host$request_uri;
}
```

ここに書いた証明書はすべての`server`ブロックで使われるため、プロキシが提供するすべてのホストを含んでいる必要があります。代わりにテナントごとに1つの証明書を持つには、証明書と鍵の組ごとのディレクトリにホスト名を付け、ブラウザーが要求した名前からnginxに選ばせます。

```nginx
ssl_certificate     /etc/nginx/tls/$ssl_server_name/fullchain.pem;
ssl_certificate_key /etc/nginx/tls/$ssl_server_name/privkey.pem;
```

こうするとnginxは新しい接続のたびにその組を読み込むため、新しい証明書や更新した証明書がリロードなしで反映されます。ただし、ファイルを読むのはマスタープロセスではなくワーカープロセスであるため、鍵はrootだけでなく、ワーカーを実行するユーザー（公式イメージでは`nginx`）からも読める必要があります。rootしか読めない鍵では、そのホストへの接続がすべて失敗します。

nginxは自分では証明書を取得しません。ACMEクライアントがnginxを通じてHTTPチャレンジに応答する場合は、ポート80のサーバーで、リダイレクトより前に`/.well-known/acme-challenge/`を提供してください。

### Traefik

`traefik.yaml`で、`web`エントリーポイントを`websecure`に送り、サンプルにコメントアウトされた状態で含まれている`websecure`エントリーポイントを有効にします。

```yaml
entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
  websecure:
    address: ":443"
    http:
      middlewares:
        - strip-trace-context@file
        - strip-forwarded@file
      tls: {}
    transport:
      respondingTimeouts:
        readTimeout: 300s
```

`websecure`には、`web`と同じ2つのミドルウェアと同じ300秒を設定します。このタイムアウトがないと、HTTPSでのアップロードが1分で打ち切られます。

`dynamic/routes.yaml`では、すべてのルーターで`entryPoints: [web]`を`entryPoints: [websecure]`に変更します。ルーターは自分が指定したエントリーポイントでしか応答しないため、`web`のまま残したルーターにはHTTPSで到達できません。

Traefikに証明書を取得させるには、`traefik.yaml`にリゾルバーを追加し、その`storage`のファイルをコンテナより長く残るボリュームに置きます。

```yaml
certificatesResolvers:
  letsencrypt:
    acme:
      email: ops@example.com
      storage: /etc/traefik/acme/acme.json
      httpChallenge:
        entryPoint: web
```

ルーターはルールの中でリストにあるすべてのホストを指定しているため、Traefikはそこから要求すべき名前を判断できます。上の`websecure`エントリーポイントで`tls: {}`をリゾルバーに置き換えると、そのエントリーポイントのすべてのルーターが自分のホストの証明書を取得します。

```yaml
tls:
  certResolver: letsencrypt
```

ほかの場所で発行された証明書を使う場合は、リゾルバーを追加せず、`dynamic`ディレクトリに`dynamic/tls.yaml`のような新しいファイルを作ってファイルを列挙します。Traefikは、それぞれの証明書をその証明書が含む名前に対して提供します。

```yaml
tls:
  certificates:
    - certFile: /etc/traefik/tls/comics.example.com/fullchain.pem
      keyFile: /etc/traefik/tls/comics.example.com/privkey.pem
```

Traefikは`dynamic`ディレクトリを監視しているため、新しい証明書のエントリーなど、そこにあるファイルへの変更は再起動なしで反映されます。`traefik.yaml`への変更には再起動が必要です。ただし、Traefikは証明書のファイルがその場で置き換えられても気づかないため、更新のたびに`touch dynamic/tls.yaml`などで`dynamic/`内のファイルを更新してください。そうしないと、Traefikは期限が切れるまで古い証明書を提供し続けます。

## 次のステップ

エッジがHTTPSで提供されるようになったら、管理画面のホストで[テナント管理画面にログイン](../2-installing.md#6-ログインする)します。サンプルに共通するルール、その順序、そしてリポジトリがすべてのサンプルをそれらのルールに照らしてどう検査しているかは、[ルーティングの契約](https://github.com/publira/publira/blob/main/infra/proxy/README.md)にあります。
