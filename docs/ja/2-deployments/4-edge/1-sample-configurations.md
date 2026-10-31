---
title: リバースプロキシの設定例
description: リバースプロキシの要件を満たすTraefik、nginx、Caddyの設定例と、それを自分のPubliraに合わせて使う方法を説明します。
published: 2026-10-29
updated: 2026-10-30
source_updated: 2026-10-30
---

リポジトリには、Traefik、nginx、Caddyのリバースプロキシの設定例が1つずつあります。どれも[リバースプロキシで必要な設定](./index.md#リバースプロキシで必要な設定)のとおりにリクエストを振り分け、ヘッダー、本文、タイムアウトを扱います。設定例を使う側に残る要件は、TLSリスナーだけです。TraefikとnginxではTLSリスナーを自分で追加し、CaddyではHTTPSで提供するホスト名を渡すとCaddyが追加します。

設定例はあくまで例で、リバースプロキシの要件を決めるものではありません。[Docker Compose](../3-docker-compose.md)の構成はCaddyの設定例を使っていて、自分でプロキシを動かすならどの設定例から始めても構いません。マネージドのロードバランサー、Ingress、Gatewayでリバースプロキシを組む場合も同じ要件に従いますが、設定例は使いません。要件を満たすGatewayとIngressの例は[Kubernetesでのリバースプロキシの設定](../5-kubernetes/1-edge.md)に、Application Load Balancerの前にCloudFrontを置く例は[CloudFrontを前に置く構成](../6-ecs-fargate/1-cloudfront.md)にあります。

| プロキシ | ファイル | バックエンドのアドレスを書く場所 | 証明書を自分で取得するか |
| --- | --- | --- | --- |
| Traefik | [`infra/proxy/traefik/`](https://github.com/publira/publira/tree/main/infra/proxy/traefik) | `dynamic/services.yaml` | 追加したACMEリゾルバーで取得します |
| nginx | [`infra/proxy/nginx/`](https://github.com/publira/publira/tree/main/infra/proxy/nginx) | `upstreams.conf` | 取得しません |
| Caddy | [`infra/proxy/caddy/Caddyfile`](https://github.com/publira/publira/blob/main/infra/proxy/caddy/Caddyfile) | 環境変数の`PUBLIRA_UPSTREAM_*` | `PUBLIRA_EDGE_TLS_HOSTS`に並べたホスト名の分を取得します |

使うプロキシのファイルは、インストールするリリースのものを使ってください。3つの設定例に共通するルールは、[ルーティングの仕様](https://github.com/publira/publira/blob/main/infra/proxy/README.md)に1つずつ書いてあります。

## 各設定例の動作

設定例を手直しするときは、ここに挙げる動作をどれも残してください。エントリーポイントや`server`ブロックを追加するなら、そこにも同じヘッダーの扱い、上限、タイムアウトを設定します。

### ルーティング

どの設定例も、4つのリストに並べたホスト名を振り分けます。リストの渡し方は[ホスト名のリスト](#ホスト名のリスト)で説明しています。どのホストにも[ルーティング](./index.md#ルーティング)のパスのルールを当てはめ、それ以外の`/rpc`には設定例が自分で404を返します。

[テナントの画像ホスト](./index.md#テナントの画像ホスト)では、`/images`以外のパスの扱いはリバースプロキシに任されています。設定例は画像ホストでは`/images`だけを転送し、ほかのパスにはすべて自分で404を返します。どのリストにもないホストは、どのパスでもどこにも転送せず、設定例が404を返します。これは設定例が選んだ動作で、Publiraの要件ではありません。

### ヘッダー

ヘッダーの扱いは、プロキシによって次のように違います。

| ヘッダー | Traefik | nginx | Caddy |
| --- | --- | --- | --- |
| クライアントのアドレス | `X-Forwarded-For`を設定し、`strip-forwarded`ミドルウェアで`Forwarded`を削除します | `Forwarded`にクライアントのアドレスだけを設定し、`X-Forwarded-For`を削除します | nginxと同じです |
| トレースコンテキストの3つのヘッダー | `strip-trace-context`ミドルウェアで削除します。どのエントリーポイントにも、`strip-forwarded`と並べてこのミドルウェアが必要です | 削除します | 削除します |
| `X-Forwarded-CountryRegion` | `web-storefront-trusted-hop`以外のすべてのルーターに付けた`strip-country-region`ミドルウェアで削除します。ルーターを追加したら、このミドルウェアも付けてください | 削除します | 削除します |

どの設定例を使う場合も、`PUBLIRA_FORWARDED_HEADER_ENABLED`は有効のままにしてください。

どの設定例も`Host`は変えずに転送し、`X-Forwarded-Host`と`X-Forwarded-Proto`は呼び出し元の値を渡さずに自分で設定します。例外は、信頼する[前段](#前段にロードバランサーやcdnを置く場合)からのリクエストです。

設定例は読者の地域を自分では調べないので、すべてのリクエストから`X-Forwarded-CountryRegion`を削除します。信頼する[前段](#前段にロードバランサーやcdnを置く場合)からのリクエストだけは、その値を引き継ぎます。

### アップロードとWebhook

本文の大きさとリクエストにかかる時間の制限は、プロキシによって次のように違います。

| 制限 | Traefik | nginx | Caddy |
| --- | --- | --- | --- |
| 本文の大きさ | 自分で設定しない限り制限しません | 既定では1MBを超える本文を拒否します。設定例では、管理画面のホストの`/api/v1/episode-pages`を`256m`に、それ以外の`/api/v1/`を`33m`に、ページのパスを`11m`に引き上げています | 自分で設定しない限り制限しません |
| リクエストにかかる時間 | 指定しなければ、60秒以内に全体が届かないリクエストを打ち切ります。この時間はパスごとではなくエントリーポイントごとに決めるので、設定例では`transport.respondingTimeouts.readTimeout`で`web`エントリーポイントのすべてのリクエストに300秒を与えています | 本文全体ではなく、本文を2回読む間隔を60秒まで待ちます。設定例では変えていません | 時間を制限しません。設定例でも変えていません |

### リクエストのレート

Traefikとnginxの設定例は、テナントのドメインと画像ホストで、1つのクライアントが公開API、検索、画像に送れるリクエストの数を制限します。何をどれだけ制限するかは[レート制限](../../3-operations/12-security/5-rate-limits.md)で説明していて、上限の値は[ルーティングの仕様](https://github.com/publira/publira/blob/main/infra/proxy/README.md#request-rates)にあります。上限を超えたリクエストには、設定例が自分で`429`を返します。

| プロキシ | 上限を設定している場所 |
| --- | --- |
| Traefik | `dynamic/routes.yaml`の、上限ごとの`rateLimit`ミドルウェア。サイトと画像ホストのルーターに付けているので、これらのホストにルーターを追加したら、このミドルウェアも付けてください |
| nginx | `default.conf.template`の`limit_req_zone`の行 |
| Caddy | `rate_limit`ブロック。コメントアウトした状態で入っています |

Caddyの`rate_limit`ブロックには[`caddy-ratelimit`](https://github.com/mholt/caddy-ratelimit)モジュールが必要です。`caddy`イメージにはこのモジュールが入っておらず、ブロックのあるCaddyfileを受け付けません。使うには、`xcaddy build --with github.com/mholt/caddy-ratelimit`などでモジュールを組み込んだCaddyを動かし、コメントを外します。[Docker Compose](../3-docker-compose.md)の構成は`caddy`イメージを使うので、リバースプロキシでは何も制限しません。

### TLS

どの設定例も、TLSリスナーを追加するまでは平文のHTTPで待ち受けます。CaddyはHTTPSで提供するホスト名を渡すまで同じです。手順は[設定例でTLSを終端する](#設定例でtlsを終端する)で説明しています。

## バックエンドのアドレス

どの設定例も、バックエンドのアドレスをルーティングとは別に書いています。リポジトリに入っているアドレスは開発用のコンテナを指しているので、最初に書き換えてください。

| バックエンド | アドレス |
| --- | --- |
| `web-storefront` | `web-storefront`の待ち受けているポート |
| `web-admin` | `web-admin`の待ち受けているポート |
| `web-platform` | `web-platform`の待ち受けているポート(動かす場合) |
| `api` | `publira server`のポート`8000`(`PUBLIRA_PUBLIC_API_ADDR`で別のポートを指定したならそのポート) |

## ホスト名のリスト

ホスト名はプロキシの環境変数から読むので、ホスト名のためにルーティングのファイルを編集する必要はありません。各変数には、ホスト名をポートを付けずにスペースで区切って並べます。1つのホストは、どれか1つの変数にだけ書きます。

| 変数 | 並べるもの | 転送先のプロセス |
| --- | --- | --- |
| `PUBLIRA_EDGE_SITE_HOSTS` | 全テナントのドメイン | `web-storefront` |
| `PUBLIRA_EDGE_ADMIN_HOSTS` | 全テナントの管理画面のホスト | `web-admin` |
| `PUBLIRA_EDGE_PLATFORM_HOSTS` | プラットフォーム管理画面のホスト | `web-platform` |
| `PUBLIRA_EDGE_IMAGE_HOSTS` | 全テナントの画像ホスト | `publira server`(`/images`だけ) |

```text
PUBLIRA_EDGE_SITE_HOSTS=comics.example.com manga.example.org
PUBLIRA_EDGE_ADMIN_HOSTS=admin.comics.example.com studio.manga.example.org
PUBLIRA_EDGE_PLATFORM_HOSTS=platform.example.com
PUBLIRA_EDGE_IMAGE_HOSTS=images.comics.example.com
```

変数の読み方は設定例ごとに違います。

| プロキシ | 変数の読み方 |
| --- | --- |
| Traefik | `dynamic/routes.yaml`をテンプレートとして展開するので、変数はTraefikのプロセスの環境に設定します |
| nginx | 公式のnginxイメージが、コンテナの起動時に変数を`default.conf.template`に埋め込みます。イメージは結果を自分の`conf.d/default.conf`に上書きするので、`nginx`ディレクトリは`/etc/nginx/conf.d`ではなく`/etc/nginx/templates`にマウントしてください。このイメージを使わないなら、ファイルの最初のコメントにあるとおり、自分で`envsubst`を使って展開します |
| Caddy | Caddyfileを読むときに変数を埋め込みます |

プラットフォーム管理画面を動かさないなら、`PUBLIRA_EDGE_PLATFORM_HOSTS`は空にし、バックエンドのアドレスから`web-platform`を省いて構いません。`PUBLIRA_EDGE_IMAGE_HOSTS`は、画像ホストを持つテナントがないうちは空のままです。画像ホストがこのプロキシを通らずに専用のロードバランサーから`publira server`に届く場合も空にします。どちらの場合もルーティングのブロックは削除しません。どの設定例も、リストが空のままで正しく動きます。

設定例がリストを読むのは、プロキシの起動時の1回だけです。[テナントを追加するとき](./index.md#テナントを追加するとき)は、ドメインを`PUBLIRA_EDGE_SITE_HOSTS`に、管理画面のホストを`PUBLIRA_EDGE_ADMIN_HOSTS`に加えます。画像ホストを割り当てるなら`PUBLIRA_EDGE_IMAGE_HOSTS`にも加えます。そのうえで、新しい環境でプロキシを再起動してください。リロードではリストは変わりません。

nginxやCaddyに証明書をファイルとして追加しただけなら、反映するにはリロードが必要です。`nginx -s reload`か`caddy reload --config /etc/caddy/Caddyfile`を実行します。どちらも処理中の接続は切りません。証明書を自分で取得するCaddyは、`PUBLIRA_EDGE_TLS_HOSTS`に名前を加えて再起動すると、その名前の証明書を要求します。ACMEリゾルバーを設定したTraefikは、ルーティングにその名前が加わった時点で要求します。

[Docker Compose](../3-docker-compose.md)の構成では、リストは`.env`に書きます。`docker compose up -d proxy`を実行すると新しいリストでプロキシが作り直され、新しい名前の証明書を取得します。

## 前段にロードバランサーやCDNを置く場合

ロードバランサー、CDN、TLS終端装置が設定例のプロキシに接続する構成では、プロキシから見た接続元はその前段です。設定例をそのまま使うと、すべてのリクエストが前段のアドレスで記録されます。監査ログには全員が同じアドレスで残り、Publiraと設定例がクライアントのアドレスごとに設ける上限も、すべての読者で共有されてしまいます。読者自身のアドレスを記録するには、次の2つを設定します。

### 前段が転送ヘッダーを自分で設定する

前段に`X-Forwarded-For`、`X-Forwarded-Host`、`X-Forwarded-Proto`を自分で設定させます。値は順に、前段に接続してきたアドレス、ブラウザーが求めたホスト、ブラウザーが使ったスキームです。呼び出し元から届いた値を渡したり、その値に書き足したりはさせません。

Traefikは前段から届いたこの3つをすべて信頼し、Webアプリは`X-Forwarded-Host`からテナントを特定します。Traefikの前段が`X-Forwarded-For`しか設定しないと、呼び出し元がテナントを選べてしまいます。Caddyは、自分の前にあるプロキシを信頼していなければ、既定で3つとも設定します。

### 設定例のプロキシが前段のアドレスだけを信頼する

設定例のプロキシには、前段のアドレスだけを信頼させ、クライアントのアドレスを前段のヘッダーから取らせます。Traefikとnginxの設定例にはこの設定がコメントアウトして入っていて、アドレスにはドキュメント用の範囲の`192.0.2.0/24`が書いてあります。コメントを外し、範囲を前段のアドレスに書き換えてください。Caddyの設定例はアドレスを環境から読みます。

| 構成 | 前段のアドレスを書く場所 |
| --- | --- |
| Traefik | `traefik.yaml`の`web`エントリーポイント(前段が別のエントリーポイントに接続するならそのエントリーポイント)の`forwardedHeaders.trustedIPs`。同じアドレスを、Traefikのプロセスの環境の`PUBLIRA_EDGE_TRUSTED_PROXIES`にもスペース区切りで設定します。`dynamic/routes.yaml`はこの変数を読み、前段の伝えた地域を引き継ぎ、前段が伝えたアドレスで読者ごとのリクエストを数えます |
| nginx | `default.conf.template`の先頭近くの`set_real_ip_from`と、その下の`real_ip_header`と`real_ip_recursive`。`set_real_ip_from`はアドレスか範囲ごとに1行ずつ書きます。その下の`geo`ブロックにも、同じアドレスを末尾が` 1;`の行で1つずつ書きます |
| Caddy | Caddyのプロセスの環境の`PUBLIRA_EDGE_TRUSTED_PROXIES`に、アドレスをスペース区切りで設定します。Caddyfileのグローバルオプションの`trusted_proxies static`がこれを読みます |
| Docker Composeの構成 | `.env`の`PUBLIRA_EDGE_TRUSTED_PROXIES`。[CDNやロードバランサーを前に置く場合](../3-docker-compose.md#cdnやロードバランサーを前に置く場合)で説明しています |

### 前段を信頼したあとの動作

前段を信頼すると、どの設定例も前段が伝える`X-Forwarded-Proto`をそのまま転送します。読者がHTTPSを使っていても、前段からプロキシへの接続は平文のHTTPだからです。前段が伝える`X-Forwarded-CountryRegion`も転送するので、読者の地域がわかる前段は、プロキシを通して[Googleタグゲートウェイ](./index.md#読者の地域)に地域を渡せます。プロキシは信頼する前段から届いた値を何でも転送します。このヘッダーを設定する前段は呼び出し元が送った値を自分の値で置き換え、地域のわからない前段はこのヘッダーを削除してください。

nginxとCaddyは、前段の`X-Forwarded-For`から、信頼するアドレスを除いていちばん右にあるアドレスを取り出し、そのアドレスだけを`Forwarded`で転送します。`X-Forwarded-Host`も引き続き自分で設定します。そのため、nginxやCaddyの前段を`PUBLIRA_TRUSTED_PROXIES`に加える必要はありません。

Traefikは、前段の`X-Forwarded-For`の末尾に前段自身のアドレスを書き足して転送します。`publira server`が前段のアドレスを読み飛ばして前段が伝えたアドレスにたどり着くのは、`publira server`も前段を信頼している場合だけです。プライベートネットワーク上の前段は既定で信頼されます。CDNのようにパブリックなアドレスを持つ前段は、`PUBLIRA_TRUSTED_PROXIES`にその範囲を並べると信頼されます。ほかのアドレスからのリクエストは、この設定をしていないときと同じに扱われます。

信頼するのは前段自身のアドレスだけにしてください。読者も接続してくる範囲を信頼すると、その読者は誰でも好きなアドレスを名乗れます。

## 設定例でTLSを終端する

以下の変更で、各設定例にTLSリスナーを加え、平文のHTTPをHTTPSにリダイレクトします。CaddyとTraefikは、渡されたすべての名前の証明書をLet's EncryptなどのACME認証局から取得し、期限が切れる前に更新できます。認証局はその名前でポート80か443に接続してプロキシに届く必要があるので、先にDNSレコードを登録し、両方のポートをインターネットに開いておきます。

certbotのような別のACMEクライアント、自前の認証局、証明書サービスなど、ほかで発行した証明書は、プロキシが読むファイルとして書き出します。更新はそのツールに任せ、更新されたファイルをプロキシに読み込ませる必要があります。

[Docker Compose](../3-docker-compose.md)の構成はCaddyの設定例を使っていて、ACMEの連絡先を設定すると、以下のとおりリストにあるすべてのホストでTLSを終端します。

### Caddy

Caddyのプロセスの環境で、`PUBLIRA_EDGE_TLS_HOSTS`に4つのリストに並ぶすべてのホスト名をスペース区切りで設定し、`PUBLIRA_EDGE_ACME_EMAIL`に認証局のアカウントに登録する連絡先のメールアドレスを設定します。Caddyは名前ごとに証明書を取得して更新し、ポート443で提供します。これらの名前への平文のHTTPはHTTPSにリダイレクトします。

```text
PUBLIRA_EDGE_TLS_HOSTS=comics.example.com admin.comics.example.com platform.example.com images.comics.example.com
PUBLIRA_EDGE_ACME_EMAIL=ops@example.com
```

Caddyは証明書を`/data`の下に保存します。このディレクトリには、コンテナを作り直しても残るボリュームを割り当ててください。空のボリュームで始めると、Caddyはすべての証明書を要求し直します。どのリストにもないホストには証明書がないので、TLSハンドシェイクが失敗します。平文のHTTPでは、引き続き設定例の404が返ります。

ほかで発行した証明書を使うなら、サイトブロックのアドレスの`:80 {$PUBLIRA_EDGE_TLS_HOSTS}`をホスト名に置き換え、ブロックの中に`tls /etc/caddy/tls/fullchain.pem /etc/caddy/tls/privkey.pem`を加えます。Caddyは証明書を自分で取得せず、これらのファイルを使います。ただし、平文のHTTPでも待ち受けるブロックでは、これらのファイルを受け付けません。

Caddyはファイルをコンテナの中から読むので、ファイルのあるディレクトリを`/etc/caddy/tls`に読み取り専用でマウントしてください。Docker Composeの構成では、`proxy`サービスの`volumes`に`- <directory>:/etc/caddy/tls:ro`を加え、`docker compose up -d proxy`でマウントを付けて作り直します。ポート80のサイトがなくなるので、Caddyはリストにあるかどうかにかかわらず、すべてのホストへの平文のHTTPをHTTPSにリダイレクトします。どのリストにもないホストには、設定例の404ではなくこのリダイレクトが返り、続くTLSハンドシェイクで失敗します。

### nginx

`default.conf.template`の5つの`server`ブロックすべてで、`listen 80`を`listen 443 ssl`に変えます。最初のブロックはどのリストにもないホストに応答するので、`default_server`を残します。続けて、同じファイルの末尾に証明書の設定と、平文のHTTPをリダイレクトするサーバーを加えます。

```nginx
ssl_certificate     /etc/nginx/tls/fullchain.pem;
ssl_certificate_key /etc/nginx/tls/privkey.pem;

server {
    listen 80 default_server;
    return 308 https://$host$request_uri;
}
```

ここに書いた証明書はすべての`server`ブロックで使われるので、プロキシが提供するすべてのホスト名を含む必要があります。テナントごとに別の証明書を使うなら、証明書と鍵を置くディレクトリにホスト名を付け、ブラウザーが求めた名前からnginxに選ばせます。

```nginx
ssl_certificate     /etc/nginx/tls/$ssl_server_name/fullchain.pem;
ssl_certificate_key /etc/nginx/tls/$ssl_server_name/privkey.pem;
```

この設定では、nginxは新しい接続のたびに証明書と鍵を読むので、新しい証明書も更新した証明書もリロードせずに反映されます。ただ、ファイルを読むのはマスタープロセスではなくワーカープロセスです。鍵はrootだけでなく、ワーカーを動かすユーザーにも読める必要があります。公式イメージなら`nginx`です。rootしか読めない鍵では、そのホストへの接続がすべて失敗します。

nginxは自分では証明書を取得しません。ACMEクライアントがHTTPチャレンジにnginx経由で応答するなら、ポート80のサーバーで、リダイレクトより前に`/.well-known/acme-challenge/`を提供してください。

### Traefik

`traefik.yaml`で、`web`エントリーポイントへのリクエストを`websecure`にリダイレクトし、設定例でコメントアウトしてある`websecure`エントリーポイントを有効にします。

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

`websecure`には、`web`と同じ2つのミドルウェアと、同じ300秒のタイムアウトを設定します。このタイムアウトがないと、HTTPSでのアップロードが1分で打ち切られます。

`dynamic/routes.yaml`では、すべてのルーターの`entryPoints: [web]`を`entryPoints: [websecure]`に変えます。ルーターは指定したエントリーポイントでしか応答しないので、`web`のまま残したルーターにはHTTPSで届きません。

Traefikに証明書を取得させるなら、`traefik.yaml`にリゾルバーを加え、`storage`のファイルをコンテナを作り直しても残るボリュームに置きます。

```yaml
certificatesResolvers:
  letsencrypt:
    acme:
      email: ops@example.com
      storage: /etc/traefik/acme/acme.json
      httpChallenge:
        entryPoint: web
```

ルーターのルールにはリストのすべてのホストが書いてあるので、Traefikはそこから要求する名前を判断できます。上の`websecure`エントリーポイントの`tls: {}`をリゾルバーの指定に置き換えると、そのエントリーポイントのすべてのルーターが自分のホストの証明書を取得します。

```yaml
tls:
  certResolver: letsencrypt
```

ほかで発行した証明書を使うなら、リゾルバーは加えません。代わりに`dynamic`ディレクトリに`dynamic/tls.yaml`のような新しいファイルを作り、証明書のファイルを並べます。Traefikは、各証明書をそこに含まれる名前で使います。

```yaml
tls:
  certificates:
    - certFile: /etc/traefik/tls/comics.example.com/fullchain.pem
      keyFile: /etc/traefik/tls/comics.example.com/privkey.pem
```

Traefikは`dynamic`ディレクトリを監視しているので、新しい証明書のエントリーを加えるなど、ここのファイルの変更は再起動せずに反映されます。`traefik.yaml`の変更には再起動が必要です。ただ、証明書のファイルをその場で置き換えても、Traefikは気づきません。更新のたびに`touch dynamic/tls.yaml`などで`dynamic/`のファイルを更新してください。そうしないと、Traefikは期限が切れるまで古い証明書を使い続けます。

## 次のステップ

リバースプロキシでHTTPSを提供できるようになったら、管理画面のホストで[テナント管理画面にログインします](../2-installing.md#6-ログインする)。設定例に共通するルールとその順序、リポジトリがすべての設定例をそのルールで検査する方法は、[ルーティングの仕様](https://github.com/publira/publira/blob/main/infra/proxy/README.md)にあります。
