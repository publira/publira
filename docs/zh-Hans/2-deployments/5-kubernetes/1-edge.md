---
title: Kubernetes上的边缘
description: 在Kubernetes集群上的安装实例前方部署Gateway或Ingress，由cert-manager签发其证书，并从集群外部进行检查。
published: 2026-11-03
source_updated: 2026-10-31
---

本页是[Kubernetes](./index.md)的第6步：在[设置安装实例](./index.md#5-设置安装实例)运行完成后，把边缘部署在[启动进程](./index.md#4-启动进程)所创建的Service前方。

边缘把每个主机名和路径路由到正确的Service，终止TLS，并移除调用方不得自行指定的请求头，这是[边缘必须做什么](../4-edge/index.md#边缘必须做什么)所要求的。在集群上，它要么是在实现了Gateway API的控制器上运行的Gateway及其HTTPRoute，要么是Ingress。下面两种都会介绍，路由相同：

| 主机名 | 路径 | Service |
| --- | --- | --- |
| 租户的域名 | `/images`、`/rpc/publira.v1.…` | `publira-server`，端口`8000` |
| 租户的域名 | `/rpc`的其余部分 | 无：边缘返回`404` |
| 租户的域名 | 其他所有路径 | `web-storefront`，端口`3000` |
| 租户的控制台主机名 | `/images`、`/rpc/publira.v1.…` | `publira-server`，端口`8000` |
| 租户的控制台主机名 | `/rpc`的其余部分 | 无：边缘返回`404` |
| 租户的控制台主机名 | 其他所有路径 | `web-admin`，端口`4000` |

在`/rpc`之下，只转发公开API `publira.v1`：控制台通过集群网络调用它们自己的API，所以边缘对其余请求自行返回`404`，原因见[只有公开API经过边缘](../4-edge/index.md#只有公开api经过边缘)。路径和`Host`请求头要按浏览器发送时的原样到达Service；不要对两者做任何改写。

公开API的前缀结束于一个路径段的中间，即`v1`之后的点号处，而Gateway的`PathPrefix`和Ingress的`Prefix`都按完整的路径段匹配，所以两者都无法单独表示它。两种API也都没有自行应答请求的方法。这两件事都留给了具体实现，下面每一节都会说明其所用的实现如何做到。

## 证书

cert-manager从Let's Encrypt等ACME签发者，为Gateway或Ingress中指定的每个主机名签发并续期证书。如果使用Gateway，请在安装cert-manager时开启其Gateway API支持（在其Helm chart中通过`config.enableGatewayAPI: true`开启），并创建一个通过边缘应答ACME质询的签发者：

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

如果使用Ingress，solver改为`http01: {ingress: {ingressClassName: <your class>}}`。质询会通过每个主机名的80端口到达边缘，所以要先设置DNS记录。

## 使用Gateway

这些路由用到了Gateway API标记为Extended的两项功能，实现即使不支持它们也可以符合该API：用于重定向到HTTPS的`HTTPRouteSchemeRedirect`，以及用于解除实现对Web应用请求耗时限制的`HTTPRouteRequestTimeout`。Gateway API的[Implementations](https://gateway-api.sigs.k8s.io/docs/implementations/)页面比较了各实现支持的功能，并链接到各自的一致性报告。Envoy Gateway两者都支持。在缺少其中一项的实现上，请用它自己的资源所提供的手段完成这一部分，或者改用[Ingress](#使用ingress)。

这些路由还用到了Envoy Gateway本身的两项功能。公开API的前缀是一个`RegularExpression`路径匹配，其正则方言和优先级由Gateway API交给各实现决定：Envoy Gateway用RE2表达式匹配整个路径，并且先尝试正则表达式，再尝试前缀。`/rpc`其余部分的`404`由它自己的`HTTPRouteFilter`自行应答请求：

```yaml
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: HTTPRouteFilter
metadata:
  name: not-found
spec:
  directResponse:
    statusCode: 404
```

在其他实现上，请使用它自己按正则表达式匹配路径、以及用`404`应答请求的方式。

Gateway为每个主机名设置一个HTTPS监听器，每个监听器指定存放其证书的Secret；另有一个普通HTTP监听器，负责重定向到HTTPS并应答ACME质询。`cert-manager.io/cluster-issuer`注解让cert-manager为每个HTTPS监听器签发证书，并存入该监听器指定的Secret：

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

每个Web应用对应一个HTTPRoute，按名称挂接到该应用的HTTPS监听器，并从中获取主机名。每条规则都用所有实现都支持的`RequestHeaderModifier`过滤器，从请求中移除追踪上下文请求头、`Forwarded`、`X-Forwarded-Host`和`X-Forwarded-CountryRegion`：

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

- **公开API和`404`**。匹配`/rpc/publira\.v1\..*`的路径会到达`publira-server`，因为Envoy Gateway先尝试正则表达式；`/rpc`的其余部分落入带有`not-found`过滤器的`PathPrefix`规则，而`/api`与其他所有路径一样到达Web应用。带有该过滤器的规则没有`backendRefs`：过滤器应答与之匹配的每个请求，不会转发任何内容。
- **移除的请求头**。`traceparent`、`tracestate`和`baggage`按照[追踪上下文](../4-edge/index.md#追踪上下文)的要求移除。除非另行设置，Gateway会把调用方发送的`Forwarded`和`X-Forwarded-Host`原样传递下去，而Publira会读取两者，如[客户端地址](../4-edge/index.md#客户端地址)和[请求所发往的主机](../4-edge/index.md#请求所发往的主机)所述；在这里移除它们，就可以让每个进程的`PUBLIRA_FORWARDED_HEADER_ENABLED`保持默认值。`X-Forwarded-CountryRegion`按照[读者所在地区](../4-edge/index.md#读者所在地区)的要求移除：Envoy Gateway不会自行查询地区，所以租户的Google tag gateway不会向Google发送任何地区。如果Gateway前方有CDN把该请求头设置为读者所在的地区（如[ECS前方的CloudFront](../6-ecs-fargate/1-cloudfront.md#请求头)所示），那么只要`web-storefront`的规则把它从`remove`中去掉，它就会随请求到达`web-storefront`；但只有当该CDN是唯一能连接到Gateway的组件时，这样做才是安全的。
- **上传超时**。`timeouts.request: 0s`按照Gateway API对零时长的定义，关闭对Web应用请求耗时的限制。没有它，规则会采用实现的默认值，而默认值可能短得多：Envoy Gateway的默认值是请求到达后15秒内必须应答。租户控制台中的章节上传可能需要最多300秒才能完整到达，如[租户控制台中的上传](../4-edge/index.md#租户控制台中的上传)所述，而Gateway API允许实现把这段时间也计算在内，即在`web-admin`保存页面并应答之前的时间。Web应用本身会给请求300秒的到达时间，所以边缘不需要自己的限制。Gateway API没有表示请求体大小的字段，Envoy Gateway除非由它自己的策略添加，否则不限制请求体大小；如果您的实现确实有此限制，请在控制台主机名的`/api/v1/episode-pages`上允许256 MiB，在租户域名的`/api/v1/webhook/email/`下允许33 MiB。
- **重定向**。`https-redirect`只挂接到`http`监听器，把那里的每个请求都发送到HTTPS。在签发证书期间，cert-manager会在同一个监听器上添加它自己的路由来处理质询。该路由指定证书所针对的主机名，因此会从重定向中接管该主机名的普通HTTP请求；证书签发完毕、该路由被移除后，重定向会重新应答这些请求。

YAML锚点`&strip-request-headers`在路由的每条规则上重复同一个过滤器；`kubectl apply`会将其展开。

## 使用Ingress

Ingress无法用其自身的字段移除请求头或设置超时，所以Ingress边缘的这两件事都依赖其控制器。下面的清单使用Traefik作为Ingress控制器，它通过Helm chart安装，并使用以下values：

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

另外还有两个Middleware：一个移除请求头，由上面的`websecure`入口点应用于它收到的每个请求；另一个在请求被转发之前以`404`应答，由下面处理`/rpc`其余部分的Ingress应用于其路径：

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

Traefik没有只负责应答请求的Middleware，所以`not-found`是一个只列出广播地址的允许列表（没有任何连接来自该地址），并以`404`拒绝其他所有地址。`rejectStatusCode`需要Traefik 3.4或更高版本。

除非告诉Traefik信任其前方的某一跳，否则它会用自己的值替换调用方的`X-Forwarded-For`和`X-Forwarded-Host`，如[客户端地址](#客户端地址)所述，所以这两个请求头都不需要移除。Traefik不会自行查询地区，所以按照[读者所在地区](../4-edge/index.md#读者所在地区)的要求从每个请求中移除`X-Forwarded-CountryRegion`，租户的Google tag gateway也就不会向Google发送任何地区。`readTimeout`给请求300秒的到达时间，这是章节上传所需要的；Traefik不限制请求体的大小。`web`上的重定向也会把ACME质询发送到HTTPS，证书颁发机构会跟随到那里，质询在证书存在之前就会在那里得到应答。在其他控制器上，请用它自己的注解或资源完成上述每一项。

然后每个Web应用对应一个Ingress，负责路由其主机名。除非开启了`strictPrefixMatching`选项，Traefik会把`Prefix`或`ImplementationSpecific`路径作为路径字符串的前缀来匹配，而不是按完整的路径段匹配，所以请保持该选项关闭。正因如此，`/rpc/publira.v1.`才能表示结束于路径段中间的公开API前缀；它以`ImplementationSpecific`给出，因为Ingress API把这种含义留给控制器决定。按完整路径段匹配的控制器需要为此使用它自己的注解或资源。

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

`cert-manager.io/cluster-issuer`注解让cert-manager为每个`tls`条目中的主机名签发证书，并存入该条目指定的Secret。`api-not-found`没有这个注解，它读取另外两个Ingress签发的证书。

`api-not-found`接管两个主机名上`/rpc`的其余部分，并用`not-found` Middleware应答。Traefik先尝试最长的规则，所以`/rpc/publira.v1.`保留其路径，Web应用保留`/`。后端永远不会被访问到，之所以存在，是因为Ingress路径必须有后端：它指定的是Web应用而不是`publira-server`，这样一旦该Middleware缺失，这些路径到达的是在该处没有页面的Web应用，而不是控制台的API。Traefik把`/rpc`作为字符串匹配，所以`/rpcabc`这样的路径也会得到`404`应答；没有任何Web应用在那里有页面。

## 客户端地址

Publira会记录每个请求背后的读者地址，并从边缘写入的`X-Forwarded-For`请求头中读取它，如[客户端地址](../4-edge/index.md#客户端地址)所述。在集群上，该地址是否是读者的地址取决于两件事。

**读者的地址必须到达控制器**。`LoadBalancer`类型的Service如果按原样转发连接（大多数云负载均衡器在直通模式下都是如此），会经由负载均衡器选中的某个节点送达连接；在默认的`externalTrafficPolicy: Cluster`下，该节点会在连接到达控制器的Pod之前，把读者的地址替换为它自己的地址。请在控制器的Service上设置`externalTrafficPolicy: Local`，这样连接只会送达运行着控制器Pod的节点，并保留其源地址。在哪里设置由控制器决定：Envoy Gateway除非另行设置，会在它为Gateway创建的Service上设置该值；上面的Traefik values则在chart创建的Service上设置它。自己终止HTTP的负载均衡器会改为把读者的地址写入`X-Forwarded-For`，这时要信任的就是负载均衡器自己的地址，见下文。

**`PUBLIRA_TRUSTED_PROXIES`指定集群内部的各跳**。控制器的Pod和Web应用的Pod都从Pod地址连接`publira server`，所以该值就是Pod地址范围，如[启动进程](./index.md#4-启动进程)中的`publira-server`和`web-storefront` Deployment所示。如果不设置，它会信任所有私有地址范围，其中包括节点的地址；这时，如果因为`externalTrafficPolicy`保留为`Cluster`而使请求从节点地址到达控制器，该请求就会以调用方在自己的`X-Forwarded-For`中写入的任意地址被记录。只设置Pod范围时，这样的请求会以节点的地址被记录：所有读者共用同一个地址，但没有人能自行选择它。

**控制器前方的一跳要在两个地方被信任**。在控制器前方终止HTTP的负载均衡器或CDN，会把`X-Forwarded-For`设置为连接到它的地址，而不是追加到调用方的值之后，如[代理前面的一跳](../4-edge/1-sample-configurations.md#代理前面的一跳)所述。控制器必须把该请求头传递下去：

- Envoy Gateway会保留它收到的`X-Forwarded-For`并追加该跳的地址，所以不需要任何设置。
- 除非入口点信任该跳，Traefik会替换该请求头。请在上面的Helm values中，把该跳的地址添加到`ports.websecure.forwardedHeaders.trustedIPs`下。这样Traefik也会保留该跳的`X-Forwarded-Host`，而Web应用要靠它找到租户，所以该跳也要设置这个请求头。

然后把相同的地址添加到`PUBLIRA_TRUSTED_PROXIES`中，与Pod范围并列，让`publira server`跳过该跳的地址，取用它所指明的地址，如[何时设置受信任的代理](../4-edge/index.md#何时设置受信任的代理)所述。如果控制器没有相应设置，无论`PUBLIRA_TRUSTED_PROXIES`如何设置，所有读者都会以该跳的地址被记录。只信任该跳自身的地址：如果可信范围也覆盖到读者，任何读者都能指定自己想要的地址。

## 检查边缘

边缘的Service获得地址后，把DNS记录指向该地址，然后等待证书签发：`kubectl get certificate`会在每个证书签发后显示`True`。然后从集群外部检查路由：

```bash
curl -sI https://comics.example.com/ | head -1
curl -s https://comics.example.com/readyz
curl -s -X POST -H 'Content-Type: application/json' -d '{}' \
  https://comics.example.com/rpc/publira.v1.TenantService/GetTenant
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{}' \
  https://comics.example.com/rpc/publira.admin.v1.AdminAuditLogService/ListAuditLogs
curl -sI http://comics.example.com/ | grep -i '^location'
```

第一条命令由`web-storefront`返回`200`；第二条返回其就绪状态，在它能访问`publira server`和Valkey后为`"status":"ok"`。第三条到达`publira server`，后者以`invalid_argument`拒绝这个空请求。第四条调用租户控制台的API，边缘不转发它，直接返回`404`。最后一条返回到`https://comics.example.com/`的重定向。在控制台主机名上运行同样的命令，控制台的API在那里也会返回`404`：控制台通过集群网络调用它，而不是经过边缘。

然后回到Kubernetes页面的[登录](./index.md#7-登录)。
