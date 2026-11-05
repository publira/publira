---
title: 示例配置
description: 仓库中实现边缘各项要求的Traefik、nginx和Caddy示例配置，以及如何让其中一个适配您的安装实例。
published: 2026-11-03
updated: 2026-11-05
source_updated: 2026-11-05
---

仓库附带三份反向代理的示例配置，它们按照[边缘必须做什么](./index.md#边缘必须做什么)的要求路由请求，并处理请求头、请求体和超时：Traefik、nginx和Caddy各一份。有一项要求仍需由运行示例的安装实例自行完成：TLS监听器，Traefik和nginx示例留给您添加，而Caddy示例在获得要通过HTTPS提供服务的主机名后会自行添加。它们只是示例，而不是边缘的定义。[Docker Compose](../3-docker-compose.md)安装实例运行的是Caddy示例，而运行自有代理的安装实例可以从其中任何一个开始。由托管负载均衡器、Ingress或Gateway构成的边缘只需遵循这些要求，不需要任何示例；[Kubernetes上的边缘](../5-kubernetes/1-edge.md)展示了满足要求的Gateway和Ingress，[ECS前方的CloudFront](../6-ecs-fargate/1-cloudfront.md)则展示了位于Application Load Balancer前面的CloudFront。

| 代理 | 文件 | 后端地址写在哪里 | 是否自行获取证书 |
| --- | --- | --- | --- |
| Traefik | [`infra/proxy/traefik/`](https://github.com/publira/publira/tree/main/infra/proxy/traefik) | `dynamic/services.yaml` | 是，需添加ACME解析器 |
| nginx | [`infra/proxy/nginx/`](https://github.com/publira/publira/tree/main/infra/proxy/nginx) | `upstreams.conf` | 否 |
| Caddy | [`infra/proxy/caddy/Caddyfile`](https://github.com/publira/publira/blob/main/infra/proxy/caddy/Caddyfile) | `PUBLIRA_UPSTREAM_*`环境变量 | 是，为`PUBLIRA_EDGE_TLS_HOSTS`中的主机名获取 |

请从您要安装的版本中获取所用示例的文件。[路由约定](https://github.com/publira/publira/blob/main/infra/proxy/README.md)逐条说明了三者的共同规则。

## 每个示例做了什么

- **路由**。每个示例都会路由四个列表中的主机名（按[主机列表](#主机列表)所述的方式提供），在每个主机上应用[路由](./index.md#路由)中的路径规则，并用自己的404应答`/rpc`的其余部分。在租户的图片主机上，它只转发`/images`，并用自己的404应答其他所有路径，这正是[租户的图片主机](./index.md#租户的图片主机)留给边缘决定的部分。不在任何列表中的主机什么也到达不了：示例在所有路径上都用自己的404应答它。这是示例的选择，而不是Publira的要求。
- **客户端地址**。Traefik设置`X-Forwarded-For`，并通过`strip-forwarded`中间件移除`Forwarded`。nginx和Caddy将`Forwarded`设为只包含客户端地址，并移除`X-Forwarded-For`。在它们中任何一个后面，都请保持`PUBLIRA_FORWARDED_HEADER_ENABLED`为启用状态。
- **主机**。每个示例都原样传递`Host`，并自行设置`X-Forwarded-Host`和`X-Forwarded-Proto`，而不是传递调用方的值，但它所信任的[前面的一跳](#代理前面的一跳)除外。
- **追踪上下文**。每个示例都会移除这三个请求头。Traefik通过`strip-trace-context`中间件来做，每个入口点除了`strip-forwarded`之外还需要它。
- **读者所在地区**。没有示例会自行查询地区，因此每个示例都会从每个请求中移除`X-Forwarded-CountryRegion`，只有来自它所信任的[前面的一跳](#代理前面的一跳)的请求例外，这时会传递该一跳的值。Traefik通过`strip-country-region`中间件来做，除`web-storefront-trusted-hop`之外的每个路由器上都有它，因此您添加的路由器也需要它。
- **上传和Webhook**。Traefik和Caddy不限制请求体大小，除非您添加限制。nginx默认拒绝超过1 MB的请求体，其示例将控制台主机上`/api/v1/episode-pages`的限制提高到`256m`，将`/api/v1/`下其余路径提高到`33m`，将页面路径提高到`11m`。除非另行配置，Traefik会中断60秒内未完整到达的任何请求，而且它按入口点而不是按路径设置这一点，因此示例通过`transport.respondingTimeouts.readTimeout`为其`web`入口点上的每个请求设置了300秒。nginx等待的是请求体两次读取之间的最长60秒，而不是整个请求体，Caddy则完全不限制时间，因此这两个示例都没有更改它。
- **请求速率**。Traefik和nginx示例会限制单个客户端在租户域名和图片主机上向公开API、搜索和图片发送的请求数量，以及在控制台主机上发送的API密钥可调用的读取请求数量，详见[速率限制](../../3-operations/12-security/5-rate-limits.md)，并用自己的`429`应答超出限制的请求。各项允许值见[路由约定](https://github.com/publira/publira/blob/main/infra/proxy/README.md#request-rates)。nginx将它们写在`default.conf.template`的`limit_req_zone`行中，Traefik则在`dynamic/routes.yaml`中为每项允许值设置一个`rateLimit`中间件，放在网站主机和图片主机的路由器上，因此您为这些主机添加的路由器也需要一个。Caddy示例中的`rate_limit`块是注释掉的：它需要[`caddy-ratelimit`](https://github.com/mholt/caddy-ratelimit)模块，而`caddy`镜像不包含该模块，并会因此拒绝该Caddyfile。要使用这个块，请运行带有该模块的Caddy，例如用`xcaddy build --with github.com/mholt/caddy-ratelimit`构建的Caddy，并取消注释。[Docker Compose](../3-docker-compose.md)安装实例运行的是`caddy`镜像，因此它的边缘不做任何限制。
- **TLS**。每个示例都只监听纯HTTP，直到您为它添加TLS监听器，或者为Caddy提供要通过HTTPS提供服务的主机名，详见[在示例中终止TLS](#在示例中终止tls)。

在调整示例时，请保留以上每一项，并为您添加的入口点或`server`块设置相同的请求头、限制和超时。

## 后端地址

每个示例都将后端地址与路由分开存放，而提交到仓库中的地址指向的是开发容器，因此它们是您首先要替换的内容：

| 后端 | 地址 |
| --- | --- |
| `web-storefront` | `web-storefront`，使用它所监听的端口 |
| `web-admin` | `web-admin`，使用它所监听的端口 |
| `web-platform` | `web-platform`，使用它所监听的端口（如果您运行它） |
| `api` | `publira server`，端口`8000`，除非`PUBLIRA_PUBLIC_API_ADDR`设置了其他端口 |

## 主机列表

主机名来自代理的环境，因此路由文件无需为它们修改。每个变量保存以空格分隔、不带端口的主机名，每个主机只属于其中一个变量：

| 变量 | 保存的内容 | 进程 |
| --- | --- | --- |
| `PUBLIRA_EDGE_SITE_HOSTS` | 每个租户的域名 | `web-storefront` |
| `PUBLIRA_EDGE_ADMIN_HOSTS` | 每个租户的控制台主机 | `web-admin` |
| `PUBLIRA_EDGE_PLATFORM_HOSTS` | 平台控制台的主机 | `web-platform` |
| `PUBLIRA_EDGE_IMAGE_HOSTS` | 每个租户的图片主机 | `publira server`，仅限`/images` |

```text
PUBLIRA_EDGE_SITE_HOSTS=comics.example.com manga.example.org
PUBLIRA_EDGE_ADMIN_HOSTS=admin.comics.example.com studio.manga.example.org
PUBLIRA_EDGE_PLATFORM_HOSTS=platform.example.com
PUBLIRA_EDGE_IMAGE_HOSTS=images.comics.example.com
```

每个示例以自己的方式读取它们：

- **Traefik**将`dynamic/routes.yaml`作为模板渲染，因此这些变量要放在Traefik进程的环境中。
- **nginx**通过官方nginx镜像接收它们，该镜像会在容器启动时将它们填入`default.conf.template`。请将`nginx`目录挂载到`/etc/nginx/templates`而不是`/etc/nginx/conf.d`：镜像会将结果写入并覆盖它自己的`conf.d/default.conf`。如果不使用该镜像，请按照文件第一条注释所说，自行用`envsubst`渲染该文件。
- **Caddy**在读取Caddyfile时将它们替换进去。

不运行平台控制台的安装实例将`PUBLIRA_EDGE_PLATFORM_HOSTS`留空，并可以在后端地址中省略`web-platform`的地址。在没有租户拥有图片主机时，以及图片主机通过自己的负载均衡器而不是通过这个代理到达`publira server`时，`PUBLIRA_EDGE_IMAGE_HOSTS`保持为空。这两种情况都不需要移除任何路由块：每个示例在列表为空时都是有效的。

每个示例只在代理启动时读取一次这些列表。当您[添加租户](./index.md#添加租户)时，请将其域名加入`PUBLIRA_EDGE_SITE_HOSTS`，将其控制台主机加入`PUBLIRA_EDGE_ADMIN_HOSTS`，如果为其指定了图片主机，再将图片主机加入`PUBLIRA_EDGE_IMAGE_HOSTS`，然后用新的环境重启代理；重新加载会保留旧的列表。仅以文件形式添加到nginx或Caddy的证书，仍然需要重新加载：`nginx -s reload`或`caddy reload --config /etc/caddy/Caddyfile`，两者都不会中断进行中的连接。自行获取证书的Caddy会在带着新名称重启时，为加入`PUBLIRA_EDGE_TLS_HOSTS`的名称申请证书；带有ACME解析器的Traefik则在路由指名这些名称后申请。

在[Docker Compose](../3-docker-compose.md)安装实例中，这些列表位于`.env`中，`docker compose up -d proxy`会用它们重新创建代理，代理随后会获取新名称的证书。

## 代理前面的一跳

当负载均衡器、CDN或TLS终止器连接到示例时，代理的对端就是这一跳。使用原样提供的示例时，每个请求都会以这一跳的地址记录：审计日志对所有人都显示同一个地址，Publira和示例按客户端地址实施的限制也会由所有读者共享。

要记录读者自己的地址：

- **这一跳自行设置`X-Forwarded-For`、`X-Forwarded-Host`和`X-Forwarded-Proto`**，分别设为连接到它的地址、浏览器所请求的主机以及浏览器使用的协议，而不是传递调用方的值或在其后追加。Traefik会信任来自这一跳的全部三个请求头，而Web应用根据`X-Forwarded-Host`确定租户，因此在Traefik后面，只设置了`X-Forwarded-For`的一跳会让调用方能够选择租户。当Caddy不信任其前面的任何代理时，它默认会设置全部三个请求头。
- **代理信任这一跳的地址，且只信任这些地址**，并从这一跳的请求头中获取客户端地址。Traefik和nginx示例中带有注释掉的相关设置，指名的是文档用地址范围`192.0.2.0/24`：请取消注释，并将该范围替换为这一跳的地址。Caddy示例则从其环境中读取这些地址。
  - Traefik：`traefik.yaml`中`web`入口点（或这一跳所连接的入口点）上的`forwardedHeaders.trustedIPs`，以及Traefik进程环境中的`PUBLIRA_EDGE_TRUSTED_PROXIES`，其中是以空格分隔的相同地址，`dynamic/routes.yaml`读取它来传递这一跳给出的地区，并按这一跳指名的地址统计每位读者。
  - nginx：`default.conf.template`顶部附近的`set_real_ip_from`，以及其下的`real_ip_header`和`real_ip_recursive`，每个地址或范围一行`set_real_ip_from`，并在其下的`geo`块中写入相同的地址，每个一行，以` 1;`结尾。
  - Caddy：Caddy进程环境中的`PUBLIRA_EDGE_TRUSTED_PROXIES`，地址以空格分隔，由Caddyfile全局选项中的`trusted_proxies static`读取。
  - Docker Compose安装实例：`.env`中的`PUBLIRA_EDGE_TRUSTED_PROXIES`，详见[前面有CDN或负载均衡器](../3-docker-compose.md#前面有cdn或负载均衡器)。

之后，每个示例都会传递这一跳给出的`X-Forwarded-Proto`，因为这一跳通过纯HTTP访问代理，而读者使用的是HTTPS；也会传递它给出的`X-Forwarded-CountryRegion`，这样知道读者所在地区的一跳就能通过代理将地区交给[Google代码网关](./index.md#读者所在地区)。这样的一跳会自行设置该请求头，替换调用方发送的任何值，而不知道地区的一跳则移除该请求头，因为代理会传递受信任的一跳发送的任何内容。nginx和Caddy会取这一跳的`X-Forwarded-For`中最右边一个不属于受信任地址的地址，在`Forwarded`中只传递该地址，并继续自行设置`X-Forwarded-Host`，因此它们前面的一跳不需要在`PUBLIRA_TRUSTED_PROXIES`中列出。Traefik会传递这一跳的`X-Forwarded-For`，并在其后追加这一跳自己的地址，因此只有当`publira server`也信任这一跳时，它才会跳过该地址而得到这一跳所指名的地址：位于私有网络上的一跳默认受信任，而具有公网地址的一跳（例如CDN）则在`PUBLIRA_TRUSTED_PROXIES`列出其地址范围后受信任。来自其他任何地址的请求，都按未进行该设置时的方式处理。

只信任这一跳自己的地址。也能到达读者的受信任范围，会让其中任何人都能自行指定地址。

## 在示例中终止TLS

下面的修改会为每个示例添加TLS监听器，并用重定向将纯HTTP发送到HTTPS。Caddy和Traefik可以从Let's Encrypt或其他ACME证书颁发机构为它们获得的每个名称获取证书，并在过期前续期。证书颁发机构必须能在该名称上通过80或443端口访问到代理，因此要先设置DNS记录，并向互联网开放这两个端口。在别处签发的证书——由certbot等独立的ACME客户端、您自己的证书颁发机构或某个证书服务签发——会写入代理读取的文件：此时续期由那个工具负责，而代理必须加载续期后的文件。

[Docker Compose](../3-docker-compose.md)安装实例运行的Caddy示例，在设置了ACME联系地址后，会如下文所述为每个列出的主机终止TLS。

### Caddy

在Caddy进程的环境中，将`PUBLIRA_EDGE_TLS_HOSTS`设为四个列表中的所有主机名，以空格分隔，并将`PUBLIRA_EDGE_ACME_EMAIL`设为在证书颁发机构注册其账户时使用的联系地址。之后，Caddy会为每个名称获取证书并续期，在443端口上提供证书，并将这些名称的纯HTTP重定向到HTTPS：

```text
PUBLIRA_EDGE_TLS_HOSTS=comics.example.com admin.comics.example.com platform.example.com images.comics.example.com
PUBLIRA_EDGE_ACME_EMAIL=ops@example.com
```

Caddy将证书保存在`/data`下，因此请为该目录提供一个比容器存活更久的卷；从空状态开始的卷会让Caddy重新申请所有证书。不在任何列表中的主机得不到证书，因此它的TLS握手会失败，而通过纯HTTP访问时，示例仍会用自己的404应答它。

对于在别处签发的证书，请将站点块的地址`:80 {$PUBLIRA_EDGE_TLS_HOSTS}`替换为各个主机名，并在块内添加`tls /etc/caddy/tls/fullchain.pem /etc/caddy/tls/privkey.pem`：Caddy会使用这些文件，而不是自行获取证书，并且会拒绝在同时监听纯HTTP的块中使用它们。Caddy在其容器内读取这些文件，因此请将存放它们的目录以只读方式挂载到`/etc/caddy/tls`：在Docker Compose安装实例中，在`proxy`服务的`volumes`中添加`- <directory>:/etc/caddy/tls:ro`，然后运行`docker compose up -d proxy`，用该挂载重新创建它。当80端口上不再有任何站点时，Caddy会将所有主机（无论是否列出）的纯HTTP重定向到HTTPS，因此不在任何列表中的主机得到的是该重定向而不是示例的404，随后TLS握手失败。

### nginx

在`default.conf.template`的五个`server`块中，都将`listen 80`改为`listen 443 ssl`，并在第一个块（即应答不在任何列表中的主机的那个块）上保留`default_server`。然后在同一个文件的末尾添加证书，以及一个重定向纯HTTP的server：

```nginx
ssl_certificate     /etc/nginx/tls/fullchain.pem;
ssl_certificate_key /etc/nginx/tls/privkey.pem;

server {
    listen 80 default_server;
    return 308 https://$host$request_uri;
}
```

写在那里的证书会为每个`server`块提供服务，因此它必须列出代理所服务的每个主机。如果要改为每个租户一张证书，请以主机名为每对证书文件所在的目录命名，并让nginx根据浏览器所请求的名称来选择：

```nginx
ssl_certificate     /etc/nginx/tls/$ssl_server_name/fullchain.pem;
ssl_certificate_key /etc/nginx/tls/$ssl_server_name/privkey.pem;
```

此后，nginx会在每个新连接上读取这对文件，因此新证书或续期后的证书无需重新加载即可生效。不过，这些文件由worker进程而不是master进程读取，因此私钥必须能被worker进程运行时的用户读取（在官方镜像中为`nginx`），而不能只有root可读。只有root可读的私钥会让到达其主机的每个连接都失败。

nginx自身不会获取证书。如果您的ACME客户端通过nginx应答其HTTP质询，请在80端口的server中、在重定向之前提供`/.well-known/acme-challenge/`。

### Traefik

在`traefik.yaml`中，将`web`入口点发送到`websecure`，并启用示例中注释掉的`websecure`入口点：

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

`websecure`带有与`web`相同的两个中间件和相同的300秒：如果没有这个超时，通过HTTPS进行的上传会在一分钟后被中断。

在`dynamic/routes.yaml`中，将每个路由器上的`entryPoints: [web]`改为`entryPoints: [websecure]`。路由器只在它所指名的入口点上应答，因此留在`web`上的路由器永远不会通过HTTPS被访问到。

要让Traefik获取证书，请在`traefik.yaml`中添加一个解析器，并将其`storage`文件放在比容器存活更久的卷上：

```yaml
certificatesResolvers:
  letsencrypt:
    acme:
      email: ops@example.com
      storage: /etc/traefik/acme/acme.json
      httpChallenge:
        entryPoint: web
```

路由器在其规则中指名了每个列出的主机，因此Traefik可以据此判断要申请哪些名称。在上面的`websecure`入口点中，将`tls: {}`替换为该解析器，其上的每个路由器就会为其主机获取证书：

```yaml
tls:
  certResolver: letsencrypt
```

对于在别处签发的证书，请省略解析器，并在`dynamic`目录中新建一个文件（例如`dynamic/tls.yaml`）列出这些文件。Traefik会为每张证书所包含的名称提供该证书：

```yaml
tls:
  certificates:
    - certFile: /etc/traefik/tls/comics.example.com/fullchain.pem
      keyFile: /etc/traefik/tls/comics.example.com/privkey.pem
```

Traefik会监视`dynamic`目录，因此对其中文件的更改（例如新的证书条目）无需重启即可生效。对`traefik.yaml`的更改则需要重启。不过，Traefik不会察觉到被原地替换的证书文件，因此每次续期后，请更新`dynamic/`中的某个文件，例如执行`touch dynamic/tls.yaml`，否则它会一直提供旧证书，直到其过期。

## 后续步骤

边缘提供HTTPS之后，在控制台主机上[登录租户控制台](../2-installing.md#6-登录)。各示例共享的规则、规则的顺序，以及仓库如何对照这些规则检查每个示例，见[路由约定](https://github.com/publira/publira/blob/main/infra/proxy/README.md)。
