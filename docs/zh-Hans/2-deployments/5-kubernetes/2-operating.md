---
title: 在Kubernetes上运维
description: 为在Kubernetes集群上运行的安装实例添加租户、让控制台的凭据远离租户的域名、分开提供图片和公开API、公开指标，以及升级。
published: 2026-11-03
updated: 2026-11-05
source_updated: 2026-11-05
---

本页介绍[Kubernetes](./index.md)让安装实例投入使用之后，对它所做的各项更改。每项更改都会修改该页和[Kubernetes上的边缘](./1-edge.md)所创建的资源。

## 添加租户

使用`publiractl tenant create`或在平台控制台中创建的租户，需要在边缘上配置它的两个主机名，如[添加租户](../4-edge/index.md#添加租户)所述。在集群上，具体做法如下：

- **使用Gateway时**：在Gateway上添加两个HTTPS监听器，一个用于租户的域名，一个用于其控制台主机名，每个监听器使用各自的Secret名称，并把每个监听器的名称加入其Web应用的HTTPRoute的`parentRefs`。cert-manager根据Gateway的注解签发这两个证书。一个Gateway最多容纳64个监听器，所以除了`http`监听器之外，一个Gateway最多服务31个租户；之后的租户请放在单独的Gateway上，并使用单独的HTTPRoute。
- **使用Ingress时**：把域名添加到`web-storefront` Ingress的`tls`条目和规则中，把控制台主机名添加到`web-admin`的相应位置，并把两者都添加到`api-not-found`的相应位置。借助[使用Ingress](./1-edge.md#使用ingress)中的YAML锚点（`&storefront-paths`、`&admin-paths`、`&not-found-paths`），新规则可以用`paths: *storefront-paths`复用这些路径。`tls`条目变更后，cert-manager会为新的名称签发证书。

在应用更改之前，先把这两个名称都指向边缘的地址，以便cert-manager的质询能够到达边缘。

## 让控制台的凭据远离租户的域名

边缘已经让控制台的API无法从互联网访问（[API密钥可调用的读取请求](../4-edge/index.md#api密钥可调用的读取请求)除外），但边缘把租户域名转发到的`publira-server`仍然提供这些API，并为此持有它们的数据库登录和Web服务令牌。要把这三者都从读者能够访问的进程中移出（这是独立于边缘规则的另一层防护，如[只有公开API经过边缘](../4-edge/index.md#只有公开api经过边缘)所述），请运行第二个使用`--role storefront`的Deployment，并把租户的域名和`web-storefront`路由到它。拆分后，读者流量也可以独立于控制台进行扩缩，因为每个Deployment都有自己的副本，如[按角色拆分服务器](../7-scaling-out.md#按角色拆分服务器)所述：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: publira-storefront
spec:
  replicas: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: publira-storefront
  template:
    metadata:
      labels:
        app.kubernetes.io/name: publira-storefront
    spec:
      terminationGracePeriodSeconds: 45
      containers:
        - name: publira-storefront
          image: ghcr.io/publira/publira:<tag>
          args: ["server", "--role", "storefront"]
          lifecycle:
            preStop:
              sleep:
                seconds: 5
          ports:
            - name: http
              containerPort: 8000
          envFrom:
            - secretRef:
                name: publira-encryption
            - secretRef:
                name: publira-storefront
          env:
            - name: PUBLIRA_WEB_STOREFRONT_INTERNAL_URL
              value: http://web-storefront:3000
            - name: PUBLIRA_WEB_ADMIN_INTERNAL_URL
              value: http://web-admin:4000
            - name: PUBLIRA_TRUSTED_PROXIES
              value: 10.244.0.0/16
          livenessProbe:
            httpGet:
              path: /livez
              port: http
          readinessProbe:
            httpGet:
              path: /readyz
              port: http
            timeoutSeconds: 8
---
apiVersion: v1
kind: Service
metadata:
  name: publira-storefront
spec:
  selector:
    app.kubernetes.io/name: publira-storefront
  ports:
    - name: http
      port: 8000
      targetPort: http
```

它的Secret保存它所读取的`publira server`的值，其中不包括Web服务令牌，也不包括`publira_public`以外的任何连接。请在您[创建其他Secret](./index.md#1-创建secret)时使用的那个shell中创建它，那里仍保存着这些值：

```bash
kubectl create secret generic publira-storefront \
  --from-literal=PUBLIRA_AUTH_JWT_SECRET="$AUTH_JWT_SECRET" \
  --from-literal=PUBLIRA_REVALIDATE_TOKEN="$REVALIDATE_TOKEN" \
  --from-literal=PUBLIRA_REDIS_URL="$REDIS_URL" \
  --from-literal=PUBLIRA_PUBLIC_DB_URL="postgres://publira_public:$PUBLIC_DB_PASSWORD@$DB"
```

然后只在租户域名上，在`web-storefront`的HTTPRoute或Ingress中，把`/images`和`/rpc`下公开API的后端从`publira-server`改为`publira-storefront`；并让`web-storefront`也指向它，因为它只调用公开API：在其Deployment中把`PUBLIRA_GRPC_URL`设置为`http://publira-storefront:8000/rpc`。控制台主机名的路由、`web-admin`和`web-platform`继续调用提供所有角色的`publira-server`，直到[让控制台的服务器不提供公开API](#让控制台的服务器不提供公开api)把公开API从它上面移除。

无论哪种情况，边缘在每个主机名上都会对大部分控制台API返回`404`，所以改为从集群内部调用这两个Service来检查：

```bash
for service in publira-storefront publira-server; do
  kubectl run publira-role-check --rm -i --restart=Never --image=curlimages/curl -- \
    -s -o /dev/null -w "$service %{http_code}\n" -X POST -H 'Content-Type: application/json' -d '{}' \
    "http://$service:8000/rpc/publira.admin.v1.AdminAuditLogService/ListAuditLogs"
done
```

`publira-storefront`返回`404`，因为它不提供该API。`publira-server`返回`400`：该API在那里提供，并拒绝了这个空请求。

### 让控制台的服务器不提供公开API

`publira-server`仍然提供公开API并持有`publira_public`，因为`web-admin`会调用公开API获取租户的主题和标签，而控制台主机名的路由会把公开API转发到那里。把两者都发送到`publira-storefront`后，`publira-server`就可以以`--role admin,platform`运行，如[按角色拆分服务器](../7-scaling-out.md#按角色拆分服务器)的第4步所述。请按以下顺序进行更改，以确保`publira-server`停止提供公开API时，已经没有任何组件再向它发送公开API请求。

首先，让`web-admin`的公开API调用指向storefront的Service。在其Deployment的`env`中添加该变量（与继续指向`publira-server`的`PUBLIRA_GRPC_URL`并列），然后应用：

```yaml
- name: PUBLIRA_PUBLIC_GRPC_URL
  value: http://publira-storefront:8000/rpc
```

此后它的`/readyz`也会以`public-api`的名义检查该Service。

然后把控制台主机名的公开API路由到`publira-storefront`（它在任何主机名上都会应答），而`/images`保留在`publira-server`上，因为控制台页面显示的图片属于`admin`角色。在`web-admin` HTTPRoute中，把第一条规则拆成两条：

```yaml
- matches:
    - path: { type: PathPrefix, value: /images }
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
    - path: { type: RegularExpression, value: '/rpc/publira\.v1\..*' }
  filters: *strip-request-headers
  backendRefs:
    - name: publira-storefront
      port: 8000
```

如果使用`web-admin` Ingress，则改为把`/rpc/publira.v1.`路径的后端改成`publira-storefront`。

最后，在`publira-server.yaml`中为`publira-server`容器设置`args: ["server", "--role", "admin,platform"]`，从它的Secret中删除`PUBLIRA_PUBLIC_DB_URL`（没有其他组件从这里读取它），然后应用该Deployment：

```bash
kubectl patch secret publira-server --type=json \
  -p '[{"op":"remove","path":"/data/PUBLIRA_PUBLIC_DB_URL"}]'
kubectl apply -f publira-server.yaml
kubectl rollout status deployment/publira-server
```

确认`publira-server`不再提供公开API。下面的调用会返回`404`，而之前返回的是`400`：

```bash
kubectl run publira-role-check --rm -i --restart=Never --image=curlimages/curl -- \
  -s -o /dev/null -w "%{http_code}\n" -X POST -H 'Content-Type: application/json' -d '{}' \
  "http://publira-server:8000/rpc/publira.v1.TenantService/GetTenant"
```

登录租户控制台：它会像之前一样显示租户的主题并列出标签，只是现在从`publira-storefront`读取。

## 分开提供图片和公开API

租户的图片和公开API可以使用各自的主机名访问，各自经过单独的负载均衡器，如[分开提供图片和公开API](../7-scaling-out.md#分开提供图片和公开api)所述。在使用Gateway的集群上，每个Gateway都是一个单独的负载均衡器，所以图片使用第二个Gateway，位于图片专用的Deployment前方；公开API则在现有的Gateway上使用一个主机名，位于`publira-storefront`前方。本节建立在创建了`publira-storefront`的[让控制台的凭据远离租户的域名](#让控制台的凭据远离租户的域名)之上。下面的名称只是示例：`images.comics.example.com`是租户的图片主机，`api.example.com`是公开API的主机名。

### 图片

让图片在单独的Deployment上运行，使其流量可以独立于API进行扩缩。把`publira-storefront`的Deployment和Service复制到`publira-images.yaml`中，在名称、标签、selector和容器名称中把`publira-storefront`改为`publira-images`，并保留`secretRef: {name: publira-storefront}`：两者提供相同的角色，读取相同的Secret。然后应用它：

```bash
kubectl apply -f publira-images.yaml
kubectl rollout status deployment/publira-images
```

为图片主机提供单独的Gateway，每个图片主机一个HTTPS监听器，再加一个HTTPRoute，只把这些主机上的`/images`转发到`publira-images`，不转发其他任何内容。没有规则匹配的路径由Gateway自身返回`404`：

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: publira-images
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
spec:
  gatewayClassName: <your class>
  listeners:
    - name: http
      protocol: HTTP
      port: 80
    - name: images-comics-example-com
      protocol: HTTPS
      port: 443
      hostname: images.comics.example.com
      tls:
        certificateRefs:
          - name: images-comics-example-com-tls
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: images
spec:
  parentRefs:
    - name: publira-images
      sectionName: images-comics-example-com
  rules:
    - matches:
        - path: { type: PathPrefix, value: /images }
      filters:
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
        - name: publira-images
          port: 8000
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: images-https-redirect
spec:
  parentRefs:
    - name: publira-images
      sectionName: http
  rules:
    - filters:
        - type: RequestRedirect
          requestRedirect:
            scheme: https
            statusCode: 301
```

该过滤器移除的请求头与其他路由相同，原因见[使用Gateway](./1-edge.md#使用gateway)。cert-manager在新Gateway的`http`监听器上应答图片主机的ACME质询，所以请把它添加到`letsencrypt`签发者的solver的`parentRefs`中，与[证书](./1-edge.md#证书)中设置的那个并列：

```yaml
parentRefs:
  - name: publira
    namespace: publira
    kind: Gateway
    sectionName: http
  - name: publira-images
    namespace: publira
    kind: Gateway
    sectionName: http
```

把每个图片主机指向新Gateway的地址，等待其证书签发，然后在平台控制台的**图片主机**中或通过`publiractl tenant update --image-domain`把它交给租户，如[图片主机](../../3-operations/2-tenants.md#图片主机)所述。之后添加的租户，要在`publira-images`上为其图片主机添加一个监听器，并把该监听器的名称加入`images` HTTPRoute的`parentRefs`。

### 公开API

在`publira` Gateway上为公开API提供单独的主机名，再加一个HTTPRoute，只把该主机名上的公开API转发到`publira-storefront`，不转发其他任何内容。把监听器添加到Gateway的`listeners`中：

```yaml
- name: api-example-com
  protocol: HTTPS
  port: 443
  hostname: api.example.com
  tls:
    certificateRefs:
      - name: api-example-com-tls
```

然后应用该路由：

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: public-api
spec:
  parentRefs:
    - name: publira
      sectionName: api-example-com
  rules:
    - matches:
        - path: { type: RegularExpression, value: '/rpc/publira\.v1\..*' }
      filters:
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
        - name: publira-storefront
          port: 8000
```

Web应用已经通过集群网络调用`publira-storefront`，不经过负载均衡器：`web-storefront`通过`PUBLIRA_GRPC_URL`调用，`web-admin`在完成[让控制台的服务器不提供公开API](#让控制台的服务器不提供公开api)后通过`PUBLIRA_PUBLIC_GRPC_URL`调用；在集群外运行的Web应用则改为指定`https://api.example.com/rpc`。租户拥有图片主机后，用`PUBLIRA_BASE_URL=https://api.example.com`构建该租户的移动应用，如[应用连接的地址](../../5-mobile-app/2-building.md#应用连接的地址)所述。租户域名的路由保持不变，所以针对租户域名构建的应用仍可继续使用。

### 使用Ingress

同一类的所有Ingress都通过其控制器的Service访问，而该Service就是一个负载均衡器。可以为图片主机另设一个使用独立类的控制器，用[使用Ingress](./1-edge.md#使用ingress)中的values安装；也可以把它们保留在现有的控制器上，[租户的图片主机](../4-edge/index.md#租户的图片主机)同样允许这样做。无论哪种方式，都由一个Ingress负责路由，而这些主机上的其他所有路径，由于没有规则指定，都由Traefik自行返回`404`：

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: publira-images
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
spec:
  ingressClassName: traefik
  tls:
    - hosts: [images.comics.example.com]
      secretName: images-comics-example-com-tls
  rules:
    - host: images.comics.example.com
      http:
        paths:
          - path: /images
            pathType: Prefix
            backend:
              { service: { name: publira-images, port: { number: 8000 } } }
```

公开API的主机名是现有控制器上另一个结构相同的Ingress，其主机名为`api.example.com`，唯一的路径是以`ImplementationSpecific`指向`publira-storefront`的`/rpc/publira.v1.`。

### 检查拆分结果

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://images.comics.example.com/
curl -s -X POST -H 'Content-Type: application/json' -d '{}' \
  https://api.example.com/rpc/publira.v1.TenantService/GetTenant
curl -s -o /dev/null -w '%{http_code}\n' https://api.example.com/images/
```

第一条返回`404`：图片主机只提供图片。第二条到达`publira-storefront`，后者以`invalid_argument`拒绝这个空请求。第三条也返回`404`：API的主机名不提供图片。然后打开租户的网站：其图片从`https://images.comics.example.com/images/…`加载。

## 指标

在[指标](../../3-operations/11-monitoring.md#指标)中通过`PUBLIRA_METRICS_ENABLED=true`、`OTEL_METRICS_EXPORTER=prometheus`和`OTEL_EXPORTER_PROMETHEUS_HOST=0.0.0.0`开启后，`publira server`和`publira worker`会在端口`9464`上提供Prometheus指标。在[启动进程](./index.md#4-启动进程)中，两者各自运行在单独的Pod中，所以各自监听该端口不会冲突。如果一个Pod以两个容器运行两者，它们共享一个网络命名空间，后启动的那个无法监听先启动的那个已占用的端口：请为每个容器设置各自的`OTEL_EXPORTER_PROMETHEUS_PORT`，或者让它们保持在各自的Pod中。

## 升级

[升级](../8-upgrading.md)把安装实例升级到新版本：先备份，再用新版本的`publiractl`执行迁移和创建角色，然后是各进程。请先阅读该页及发布说明。在集群上，其步骤如下：

1. **停止进程**：如果您决定先停止进程（权衡见[决定是否先停止进程](../8-upgrading.md#决定是否先停止进程)），就把安装实例的每个Deployment缩容到零：

   ```bash
   kubectl scale deployment --all --replicas=0
   kubectl wait --for=delete pod -l app.kubernetes.io/name --timeout=2m
   ```

   该标签会选中安装实例每个Deployment的Pod，而不包括Job的Pod，后者已经结束，只是为了保留日志而留存。

2. **备份数据库**：从能访问数据库的主机上使用`pg_dump`，或者对托管数据库做快照，如[备份数据库](../8-upgrading.md#1-备份数据库)所述。
3. **应用迁移并创建角色**：如果上一个版本的Job仍然存在，请删除它们，因为Job无法修改；然后把[应用迁移](./index.md#2-应用迁移)和[创建角色](./index.md#3-创建角色)这两个Job中的`<tag>`改为新版本，并按此顺序运行，等待每个Job完成：

   ```bash
   kubectl delete job publira-db-migrate publira-db-roles --ignore-not-found
   ```

   角色Job会为每个角色设置`publira-db-roles`中为其保存的密码，也就是该角色现有的密码，所以它可以在标志不变的情况下运行。如果新版本添加了角色，则需要把该角色的密码加入`publira-db-roles`，并添加其标志。

4. **启动新版本**：修改每个Deployment中的`<tag>`，添加发布说明中列出的变量，然后应用它们。应用清单会恢复您缩容到零的副本数。
5. **检查安装实例**，如[检查安装实例](../8-upgrading.md#5-检查安装实例)所述。

如果改为在升级期间让进程保持运行，第4步按照[替换进程](../8-upgrading.md#4-替换进程)给出的顺序替换它们。如果运行了`email-renderer`，请先应用它，然后应用其他Deployment；这些Deployment会每次滚动更新一个副本，期间安装实例持续提供服务。
