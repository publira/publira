---
title: Kubernetesでのエッジ
description: Kubernetesクラスター上のインストール環境の前段に、cert-managerが証明書を発行するGatewayまたはIngressを置き、クラスターの外から確認する。
published: 2026-10-29
source_updated: 2026-10-22
---

このページは[Kubernetes](./index.md)の手順6です。[プロセスを起動する](./index.md#4-プロセスを起動する)で作成したServiceの前段に、[インストール環境をセットアップする](./index.md#5-インストール環境をセットアップする)の実行後にエッジを置きます。

エッジは、[エッジが果たすべきこと](../4-edge/index.md#エッジが行うべきこと)の要件どおりに、ホストとパスごとに適切なServiceへルーティングし、TLSを終端し、呼び出し元が選んではならないヘッダーを取り除きます。クラスターでは、Gateway APIを実装したコントローラー上のGatewayとHTTPRoute、またはIngressのどちらかになります。以下では、同じルーティングで両方を示します。

| ホスト | パス | Service |
| --- | --- | --- |
| テナントのドメイン | `/images`、`/rpc/publira.v1.…` | `publira-server`、ポート`8000` |
| テナントのドメイン | `/rpc`のそれ以外 | なし。エッジが`404`を返します |
| テナントのドメイン | それ以外のすべて | `web-storefront`、ポート`3000` |
| テナントの管理画面のホスト | `/images`、`/rpc/publira.v1.…` | `publira-server`、ポート`8000` |
| テナントの管理画面のホスト | `/rpc`のそれ以外 | なし。エッジが`404`を返します |
| テナントの管理画面のホスト | それ以外のすべて | `web-admin`、ポート`4000` |

`/rpc`の下で転送するのは公開API`publira.v1`だけです。[エッジを通るのは公開APIだけ](../4-edge/index.md#エッジを通るのは公開apiだけ)で説明しているとおり、管理画面は自分のAPIをクラスターのネットワーク経由で呼び出すため、エッジはそれ以外に自分で`404`を返します。パスと`Host`ヘッダーは、ブラウザーが送ったとおりにServiceに届きます。どちらも書き換えないでください。

公開APIのプレフィックスはパスセグメントの途中、`v1`の後のドットで終わります。Gatewayの`PathPrefix`もIngressの`Prefix`もセグメント全体で一致を判定するため、どちらもそれだけではこのプレフィックスを指定できません。また、どちらのAPIにも、リクエストに自分で応答する手段がありません。どちらも実装に任されているため、以下の各セクションで、そこで使う実装がそれをどう行うかを説明します。

## 証明書

cert-managerは、Let's EncryptなどのACME発行者から、GatewayまたはIngressが指定するすべてのホスト名について証明書を発行し、更新します。Gatewayを使う場合はGateway APIのサポートを有効にしてcert-managerをインストールします。Helmチャートでは`config.enableGatewayAPI: true`で有効になります。そのうえで、エッジを通じてACMEチャレンジに応答する発行者を作成します。

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

Ingressの場合、ソルバーは代わりに`http01: {ingress: {ingressClassName: <your class>}}`になります。チャレンジは各ホスト名でポート80を通じてエッジに届くため、先にDNSレコードを用意します。

## Gatewayを使う場合

ルートでは、Gateway APIがExtendedとしている機能を2つ使います。Extendedの機能は、サポートしなくても実装がAPIに準拠できるものです。HTTPSへのリダイレクトのための`HTTPRouteSchemeRedirect`と、Webアプリへのリクエストにかけられる時間について実装の制限を外すための`HTTPRouteRequestTimeout`です。各実装がサポートする機能はGateway APIの[Implementations](https://gateway-api.sigs.k8s.io/docs/implementations/)のページで比較されており、各実装の適合性レポートへのリンクがあります。Envoy Gatewayは両方をサポートしています。どちらかがない実装では、その部分を実装が独自のリソースで提供する方法で行うか、代わりに[Ingress](#ingressを使う場合)を使ってください。

ルートでは、Envoy Gateway自体からも2つのものを使います。公開APIのプレフィックスは`RegularExpression`のパスマッチで、その方言と優先順位はGateway APIが各実装に任せています。Envoy GatewayはRE2の式をパス全体に対して照合し、正規表現をプレフィックスより先に試します。`/rpc`のそれ以外への`404`は、Envoy Gateway独自の`HTTPRouteFilter`で、これがリクエストに自分で応答します。

```yaml
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: HTTPRouteFilter
metadata:
  name: not-found
spec:
  directResponse:
    statusCode: 404
```

ほかの実装では、その実装独自の、正規表現でパスを照合する方法と、リクエストに`404`で応答する方法を使ってください。

Gatewayには、ホスト名ごとに1つのHTTPSリスナー（それぞれ証明書を入れるSecretを持ちます）と、1つの平文のHTTPリスナーがあります。HTTPリスナーはHTTPSにリダイレクトし、ACMEチャレンジに応答します。`cert-manager.io/cluster-issuer`アノテーションによって、cert-managerはHTTPSリスナーごとに、リスナーが指定するSecretに証明書を発行します。

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

Webアプリごとに1つのHTTPRouteが、そのアプリのHTTPSリスナーに名前で接続し、ホスト名をリスナーから受け取ります。どのルールも、すべての実装がサポートする`RequestHeaderModifier`フィルターで、リクエストからトレースコンテキストのヘッダー、`Forwarded`、`X-Forwarded-Host`、`X-Forwarded-CountryRegion`を取り除きます。

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

- **公開APIと`404`。** Envoy Gatewayは正規表現を先に試すため、`/rpc/publira\.v1\..*`に一致するパスは`publira-server`に届きます。`/rpc`のそれ以外と`/api`は`not-found`フィルターを持つ`PathPrefix`のルールに落ち、より長いプレフィックスである`/api/v1`はWebアプリに届きます。フィルターを持つルールには`backendRefs`がありません。フィルターが一致するすべてのリクエストに応答し、何も転送されないためです。
- **取り除くヘッダー。** `traceparent`、`tracestate`、`baggage`は、[トレースコンテキスト](../4-edge/index.md#トレースコンテキスト)の要件どおりに取り除きます。Gatewayは、指示しない限り呼び出し元が送った`Forwarded`と`X-Forwarded-Host`を渡し、Publiraは[クライアントのアドレス](../4-edge/index.md#クライアントのアドレス)と[リクエストの送信先のホスト](../4-edge/index.md#リクエストの送信先のホスト)で説明しているとおりその両方を読みます。ここで取り除いておけば、すべてのプロセスで`PUBLIRA_FORWARDED_HEADER_ENABLED`を既定値のままにできます。`X-Forwarded-CountryRegion`は、[読者の地域](../4-edge/index.md#読者の地域)の要件どおりに取り除きます。Envoy Gatewayは自分では地域を調べないため、テナントのGoogleタグゲートウェイはGoogleに地域を送りません。[ECSの前に置くCloudFront](../6-ecs-fargate/1-cloudfront.md#ヘッダー)で示すように、Gatewayの前にあるCDNがこのヘッダーを読者の地域に設定する場合は、`web-storefront`のルールで`remove`からこのヘッダーを外せば、ヘッダーが`web-storefront`に届きます。ただし、これが安全なのは、そのCDNだけがGatewayに接続できる間に限ります。
- **アップロードのタイムアウト。** `timeouts.request: 0s`は、Gateway APIのゼロ期間の定義どおり、Webアプリへのリクエストにかけられる時間の制限を無効にします。これがないと、ルールには実装の既定値が適用され、それははるかに短い場合があります。Envoy Gatewayの既定値は、リクエストが届いてから応答までの15秒です。[テナント管理画面でのアップロード](../4-edge/index.md#テナント管理画面でのアップロード)で説明しているとおり、テナント管理画面でのエピソードのアップロードは、届くまでに最大300秒かかります。Gateway APIでは、`web-admin`がページを保存して応答する前のこの時間も、実装が数えてよいことになっています。Webアプリ自身がリクエストの到着に300秒を与えているため、エッジに独自の制限は必要ありません。Gateway APIにはボディのサイズのフィールドがなく、Envoy Gatewayは独自のポリシーで追加しない限りボディのサイズを制限しません。使う実装がボディのサイズを制限する場合は、管理画面のホストの`/api/v1/episode-pages`で256MiB、テナントのドメインの`/api/v1/webhook/email/`の下で33MiBを許可してください。
- **リダイレクト。** `https-redirect`は`http`リスナーだけに接続し、そこに届いたすべてのリクエストをHTTPSに送ります。証明書の発行中は、cert-managerがチャレンジ用の独自のルートを同じリスナーに追加します。このルートは証明書の対象のホストを指定するため、そのホストへの平文のHTTPリクエストはリダイレクトではなくこのルートが受け取ります。証明書が発行されてルートが削除されると、再びリダイレクトがそれらのリクエストに応答します。

YAMLアンカー`&strip-request-headers`は、ルートのすべてのルールで同じフィルターを繰り返すためのもので、`kubectl apply`が展開します。

## Ingressを使う場合

Ingressは、自身のフィールドではリクエストヘッダーを取り除くこともタイムアウトを設定することもできないため、Ingressによるエッジはその両方をコントローラーに頼ることになります。以下のマニフェストは、IngressコントローラーとしてTraefikを使う場合のもので、Traefikは次の値でHelmチャートからインストールします。

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

そして2つのMiddlewareを使います。1つはヘッダーを取り除くもので、上の`websecure`エントリーポイントが受け取るすべてのリクエストに適用します。もう1つはリクエストが転送される前に`404`で応答するもので、下の`/rpc`のそれ以外のためのIngressがそのパスに適用します。

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

Traefikにはリクエストに応答するだけのMiddlewareがないため、`not-found`は、どの接続の送信元にもならないブロードキャストアドレスを指定した許可リストで、それ以外のすべてのアドレスを`404`で拒否します。`rejectStatusCode`にはTraefik 3.4以降が必要です。

Traefikは、[クライアントのアドレス](#クライアントのアドレス)で説明しているとおり、前にあるホップを信頼するよう指示しない限り、呼び出し元の`X-Forwarded-For`と`X-Forwarded-Host`を自分のものに置き換えるため、どちらも取り除く必要はありません。Traefikは自分では地域を調べないため、[読者の地域](../4-edge/index.md#読者の地域)の要件どおり、すべてのリクエストから`X-Forwarded-CountryRegion`を取り除きます。テナントのGoogleタグゲートウェイはGoogleに地域を送りません。`readTimeout`はリクエストの到着に300秒を与えます。これはエピソードのアップロードに必要です。Traefikはボディのサイズを制限しません。`web`のリダイレクトはACMEチャレンジもHTTPSに送り、認証局はそのリダイレクトに従います。HTTPS側では、証明書がまだ存在しない段階でチャレンジに応答します。ほかのコントローラーでは、これらをそれぞれ、そのコントローラーが独自のアノテーションやリソースで提供する方法で行ってください。

そのうえで、Webアプリごとに1つのIngressがそのホストをルーティングします。Traefikは、`strictPrefixMatching`オプションが有効でない限り、`Prefix`や`ImplementationSpecific`のパスを、セグメント全体ではなく文字列としてのパスのプレフィックスとして照合します。そのため、このオプションは無効のままにしてください。これにより、`/rpc/publira.v1.`でパスセグメントの途中にある公開APIのプレフィックスを指定できます。Ingress APIはこの意味をコントローラーに任せているため、このパスは`ImplementationSpecific`として指定します。セグメント全体で照合するコントローラーでは、そのための独自のアノテーションやリソースが必要です。

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

`cert-manager.io/cluster-issuer`アノテーションによって、cert-managerは各`tls`エントリーのホストについて、エントリーが指定するSecretに証明書を発行します。`api-not-found`にはこのアノテーションがなく、ほかの2つのIngressで発行された証明書を読みます。

`api-not-found`は、両方のホストで`/rpc`のそれ以外を受け取り、`not-found` Middlewareで応答します。Traefikは最も長いルールを先に試すため、`/rpc/publira.v1.`は自分のパスを保持し、Webアプリは`/`を保持します。バックエンドに届くことはなく、Ingressのパスにはバックエンドが必要だから指定しているだけです。バックエンドに`publira-server`ではなくWebアプリを指定しているのは、万一Middlewareがなくなった場合に、パスが管理画面のAPIではなく、そこにページを持たないWebアプリに届くようにするためです。Traefikは`/rpc`を文字列として照合するため、`/rpcabc`のようなパスにも`404`が返ります。そこにページを持つWebアプリもありません。

## クライアントのアドレス

Publiraはすべてのリクエストの背後にいる読者のアドレスを記録し、[クライアントのアドレス](../4-edge/index.md#クライアントのアドレス)で説明しているとおり、エッジが書き込む`X-Forwarded-For`ヘッダーからそれを読みます。クラスターでは、そのアドレスが読者のものになるかどうかを2つのことが決めます。

**読者のアドレスがコントローラーに届く必要があります。** 多くのクラウドのロードバランサーのパススルーモードのように、接続をそのまま転送する`LoadBalancer`タイプのServiceは、ロードバランサーが選んだいずれかのノードを通じて接続を届けます。既定の`externalTrafficPolicy: Cluster`では、接続がコントローラーのPodに届く前に、そのノードが読者のアドレスを自分のアドレスに置き換えます。コントローラーのServiceに`externalTrafficPolicy: Local`を設定して、接続がコントローラーのPodを動かしているノードだけに、送信元アドレスを保ったまま届けられるようにしてください。どこで設定するかはコントローラーによります。Envoy Gatewayは、指示しない限り、Gatewayのために作成するServiceにこれを設定します。上のTraefikの値は、チャートが作成するServiceにこれを設定します。HTTPを自分で終端するロードバランサーは、代わりに読者のアドレスを`X-Forwarded-For`に書き込みます。その場合、信頼すべきなのは下で説明するとおり、そのロードバランサー自身のアドレスです。

**`PUBLIRA_TRUSTED_PROXIES`には、クラスター内のホップを指定します。** コントローラーのPodとWebアプリのPodはPodのアドレスから`publira server`に接続するため、値はPodのアドレス範囲です。[プロセスを起動する](./index.md#4-プロセスを起動する)の`publira-server`と`web-storefront`のDeploymentもそうなっています。未設定の場合はすべてのプライベートな範囲を信頼し、その中にはノードのアドレスも含まれます。すると、`externalTrafficPolicy`が`Cluster`のままだったためにノードのアドレスからコントローラーに届いたリクエストは、呼び出し元が自分の`X-Forwarded-For`に書き込んだ任意のアドレスで記録されます。Podの範囲だけを指定していれば、そのようなリクエストはノードのアドレスで記録されます。その場合、すべての読者が1つのアドレスを共有することになりますが、どの読者もそのアドレスを選ぶことはできません。

**コントローラーの前にあるホップは、2か所で信頼させます。** コントローラーの前でHTTPを終端するロードバランサーやCDNは、[プロキシの前にあるホップ](../4-edge/1-sample-configurations.md#プロキシの前にあるホップ)で説明しているとおり、`X-Forwarded-For`を、呼び出し元の値に追記するのではなく、自分に接続してきたアドレスに設定します。コントローラーはそのヘッダーを渡す必要があります。

- Envoy Gatewayは受け取った`X-Forwarded-For`を保持し、ホップのアドレスを追記するため、設定は必要ありません。
- Traefikは、エントリーポイントがホップを信頼していない限り、このヘッダーを置き換えます。上のHelmの値の`ports.websecure.forwardedHeaders.trustedIPs`に、ホップのアドレスを追加してください。するとTraefikはホップの`X-Forwarded-Host`も保持するようになります。Webアプリはこのヘッダーからテナントを特定するため、ホップはこのヘッダーも設定します。

そのうえで、[信頼するプロキシを設定するとき](../4-edge/index.md#信頼するプロキシを設定する場合)で説明しているとおり、同じアドレスを`PUBLIRA_TRUSTED_PROXIES`にPodの範囲と並べて追加し、`publira server`がホップのアドレスを飛ばしてホップの指定したアドレスを採用するようにします。コントローラー側の設定がないと、`PUBLIRA_TRUSTED_PROXIES`をどう設定しても、すべての読者がホップのアドレスで記録されます。信頼するのはホップ自身のアドレスだけにしてください。読者からも届くアドレス範囲を信頼すると、どの読者も好きなアドレスを名乗れてしまいます。

## エッジを確認する

エッジのServiceにアドレスが割り当てられたら、DNSレコードをそのアドレスに向け、証明書を待ちます。`kubectl get certificate`では、発行された証明書がそれぞれ`True`と表示されます。そのうえで、クラスターの外からルーティングを確認します。

```bash
curl -sI https://comics.example.com/ | head -1
curl -s https://comics.example.com/readyz
curl -s -X POST -H 'Content-Type: application/json' -d '{}' \
  https://comics.example.com/rpc/publira.v1.TenantService/GetTenant
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{}' \
  https://comics.example.com/rpc/publira.admin.v1.AdminAuditLogService/ListAuditLogs
curl -sI http://comics.example.com/ | grep -i '^location'
```

1つ目は`web-storefront`から`200`が返ります。2つ目はreadinessを返し、`publira server`とValkeyに到達できれば`"status":"ok"`になります。3つ目は`publira server`に届き、空のリクエストが`invalid_argument`で拒否されます。4つ目はテナント管理画面のAPIを呼び出し、エッジが転送せずに`404`を返します。最後は`https://comics.example.com/`へのリダイレクトを返します。管理画面のホストでも同じことを実行してください。管理画面はそのAPIをエッジ経由ではなくクラスターのネットワーク経由で呼び出すため、そこでも管理画面のAPIには`404`が返ります。

確認が済んだら、Kubernetesのページの[ログインする](./index.md#7-ログインする)に戻ってください。
