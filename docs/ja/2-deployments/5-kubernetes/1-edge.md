---
title: Kubernetesでのリバースプロキシの設定
description: KubernetesクラスターでPubliraの前段にGatewayかIngressを置き、cert-managerで証明書を発行して、クラスターの外から動作を確認する方法を説明します。
published: 2026-10-29
source_updated: 2026-10-22
---

このページは[Kubernetes](./index.md)の手順6です。[プロセスを起動する](./index.md#4-プロセスを起動する)で作成したServiceの前段に、リバースプロキシを置きます。[Publiraをセットアップする](./index.md#5-publiraをセットアップする)を済ませてから始めてください。

リバースプロキシは、[リバースプロキシに必要な設定](../4-edge/index.md#リバースプロキシで必要な設定)のとおり、ホストとパスに応じて適切なServiceにルーティングし、TLSを終端し、呼び出し元に指定させてはならないヘッダーを削除します。クラスターでは、Gateway APIを実装したコントローラーで動かすGatewayとHTTPRoute、またはIngressがこの役割を担います。以下では両方を、同じルーティングで説明します。

| ホスト | パス | Service |
| --- | --- | --- |
| テナントのドメイン | `/images`、`/rpc/publira.v1.…` | `publira-server`、ポート`8000` |
| テナントのドメイン | それ以外の`/rpc` | なし。リバースプロキシが`404`を返します |
| テナントのドメイン | そのほかすべて | `web-storefront`、ポート`3000` |
| テナントの管理画面のホスト | `/images`、`/rpc/publira.v1.…` | `publira-server`、ポート`8000` |
| テナントの管理画面のホスト | それ以外の`/rpc` | なし。リバースプロキシが`404`を返します |
| テナントの管理画面のホスト | そのほかすべて | `web-admin`、ポート`4000` |

`/rpc`の下で転送するのは、公開API`publira.v1`だけです。管理画面は自分のAPIをクラスター内のネットワークで呼び出すので、[リバースプロキシを通すのは公開APIだけ](../4-edge/index.md#リバースプロキシを通すのは公開apiだけ)で説明しているとおり、それ以外にはリバースプロキシが自分で`404`を返します。パスと`Host`ヘッダーは、ブラウザーが送ったままServiceに届けます。どちらも書き換えないでください。

公開APIのプレフィックスは、パスセグメントの途中、`v1`の後のドットで終わります。Gatewayの`PathPrefix`もIngressの`Prefix`もセグメント単位で照合するので、どちらもそれだけではこのプレフィックスを指定できません。また、どちらのAPIにも、リクエストに自分で応答する仕組みがありません。この2点は実装に任されているので、以下の各節で、使う実装での方法を説明します。

## 証明書

cert-managerは、GatewayやIngressに書いたすべてのホスト名について、Let's EncryptなどのACME発行者から証明書を発行し、更新します。Gatewayを使う場合は、Gateway APIのサポートを有効にしてcert-managerをインストールします。Helmチャートでは`config.enableGatewayAPI: true`で有効になります。そのうえで、リバースプロキシ経由でACMEチャレンジに応答する発行者を作成します。

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: ops@example.com
    privateKeySecretRef:
      name: letsencrypt-account
    solvers:
      - http01:
          gatewayHTTPRoute:
            parentRefs:
              - name: publira
                namespace: publira
                kind: Gateway
                sectionName: http
```

Ingressの場合は、ソルバーを`http01: {ingress: {ingressClassName: <your class>}}`にします。チャレンジは各ホスト名のポート80でリバースプロキシに届くので、先にDNSレコードを登録しておきます。

## Gatewayを使う場合

ルートでは、Gateway APIでExtendedに分類されている機能を2つ使います。Extendedの機能は、サポートしていなくても実装がAPIに準拠していると認められます。使うのは、HTTPSへのリダイレクトに使う`HTTPRouteSchemeRedirect`と、Webアプリへのリクエストにかかる時間について実装の上限を外すための`HTTPRouteRequestTimeout`です。各実装がサポートする機能は、Gateway APIの[Implementations](https://gateway-api.sigs.k8s.io/docs/implementations/)のページで比較でき、各実装の適合性レポートへのリンクもあります。Envoy Gatewayは両方をサポートしています。どちらかをサポートしていない実装では、その部分を実装独自のリソースで実現するか、代わりに[Ingress](#ingressを使う場合)を使ってください。

また、Envoy Gateway固有の機能も2つ使います。1つは、公開APIのプレフィックスを指定する`RegularExpression`のパスマッチです。正規表現の方言と優先順位は、Gateway APIでは実装に任されています。Envoy GatewayはRE2の正規表現をパス全体に対して照合し、プレフィックスより先に正規表現を試します。もう1つは、それ以外の`/rpc`に`404`を返すEnvoy Gateway独自の`HTTPRouteFilter`です。このフィルターがリクエストに直接応答します。

```yaml
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: HTTPRouteFilter
metadata:
  name: not-found
spec:
  directResponse:
    statusCode: 404
```

ほかの実装では、正規表現でパスを照合する方法と`404`で応答する方法として、その実装独自のものを使ってください。

Gatewayには、ホスト名ごとに1つのHTTPSリスナーと、1つの平文のHTTPリスナーを置きます。HTTPSリスナーにはそれぞれ、証明書を格納するSecretを指定します。HTTPリスナーは、HTTPSへのリダイレクトとACMEチャレンジへの応答を受け持ちます。`cert-manager.io/cluster-issuer`アノテーションを付けると、cert-managerはHTTPSリスナーごとに、リスナーが指定するSecretに証明書を発行します。

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: publira
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
spec:
  gatewayClassName: <your class>
  listeners:
    - name: http
      protocol: HTTP
      port: 80
    - name: comics-example-com
      protocol: HTTPS
      port: 443
      hostname: comics.example.com
      tls:
        certificateRefs:
          - name: comics-example-com-tls
    - name: admin-comics-example-com
      protocol: HTTPS
      port: 443
      hostname: admin.comics.example.com
      tls:
        certificateRefs:
          - name: admin-comics-example-com-tls
```

HTTPRouteはWebアプリごとに1つ作成し、そのアプリのHTTPSリスナーに名前で接続します。ホスト名はリスナーから引き継ぎます。どのルールでも、すべての実装がサポートする`RequestHeaderModifier`フィルターで、トレースコンテキストのヘッダー、`Forwarded`、`X-Forwarded-Host`、`X-Forwarded-CountryRegion`をリクエストから削除します。

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: web-storefront
spec:
  parentRefs:
    - name: publira
      sectionName: comics-example-com
  rules:
    - matches:
        - path: { type: PathPrefix, value: /images }
        - path: { type: RegularExpression, value: '/rpc/publira\.v1\..*' }
      filters: &strip-request-headers
        - type: RequestHeaderModifier
          requestHeaderModifier:
            remove:
              - traceparent
              - tracestate
              - baggage
              - forwarded
              - x-forwarded-host
              - x-forwarded-countryregion
      backendRefs:
        - name: publira-server
          port: 8000
    - matches:
        - path: { type: PathPrefix, value: /rpc }
      filters:
        - type: ExtensionRef
          extensionRef:
            group: gateway.envoyproxy.io
            kind: HTTPRouteFilter
            name: not-found
    - matches:
        - path: { type: PathPrefix, value: / }
      filters: *strip-request-headers
      timeouts:
        request: 0s
      backendRefs:
        - name: web-storefront
          port: 3000
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: web-admin
spec:
  parentRefs:
    - name: publira
      sectionName: admin-comics-example-com
  rules:
    - matches:
        - path: { type: PathPrefix, value: /images }
        - path: { type: RegularExpression, value: '/rpc/publira\.v1\..*' }
      filters: &strip-request-headers
        - type: RequestHeaderModifier
          requestHeaderModifier:
            remove:
              - traceparent
              - tracestate
              - baggage
              - forwarded
              - x-forwarded-host
              - x-forwarded-countryregion
      backendRefs:
        - name: publira-server
          port: 8000
    - matches:
        - path: { type: PathPrefix, value: /rpc }
      filters:
        - type: ExtensionRef
          extensionRef:
            group: gateway.envoyproxy.io
            kind: HTTPRouteFilter
            name: not-found
    - matches:
        - path: { type: PathPrefix, value: / }
      filters: *strip-request-headers
      timeouts:
        request: 0s
      backendRefs:
        - name: web-admin
          port: 4000
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: https-redirect
spec:
  parentRefs:
    - name: publira
      sectionName: http
  rules:
    - filters:
        - type: RequestRedirect
          requestRedirect:
            scheme: https
            statusCode: 301
```

- **公開APIと`404`。** Envoy Gatewayは正規表現を先に試すので、`/rpc/publira\.v1\..*`に一致するパスは`publira-server`に届きます。それ以外の`/rpc`と`/api`は`not-found`フィルターを付けた`PathPrefix`のルールに一致し、より長いプレフィックスである`/api/v1`はWebアプリに届きます。フィルターを付けたルールには`backendRefs`がありません。一致したリクエストにはすべてフィルターが応答し、どこにも転送しないからです。
- **削除するヘッダー。** `traceparent`、`tracestate`、`baggage`は、[トレースコンテキスト](../4-edge/index.md#トレースコンテキスト)の要件に従って削除します。Gatewayは、指定しない限り、呼び出し元が送った`Forwarded`と`X-Forwarded-Host`をそのまま渡します。[クライアントのアドレス](../4-edge/index.md#クライアントのアドレス)と[リクエストの送信先のホスト](../4-edge/index.md#リクエストの送信先のホスト)で説明しているとおり、Publiraはその両方を読みます。ここで削除しておけば、すべてのプロセスで`PUBLIRA_FORWARDED_HEADER_ENABLED`を既定値のままにできます。`X-Forwarded-CountryRegion`は、[読者の地域](../4-edge/index.md#読者の地域)の要件に従って削除します。Envoy Gatewayは自分では地域を調べないので、テナントのGoogleタグゲートウェイはGoogleに地域を送りません。[CloudFrontを使った公開](../6-ecs-fargate/1-cloudfront.md#ヘッダー)の例のように、Gatewayの前段のCDNがこのヘッダーに読者の地域を設定する場合は、`web-storefront`のルールの`remove`からこのヘッダーを外すと、地域が`web-storefront`に届きます。ただし、これが安全なのは、Gatewayに接続できるのがそのCDNだけの場合に限ります。
- **アップロードのタイムアウト。** `timeouts.request: 0s`は、Webアプリへのリクエストにかかる時間の上限をなくします。Gateway APIでは、時間0をこの意味に定義しています。指定しないとルールには実装の既定値が適用され、その値ははるかに短い場合があります。Envoy Gatewayの既定値は、リクエストが届いてから応答までの15秒です。[テナント管理画面でのアップロード](../4-edge/index.md#テナント管理画面でのアップロード)で説明しているとおり、テナント管理画面でのエピソードのアップロードは、届くまでに最大300秒かかります。Gateway APIでは、`web-admin`がページを保存して応答するより前のこの到着時間も、実装がタイムアウトの計測に含めてよいことになっています。Webアプリ自身がリクエストの到着に300秒の上限を設けているので、リバースプロキシで別に上限を設ける必要はありません。Gateway APIには、ボディのサイズを指定するフィールドがありません。Envoy Gatewayは、独自のポリシーで追加しない限りボディのサイズを制限しません。使う実装がボディのサイズを制限する場合は、管理画面のホストの`/api/v1/episode-pages`で256MiB、テナントのドメインの`/api/v1/webhook/email/`の下で33MiBまで許可してください。
- **リダイレクト。** `https-redirect`は`http`リスナーだけに接続し、そこに届いたすべてのリクエストをHTTPSにリダイレクトします。証明書の発行中は、cert-managerがチャレンジ用のルートを同じリスナーに追加します。このルートは証明書の対象のホストを指定しているので、そのホストへの平文のHTTPリクエストは、リダイレクトではなくこのルートが受け取ります。証明書が発行されてルートが削除されると、再びリダイレクトが応答します。

YAMLアンカー`&strip-request-headers`を使って、ルートのすべてのルールに同じフィルターを指定しています。アンカーは`kubectl apply`が展開します。

## Ingressを使う場合

Ingressのフィールドでは、リクエストヘッダーの削除もタイムアウトの設定もできません。そのため、Ingressを使う場合は、どちらもコントローラーの機能に頼ります。以下のマニフェストは、IngressコントローラーとしてTraefikを使う場合の例です。Traefikは、Helmチャートから次の値でインストールします。

```yaml
ports:
  web:
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
          permanent: true
  websecure:
    http:
      middlewares:
        - publira-strip-request-headers@kubernetescrd
    transport:
      respondingTimeouts:
        readTimeout: 300s
service:
  spec:
    externalTrafficPolicy: Local
```

Middlewareも2つ作成します。1つはヘッダーを削除するもので、上の`websecure`エントリーポイントが受け取るすべてのリクエストに適用します。もう1つは転送する前に`404`で応答するもので、後述のそれ以外の`/rpc`用のIngressが、そのパスに適用します。

```yaml
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: strip-request-headers
spec:
  headers:
    customRequestHeaders:
      traceparent: ""
      tracestate: ""
      baggage: ""
      Forwarded: ""
      X-Forwarded-CountryRegion: ""
---
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: not-found
spec:
  ipAllowList:
    sourceRange: [255.255.255.255/32]
    rejectStatusCode: 404
```

Traefikには、リクエストに応答するだけのMiddlewareがありません。そこで`not-found`は、どの接続の送信元にもならないブロードキャストアドレスだけを許可するリストにして、ほかのすべてのアドレスを`404`で拒否します。`rejectStatusCode`には、Traefik 3.4以降が必要です。

[クライアントのアドレス](#クライアントのアドレス)で説明しているとおり、Traefikは、前段を信頼するよう設定しない限り、呼び出し元の`X-Forwarded-For`と`X-Forwarded-Host`を自分の値で置き換えます。そのため、この2つは削除する必要がありません。Traefikは自分では地域を調べないので、[読者の地域](../4-edge/index.md#読者の地域)の要件に従って、すべてのリクエストから`X-Forwarded-CountryRegion`を削除します。テナントのGoogleタグゲートウェイはGoogleに地域を送りません。`readTimeout`はリクエストの到着に300秒を与えます。これはエピソードのアップロードに必要です。Traefikはボディのサイズを制限しません。`web`のリダイレクトでACMEチャレンジもHTTPSに転送されますが、認証局はリダイレクトに従います。HTTPS側では、証明書がまだない段階でもチャレンジに応答します。ほかのコントローラーでは、これらをそれぞれ、そのコントローラー独自のアノテーションやリソースで実現してください。

そのうえで、Webアプリごとに1つのIngressでホストをルーティングします。Traefikは、`strictPrefixMatching`オプションが有効でない限り、`Prefix`と`ImplementationSpecific`のパスを、セグメント単位ではなく文字列の前方一致で照合します。このオプションは無効のままにしてください。この照合のおかげで、パスセグメントの途中で終わる公開APIのプレフィックスを`/rpc/publira.v1.`で指定できます。Ingress APIはこの照合の意味をコントローラーに任せているので、このパスの種類は`ImplementationSpecific`にします。セグメント単位で照合するコントローラーでは、そのための独自のアノテーションやリソースが必要です。

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web-storefront
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
spec:
  ingressClassName: traefik
  tls:
    - hosts: [comics.example.com]
      secretName: comics-example-com-tls
  rules:
    - host: comics.example.com
      http:
        paths: &storefront-paths
          - path: /images
            pathType: Prefix
            backend:
              { service: { name: publira-server, port: { number: 8000 } } }
          - path: /rpc/publira.v1.
            pathType: ImplementationSpecific
            backend:
              { service: { name: publira-server, port: { number: 8000 } } }
          - path: /
            pathType: Prefix
            backend:
              { service: { name: web-storefront, port: { number: 3000 } } }
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web-admin
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
spec:
  ingressClassName: traefik
  tls:
    - hosts: [admin.comics.example.com]
      secretName: admin-comics-example-com-tls
  rules:
    - host: admin.comics.example.com
      http:
        paths: &admin-paths
          - path: /images
            pathType: Prefix
            backend:
              { service: { name: publira-server, port: { number: 8000 } } }
          - path: /rpc/publira.v1.
            pathType: ImplementationSpecific
            backend:
              { service: { name: publira-server, port: { number: 8000 } } }
          - path: /
            pathType: Prefix
            backend: { service: { name: web-admin, port: { number: 4000 } } }
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-not-found
  annotations:
    traefik.ingress.kubernetes.io/router.middlewares: publira-not-found@kubernetescrd
spec:
  ingressClassName: traefik
  tls:
    - hosts: [comics.example.com]
      secretName: comics-example-com-tls
    - hosts: [admin.comics.example.com]
      secretName: admin-comics-example-com-tls
  rules:
    - host: comics.example.com
      http:
        paths: &not-found-paths
          - path: /rpc
            pathType: Prefix
            backend:
              { service: { name: web-storefront, port: { number: 3000 } } }
    - host: admin.comics.example.com
      http:
        paths: *not-found-paths
```

`cert-manager.io/cluster-issuer`アノテーションを付けると、cert-managerは各`tls`エントリーのホストについて、エントリーが指定するSecretに証明書を発行します。`api-not-found`にはこのアノテーションを付けず、ほかの2つのIngressで発行した証明書を読み込みます。

`api-not-found`は、両方のホストでそれ以外の`/rpc`を受け取り、`not-found`のMiddlewareで応答します。Traefikは長いルールから順に試すので、`/rpc/publira.v1.`のパスはそれぞれのIngressに残り、`/`は引き続きWebアプリに届きます。バックエンドにリクエストが届くことはありません。Ingressのパスにはバックエンドが必要なので、指定しているだけです。バックエンドを`publira-server`ではなくWebアプリにしているのは、万一Middlewareがなくなっても、リクエストが管理画面のAPIではなく、そのパスにページを持たないWebアプリに届くようにするためです。Traefikは`/rpc`を文字列として照合するので、`/rpcabc`のようなパスにも`404`を返します。そのパスにページを持つWebアプリもありません。

## クライアントのアドレス

Publiraはリクエストごとに、送信元の読者のアドレスを記録します。[クライアントのアドレス](../4-edge/index.md#クライアントのアドレス)で説明しているとおり、アドレスはリバースプロキシが書き込む`X-Forwarded-For`ヘッダーから読みます。クラスターでは、記録されるアドレスが本当に読者のものになるかどうかを、次の2点が左右します。

**読者のアドレスがコントローラーまで届くこと。** `LoadBalancer`タイプのServiceが接続をそのまま転送する場合(多くのクラウドのロードバランサーのパススルーモードなど)、接続はロードバランサーが選んだいずれかのノードを経由して届きます。既定の`externalTrafficPolicy: Cluster`では、接続がコントローラーのPodに届く前に、そのノードが読者のアドレスを自分のアドレスに置き換えます。コントローラーのServiceに`externalTrafficPolicy: Local`を設定してください。接続は、コントローラーのPodが動いているノードにだけ、送信元アドレスを保ったまま届くようになります。設定する場所はコントローラーによって異なります。Envoy Gatewayは、特に指定しない限り、Gatewayのために作成するServiceにこの値を設定します。上のTraefikの値では、チャートが作成するServiceに設定しています。HTTPを自分で終端するロードバランサーは、代わりに読者のアドレスを`X-Forwarded-For`に書き込みます。その場合は、後述のとおりロードバランサー自身のアドレスを信頼します。

**`PUBLIRA_TRUSTED_PROXIES`にクラスター内のプロキシを指定すること。** コントローラーのPodとWebアプリのPodは、Podのアドレスから`publira server`に接続します。そのため、値にはPodのアドレス範囲を指定します。[プロセスを起動する](./index.md#4-プロセスを起動する)の`publira-server`と`web-storefront`のDeploymentでも、この値にしています。未設定の場合は、ノードのアドレスも含めて、すべてのプライベートアドレスの範囲を信頼します。すると、`externalTrafficPolicy`が`Cluster`のままでノードのアドレスからコントローラーに届いたリクエストは、呼び出し元が自分で`X-Forwarded-For`に書いた任意のアドレスで記録されてしまいます。Podの範囲だけを指定していれば、そのようなリクエストはノードのアドレスで記録されます。その場合は全読者が1つのアドレスを共有しますが、読者がアドレスを自由に選ぶことはできません。

**コントローラーの前段のプロキシは2か所で信頼させること。** コントローラーの前段でHTTPを終端するロードバランサーやCDNは、[前段にロードバランサーやCDNを置く場合](../4-edge/1-sample-configurations.md#前段にロードバランサーやcdnを置く場合)で説明しているとおり、`X-Forwarded-For`を呼び出し元の値に追記せず、自分に接続してきたアドレスに設定します。コントローラーは、このヘッダーをそのまま渡す必要があります。

- Envoy Gatewayは受け取った`X-Forwarded-For`を残し、前段のアドレスを追記するので、設定は必要ありません。
- Traefikは、エントリーポイントが前段を信頼していない限り、このヘッダーを置き換えます。上のHelmの値の`ports.websecure.forwardedHeaders.trustedIPs`に、前段のアドレスを追加してください。するとTraefikは、前段から届いた`X-Forwarded-Host`も残します。Webアプリはこのヘッダーからテナントを判断するので、前段はこのヘッダーも設定します。

続けて、同じアドレスを`PUBLIRA_TRUSTED_PROXIES`にPodの範囲と並べて追加します。[信頼するプロキシを設定する場合](../4-edge/index.md#信頼するプロキシを設定する場合)で説明しているとおり、これで`publira server`は前段のアドレスを読み飛ばし、前段が指定したアドレスを採用します。コントローラー側の設定がなければ、`PUBLIRA_TRUSTED_PROXIES`をどう設定しても、すべての読者が前段のアドレスで記録されます。信頼するのは前段自身のアドレスだけにしてください。読者からの接続も届くアドレス範囲を信頼すると、どの読者でも好きなアドレスを名乗れてしまいます。

## リバースプロキシの動作を確認する

リバースプロキシのServiceにアドレスが割り当てられたら、DNSレコードをそのアドレスに向け、証明書の発行を待ちます。発行された証明書は、`kubectl get certificate`で`True`と表示されます。そのうえで、クラスターの外からルーティングを確認します。

```bash
curl -sI https://comics.example.com/ | head -1
curl -s https://comics.example.com/readyz
curl -s -X POST -H 'Content-Type: application/json' -d '{}' \
  https://comics.example.com/rpc/publira.v1.TenantService/GetTenant
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{}' \
  https://comics.example.com/rpc/publira.admin.v1.AdminAuditLogService/ListAuditLogs
curl -sI http://comics.example.com/ | grep -i '^location'
```

1つ目のコマンドでは、`web-storefront`が`200`を返します。2つ目ではreadinessの状態が返り、`publira server`とValkeyに接続できていれば`"status":"ok"`になります。3つ目は`publira server`に届き、空のリクエストは`invalid_argument`で拒否されます。4つ目はテナント管理画面のAPIを呼び出しますが、リバースプロキシは転送せずに`404`を返します。最後のコマンドでは、`https://comics.example.com/`へのリダイレクトが返ります。管理画面のホストでも同じコマンドを実行してください。管理画面はAPIをリバースプロキシ経由ではなくクラスター内のネットワークで呼び出すので、管理画面のホストでも管理画面のAPIには`404`が返ります。

確認が済んだら、Kubernetesのページの[ログインする](./index.md#7-ログインする)に戻ってください。
