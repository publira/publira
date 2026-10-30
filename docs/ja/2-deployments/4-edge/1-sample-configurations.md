---
title: リバースプロキシの設定例
description: リバースプロキシに必要な設定を満たすTraefik、nginx、Caddyの設定例と、その設定例を自分の環境に合わせて使う方法を説明します。
published: 2026-10-29
updated: 2026-10-30
source_updated: 2026-10-30
---

リポジトリには、Traefik、nginx、Caddyのリバースプロキシの設定例が1つずつ含まれています。どれも[リバースプロキシに必要な設定](./index.md#リバースプロキシで必要な設定)のとおりにリクエストをルーティングし、ヘッダー、ボディ、タイムアウトを扱います。ただしTLSリスナーだけは、設定例を使う側で用意します。TraefikとnginxではTLSリスナーを自分で追加します。CaddyではHTTPSで提供するホスト名を渡すと、Caddy自身がTLSリスナーを追加します。設定例はあくまで例で、リバースプロキシの要件を定めるものではありません。[Docker Compose](../3-docker-compose.md)の構成ではCaddyの設定例を使います。リバースプロキシを独自に動かす場合は、どの設定例から始めてもかまいません。マネージドのロードバランサー、Ingress、Gatewayで構成する場合も同じ要件に従いますが、設定例は使いません。要件を満たすGatewayとIngressの例は[Kubernetesでのリバースプロキシの設定](../5-kubernetes/1-edge.md)に、Application Load Balancerの前段にCloudFrontを置く例は[CloudFrontを使った公開](../6-ecs-fargate/1-cloudfront.md)にあります。

| プロキシ | ファイル | バックエンドのアドレスを書く場所 | 証明書を自分で取得するか |
| --- | --- | --- | --- |
| Traefik | [`infra/proxy/traefik/`](https://github.com/publira/publira/tree/main/infra/proxy/traefik) | `dynamic/services.yaml` | 取得します。ACMEリゾルバーの追加が必要です |
| nginx | [`infra/proxy/nginx/`](https://github.com/publira/publira/tree/main/infra/proxy/nginx) | `upstreams.conf` | 取得しません |
| Caddy | [`infra/proxy/caddy/Caddyfile`](https://github.com/publira/publira/blob/main/infra/proxy/caddy/Caddyfile) | 環境変数`PUBLIRA_UPSTREAM_*` | `PUBLIRA_EDGE_TLS_HOSTS`のホスト名について取得します |

使うプロキシのファイルは、インストールするリリースのものを取得してください。3つの設定例に共通するルールは、[ルーティングの仕様](https://github.com/publira/publira/blob/main/infra/proxy/README.md)に1つずつ書かれています。

## 各設定例の動作

- **ルーティング。** 4つのリストにあるホスト名をルーティングします。リストの渡し方は[ホスト名のリスト](#ホスト名のリスト)で説明します。どのホストにも[ルーティング](./index.md#ルーティング)のパスのルールを適用し、それ以外の`/rpc`には設定例自身が404を返します。[テナントの画像ホスト](./index.md#テナントの画像ホスト)では`/images`以外のパスの扱いをリバースプロキシに任せています。設定例ではテナントの画像ホストへの`/images`だけを転送し、ほかのパスにはすべて404を返します。どのリストにもないホストへのリクエストはどこにも転送せず、すべてのパスに404を返します。これは設定例での選択で、Publiraの要件ではありません。
- **クライアントのアドレス。** Traefikは`X-Forwarded-For`を設定し、`strip-forwarded`ミドルウェアで`Forwarded`を削除します。nginxとCaddyは`Forwarded`にクライアントのアドレスだけを設定し、`X-Forwarded-For`を削除します。どの設定例を使う場合も、`PUBLIRA_FORWARDED_HEADER_ENABLED`は有効のままにしてください。
- **ホスト。** どの設定例も`Host`は変更せずに渡します。`X-Forwarded-Host`と`X-Forwarded-Proto`は、呼び出し元から届いた値を渡さずに自分で設定します。例外は、信頼する[前段のプロキシ](#前段にロードバランサーやcdnを置く場合)からのリクエストです。
- **トレースコンテキスト。** どの設定例もトレースコンテキストの3つのヘッダーを削除します。Traefikでは`strip-trace-context`ミドルウェアで削除するので、どのエントリーポイントにも`strip-forwarded`と並べてこのミドルウェアを指定する必要があります。
- **読者の地域。** 設定例はどれも読者の地域を自分では調べません。そのため、すべてのリクエストから`X-Forwarded-CountryRegion`を削除します。ただし、信頼する[前段のプロキシ](#前段にロードバランサーやcdnを置く場合)からのリクエストでは、その値をそのまま渡します。Traefikでは`web-storefront-trusted-hop`以外のすべてのルーターに付けた`strip-country-region`ミドルウェアで削除します。ルーターを追加するときは、このミドルウェアも付けてください。
- **アップロードとWebhook。** TraefikとCaddyは、自分で設定しない限りボディのサイズを制限しません。nginxは既定で1MBを超えるボディを拒否するので、設定例では上限を引き上げています。管理画面のホストの`/api/v1/episode-pages`は`256m`、それ以外の`/api/v1/`は`33m`、画像をアップロードする各ページのパスは`11m`です。Traefikは、指定しない限り60秒以内に全体が届かないリクエストを打ち切ります。この時間はパスごとではなくエントリーポイントごとに設定するので、設定例では`transport.respondingTimeouts.readTimeout`で`web`エントリーポイントのすべてのリクエストに300秒を与えています。nginxの60秒はボディ全体ではなく、ボディを読み取る間隔の上限です。Caddyは時間を制限しません。そのためnginxとCaddyの設定例では、この時間を変更していません。
- **リクエストのレート。** Traefikとnginxの設定例は、テナントのドメインと画像ホストで1つのクライアントが公開API、検索、画像に送れるリクエストの数を、[レート制限とWAF](../../3-operations/12-security/4-rate-limits.md)の説明のとおりに制限します。上限を超えたリクエストには、設定例自身が`429`を返します。上限の値は[ルーティングの仕様](https://github.com/publira/publira/blob/main/infra/proxy/README.md#request-rates)にあります。nginxでは`default.conf.template`の`limit_req_zone`の行で、Traefikでは`dynamic/routes.yaml`にある上限ごとの`rateLimit`ミドルウェアで設定し、このミドルウェアはサイトと画像ホストのルーターに付けています。これらのホストにルーターを追加するときは、このミドルウェアも付けてください。Caddyの設定例では`rate_limit`ブロックをコメントアウトしています。このブロックには[`caddy-ratelimit`](https://github.com/mholt/caddy-ratelimit)モジュールが必要で、`caddy`イメージはこのモジュールを含まず、ブロックのあるCaddyfileを拒否するからです。使うときは、`xcaddy build --with github.com/mholt/caddy-ratelimit`などでこのモジュールを組み込んだCaddyを動かし、コメントを外してください。[Docker Compose](../3-docker-compose.md)の構成は`caddy`イメージを使うので、リバースプロキシでは何も制限しません。
- **TLS。** どの設定例も、TLSリスナーを追加するまでは平文のHTTPで待ち受けます。CaddyではHTTPSで提供するホスト名を渡すまでです。手順は[設定例でTLSを終端する](#設定例でtlsを終端する)で説明します。

設定例を手直しするときも、これらの動作はすべて残してください。エントリーポイントや`server`ブロックを追加する場合は、そこにも同じヘッダー、上限、タイムアウトを設定します。

## バックエンドのアドレス

どの設定例も、バックエンドのアドレスをルーティングとは分けて書いています。リポジトリにあるアドレスは開発用コンテナのものなので、まずこのアドレスを書き換えます。

| バックエンド | アドレス |
| --- | --- |
| `web-storefront` | `web-storefront`のアドレスと待ち受けポート |
| `web-admin` | `web-admin`のアドレスと待ち受けポート |
| `web-platform` | `web-platform`のアドレスと待ち受けポート(動かす場合) |
| `api` | `publira server`のアドレスとポート`8000`(`PUBLIRA_PUBLIC_API_ADDR`で別のポートを指定した場合はそのポート) |

## ホスト名のリスト

ホスト名はプロキシの環境変数から読み込むので、ホスト名のためにルーティングのファイルを編集する必要はありません。各変数には、ポートを付けずにホスト名をスペース区切りで書きます。1つのホストは、どれか1つの変数にだけ書きます。

| 変数 | 内容 | 転送先のプロセス |
| --- | --- | --- |
| `PUBLIRA_EDGE_SITE_HOSTS` | 全テナントのドメイン | `web-storefront` |
| `PUBLIRA_EDGE_ADMIN_HOSTS` | 全テナントの管理画面のホスト | `web-admin` |
| `PUBLIRA_EDGE_PLATFORM_HOSTS` | プラットフォーム管理画面のホスト | `web-platform` |
| `PUBLIRA_EDGE_IMAGE_HOSTS` | 全テナントの画像ホスト | `publira server`(`/images`のみ) |

```text
PUBLIRA_EDGE_SITE_HOSTS=comics.example.com manga.example.org
PUBLIRA_EDGE_ADMIN_HOSTS=admin.comics.example.com studio.manga.example.org
PUBLIRA_EDGE_PLATFORM_HOSTS=platform.example.com
PUBLIRA_EDGE_IMAGE_HOSTS=images.comics.example.com
```

変数の読み込み方は設定例ごとに異なります。

- **Traefik**は`dynamic/routes.yaml`をテンプレートとして展開します。変数はTraefikプロセスの環境変数として設定してください。
- **nginx**では公式のnginxイメージが変数を読み込み、コンテナの起動時に`default.conf.template`へ埋め込みます。`nginx`ディレクトリは`/etc/nginx/conf.d`ではなく`/etc/nginx/templates`にマウントしてください。イメージは展開した結果で自身の`conf.d/default.conf`を上書きします。このイメージを使わない場合は、ファイルの最初のコメントにあるとおり、`envsubst`で自分でファイルを展開してください。
- **Caddy**はCaddyfileを読み込むときに変数を埋め込みます。

プラットフォーム管理画面を動かさない場合は、`PUBLIRA_EDGE_PLATFORM_HOSTS`を空にし、バックエンドのアドレスから`web-platform`を省いてかまいません。`PUBLIRA_EDGE_IMAGE_HOSTS`は、画像ホストを持つテナントがない間は空のままにします。画像ホストへのリクエストがこのプロキシを通らず、専用のロードバランサーから`publira server`に届く場合も空にします。どちらの場合も、ルーティングのブロックは削除しません。どの設定例も、リストが空のままで正しい設定です。

どの設定例も、リストを読み込むのはプロキシの起動時の1回だけです。[テナントを追加する](./index.md#テナントを追加するとき)ときは、ドメインを`PUBLIRA_EDGE_SITE_HOSTS`に、管理画面のホストを`PUBLIRA_EDGE_ADMIN_HOSTS`に追加します。画像ホストを割り当てる場合は、`PUBLIRA_EDGE_IMAGE_HOSTS`にも追加します。そのうえで、新しい環境変数でプロキシを再起動してください。リロードではリストは更新されません。一方、nginxやCaddyに証明書のファイルを追加しただけの場合でも、反映にはリロードが必要です。`nginx -s reload`か`caddy reload --config /etc/caddy/Caddyfile`を実行します。どちらも処理中の接続は切断しません。Caddyに証明書を取得させている場合は、`PUBLIRA_EDGE_TLS_HOSTS`に名前を追加して再起動したときに、Caddyがその名前の証明書を要求します。ACMEリゾルバーを設定したTraefikは、ルーティングにその名前が加わった時点で要求します。

[Docker Compose](../3-docker-compose.md)の構成では、リストは`.env`に書きます。`docker compose up -d proxy`を実行すると新しいリストでプロキシが作り直され、新しい名前の証明書が取得されます。

## 前段にロードバランサーやCDNを置く場合

ロードバランサー、CDN、TLS終端装置などを設定例の前段に置くと、プロキシに接続してくるのはその前段のプロキシになります。設定例をそのまま使うと、すべてのリクエストが前段のプロキシのアドレスで記録されます。監査ログには全員が同じアドレスで表示され、Publiraと設定例がクライアントのアドレスごとにかける制限も、すべての読者で共有されてしまいます。

読者自身のアドレスを記録するには、次の2つを設定します。

- **前段のプロキシが`X-Forwarded-For`、`X-Forwarded-Host`、`X-Forwarded-Proto`を自分で設定する。** 値はそれぞれ、前段のプロキシに接続してきたアドレス、ブラウザーが要求したホスト、ブラウザーが使ったスキームです。呼び出し元から届いた値を渡したり、その値に追記したりはしません。Traefikは前段から届いたこの3つをすべて信頼し、Webアプリは`X-Forwarded-Host`からテナントを判断します。そのため、Traefikの前段が`X-Forwarded-For`しか設定しないと、呼び出し元がテナントを選べてしまいます。Caddyは、自分の前段にあるプロキシを信頼していなければ、既定でこの3つをすべて設定します。
- **設定例のプロキシが前段のアドレスだけを信頼する。** クライアントのアドレスは、前段が設定したヘッダーから取得します。Traefikとnginxの設定例には、この設定がコメントアウトした状態で入っています。アドレスにはドキュメント用の範囲`192.0.2.0/24`が書かれているので、コメントを外し、前段のアドレスに書き換えてください。Caddyの設定例は、アドレスを環境変数から読み込みます。
  - Traefikでは、`traefik.yaml`の`web`エントリーポイント(前段が別のエントリーポイントに接続する場合はそのエントリーポイント)の`forwardedHeaders.trustedIPs`に設定します。さらに、同じアドレスをスペース区切りで、Traefikプロセスの環境変数`PUBLIRA_EDGE_TRUSTED_PROXIES`にも設定します。`dynamic/routes.yaml`は、前段から届いた地域を渡すためと、前段が伝えたアドレスで読者を数えるために、この変数を読み込みます。
  - nginxでは、`default.conf.template`の先頭近くにある`set_real_ip_from`と、その下の`real_ip_header`と`real_ip_recursive`を設定します。`set_real_ip_from`は、アドレスまたはアドレス範囲ごとに1行ずつ書きます。さらに、その下の`geo`ブロックにも同じアドレスを1行ずつ、末尾を` 1;`にして書きます。
  - Caddyでは、Caddyプロセスの環境変数`PUBLIRA_EDGE_TRUSTED_PROXIES`に、アドレスをスペース区切りで設定します。Caddyfileのグローバルオプションにある`trusted_proxies static`がこの変数を読み込みます。
  - Docker Composeの構成では、[前段にCDNやロードバランサーを置く場合](../3-docker-compose.md#cdnやロードバランサーを前に置く場合)の説明のとおり、`.env`の`PUBLIRA_EDGE_TRUSTED_PROXIES`に設定します。

これで、どの設定例も前段が指定した`X-Forwarded-Proto`をそのまま渡すようになります。読者がHTTPSで接続していても、前段からプロキシへの接続は平文のHTTPだからです。前段が指定した`X-Forwarded-CountryRegion`も渡すので、読者の地域がわかる前段は、プロキシ経由でその地域を[Googleタグゲートウェイ](./index.md#読者の地域)に渡せます。プロキシは信頼する前段から届いた値をそのまま渡します。そのため、このヘッダーを設定する前段は、呼び出し元が送った値を自分の値で置き換えます。地域がわからない前段は、このヘッダーを削除します。nginxとCaddyは、前段の`X-Forwarded-For`のうち、信頼するアドレスを除いて一番右にあるアドレスを取り出し、そのアドレスだけを`Forwarded`で渡します。`X-Forwarded-Host`も引き続き自分で設定します。そのため、nginxやCaddyの前段を`PUBLIRA_TRUSTED_PROXIES`に登録する必要はありません。Traefikは、前段の`X-Forwarded-For`に前段自身のアドレスを追記して渡します。そのため`publira server`が前段のアドレスを読み飛ばし、前段が指定したアドレスを採用するのは、`publira server`も前段を信頼している場合に限ります。プライベートネットワーク上の前段は既定で信頼されます。CDNのようにパブリックなアドレスを持つ前段は、`PUBLIRA_TRUSTED_PROXIES`にそのアドレス範囲を書くと信頼されます。それ以外のアドレスからのリクエストは、この設定をしていない場合と同じように扱われます。

信頼するのは前段自身のアドレスだけにしてください。読者からの接続も届くアドレス範囲を信頼すると、どの読者でも好きなアドレスを名乗れてしまいます。

## 設定例でTLSを終端する

以下の変更で、各設定例にTLSリスナーを追加し、平文のHTTPをHTTPSにリダイレクトします。CaddyとTraefikは、渡されたすべての名前について、Let's EncryptなどのACME認証局から証明書を取得し、期限が切れる前に更新できます。認証局は、その名前でポート80か443に接続してプロキシに到達する必要があります。そのため、先にDNSレコードを登録し、両方のポートをインターネットに公開しておきます。certbotのような別のACMEクライアント、自前の認証局、証明書サービスなど、ほかの方法で発行した証明書は、プロキシが読み込むファイルとして書き出します。この場合、証明書の更新はそのツールが担当し、更新後のファイルをプロキシに読み込ませる必要があります。

[Docker Compose](../3-docker-compose.md)の構成ではCaddyの設定例を使い、ACMEの連絡先を設定すると、以下のとおりリストにあるすべてのホストでTLSを終端します。

### Caddy

Caddyプロセスの環境変数`PUBLIRA_EDGE_TLS_HOSTS`に、4つのリストにあるすべてのホスト名をスペース区切りで設定します。`PUBLIRA_EDGE_ACME_EMAIL`には、認証局のアカウントに登録する連絡先のメールアドレスを設定します。するとCaddyは名前ごとに証明書を取得して更新し、ポート443で提供します。これらの名前への平文のHTTPは、HTTPSにリダイレクトします。

```text
PUBLIRA_EDGE_TLS_HOSTS=comics.example.com admin.comics.example.com platform.example.com images.comics.example.com
PUBLIRA_EDGE_ACME_EMAIL=ops@example.com
```

Caddyは証明書を`/data`の下に保存します。このディレクトリには、コンテナを作り直しても残るボリュームを割り当ててください。空のボリュームから始めると、Caddyはすべての証明書を要求し直します。どのリストにもないホストには証明書がないので、TLSハンドシェイクは失敗します。平文のHTTPでは、引き続き設定例の404が返ります。

ほかの方法で発行した証明書を使う場合は、サイトブロックのアドレス`:80 {$PUBLIRA_EDGE_TLS_HOSTS}`をホスト名に置き換え、ブロックの中に`tls /etc/caddy/tls/fullchain.pem /etc/caddy/tls/privkey.pem`を追加します。Caddyは証明書を自分で取得せず、これらのファイルを使います。ただし、平文のHTTPでも待ち受けるブロックでは、これらのファイルを受け付けません。Caddyはファイルをコンテナの中から読むので、ファイルのあるディレクトリを`/etc/caddy/tls`に読み取り専用でマウントしてください。Docker Composeの構成では、`proxy`サービスの`volumes`に`- <directory>:/etc/caddy/tls:ro`を追加し、`docker compose up -d proxy`でマウントを付けてサービスを作り直します。ポート80のサイトがなくなるので、Caddyはリストにあるかどうかにかかわらず、すべてのホストへの平文のHTTPをHTTPSにリダイレクトします。そのため、どのリストにもないホストには設定例の404ではなくこのリダイレクトが返り、その後のTLSハンドシェイクで失敗します。

### nginx

`default.conf.template`の5つの`server`ブロックすべてで、`listen 80`を`listen 443 ssl`に変更します。最初のブロックはどのリストにもないホストに応答するブロックなので、`default_server`を残しておきます。続けて、同じファイルの末尾に証明書の設定と、平文のHTTPをリダイレクトするサーバーを追加します。

```nginx
ssl_certificate     /etc/nginx/tls/fullchain.pem;
ssl_certificate_key /etc/nginx/tls/privkey.pem;

server {
    listen 80 default_server;
    return 308 https://$host$request_uri;
}
```

ここで指定した証明書は、すべての`server`ブロックで使われます。そのため、プロキシが提供するすべてのホスト名を含む証明書が必要です。テナントごとに別の証明書を使う場合は、証明書と鍵を置くディレクトリの名前をホスト名にし、ブラウザーが要求した名前からnginxに選ばせます。

```nginx
ssl_certificate     /etc/nginx/tls/$ssl_server_name/fullchain.pem;
ssl_certificate_key /etc/nginx/tls/$ssl_server_name/privkey.pem;
```

この設定では、nginxは新しい接続のたびに証明書と鍵を読み込みます。新しい証明書や更新した証明書は、リロードしなくても反映されます。ただし、ファイルを読むのはマスタープロセスではなくワーカープロセスです。鍵はrootだけでなく、ワーカーを実行するユーザー(公式イメージでは`nginx`)からも読める必要があります。rootしか読めない鍵では、そのホストへの接続がすべて失敗します。

nginxは自分では証明書を取得しません。ACMEクライアントがHTTPチャレンジにnginx経由で応答する場合は、ポート80のサーバーで、リダイレクトより前に`/.well-known/acme-challenge/`を提供してください。

### Traefik

`traefik.yaml`で、`web`エントリーポイントへのリクエストを`websecure`にリダイレクトし、設定例でコメントアウトされている`websecure`エントリーポイントを有効にします。

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

`dynamic/routes.yaml`では、すべてのルーターの`entryPoints: [web]`を`entryPoints: [websecure]`に変更します。ルーターは指定したエントリーポイントでしか応答しません。`web`のままのルーターには、HTTPSでは到達できません。

Traefikに証明書を取得させる場合は、`traefik.yaml`にリゾルバーを追加します。`storage`のファイルは、コンテナを作り直しても残るボリュームに置いてください。

```yaml
certificatesResolvers:
  letsencrypt:
    acme:
      email: ops@example.com
      storage: /etc/traefik/acme/acme.json
      httpChallenge:
        entryPoint: web
```

ルーターのルールにはリストにあるすべてのホストが書かれているので、Traefikはそこから要求する名前を判断できます。上の`websecure`エントリーポイントの`tls: {}`をリゾルバーの指定に置き換えると、そのエントリーポイントのすべてのルーターが、それぞれのホストの証明書を取得します。

```yaml
tls:
  certResolver: letsencrypt
```

ほかの方法で発行した証明書を使う場合はリゾルバーを追加せず、`dynamic`ディレクトリに`dynamic/tls.yaml`などの新しいファイルを作り、証明書のファイルを列挙します。Traefikは、各証明書をその証明書に含まれる名前に対して使います。

```yaml
tls:
  certificates:
    - certFile: /etc/traefik/tls/comics.example.com/fullchain.pem
      keyFile: /etc/traefik/tls/comics.example.com/privkey.pem
```

Traefikは`dynamic`ディレクトリを監視しています。新しい証明書のエントリーを追加するなど、このディレクトリのファイルを変更した場合は、再起動しなくても反映されます。`traefik.yaml`を変更した場合は再起動が必要です。ただし、証明書のファイルをその場で置き換えても、Traefikは気づきません。更新のたびに`touch dynamic/tls.yaml`などで`dynamic/`のファイルを更新してください。更新しないと、Traefikは期限が切れるまで古い証明書を使い続けます。

## 次のステップ

リバースプロキシがHTTPSで応答するようになったら、管理画面のホストで[テナント管理画面にログイン](../2-installing.md#6-ログインする)します。設定例に共通するルールとその適用順、リポジトリがすべての設定例をそのルールに照らして検査する方法は、[ルーティングの仕様](https://github.com/publira/publira/blob/main/infra/proxy/README.md)にあります。
