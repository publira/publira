---
title: 速率限制
description: 在安装实例前面应按客户端限制哪些请求、哪些请求绝不能限制，以及如何将限制写成AWS WAF、Cloud Armor或Cloudflare规则，或写入您运行的代理中。
published: 2026-11-03
source_updated: 2026-10-31
---

`publira server`会限制它能够区分的内容：密码尝试、它发送的邮件，以及每种读者操作，例如发表评论或使用等免费券，详见[速率限制](../9-platform-policies.md#速率限制)。它也会限制匿名浏览，但只是宽松的限制，详见[publira server自身的限制](#publira-server自身的限制)：在该限制之下，单个客户端仍然可以获取所有免费章节的每一页，或者不断执行搜索直到数据库跟不上，而第一个迹象就是`/readyz`失败。因此，这些请求还必须在它前面按客户端加以限制：由托管的WAF或CDN限制，或由边缘的代理限制。

## 应该限制什么

在租户的域名及其图片主机上，按每位读者的地址进行限制，即[客户端地址](../../2-deployments/4-edge/index.md#客户端地址)要求边缘记录的地址：

- **公开API**，即`/rpc/publira.v1.`，由移动应用调用。
- **搜索**，它执行读者能发起的开销最大的查询：公开API的搜索过程`/rpc/publira.v1.CatalogService/SearchPublished…`，以及在服务器上执行相同搜索的网站搜索页面`/search`或`/<locale>/search`。请为它设置比API其余部分更低的限制。
- **图片**，即`/images`，章节的每一页都是图片。读者打开章节时会一次加载其所有页面，因此请允许数百个请求的突发。

对超出限制的请求以`429 Too Many Requests`应答。每项限制都按地址计数，因此位于同一地址后面的读者（例如运营商的NAT或办公网络）会共享它：请按您预计正当读者可能来自的最繁忙地址来设置，而不是按单个读者设置。

控制台主机交给`publira server`自身的限制：它们的流量来自您的工作人员，而那里的章节上传和编辑页面是安装实例所提供的最重的内容。

## 绝不能限制的内容

- **Webhook**，即`/api/v1/webhook/`下的路径，[Webhook](../../2-deployments/4-edge/index.md#webhook)中列出了这些路径。在此被拒绝的服务商会重试，付款会被延迟记录，或者读者的回复永远到达不了控制台。
- **健康检查**，即负载均衡器或编排系统发送给每个进程的`GET /readyz`和`GET /livez`。因速率被拒绝的健康检查会让健康的进程退出服务。

路径前面的机器人质询或登录提示同样会拒绝移动应用和Webhook服务商，详见[机器人质询](./4-waf.md#机器人质询)。

## 在托管的WAF或CDN中

云平台上的安装实例前面几乎总有托管的负载均衡器或CDN，随之提供的[Web应用防火墙](./4-waf.md)就是设置限制的地方。CloudFront或Application Load Balancer上的AWS WAF、Google Cloud负载均衡器上的Cloud Armor，以及Cloudflare的速率限制规则，都按连接到它们的地址统计读者，并在请求到达您运行的任何东西之前将其拒绝。在那里限制了上述路径后，其后面的代理就不需要自己的限制了。请删除这些限制，或者先[信任这一跳](../../2-deployments/4-edge/1-sample-configurations.md#代理前面的一跳)：不信任这一跳的代理会把每位读者都算作这一跳的地址，从而将他们一并拒绝。

托管WAF在一个时间窗口内（例如10秒或一分钟）统计读者的请求，达到计数后在该窗口的剩余时间内拒绝请求。请为下表的每一行编写一条规则，在租户的域名和图片主机上匹配其路径，使其他任何内容（包括Webhook和健康检查）都不被计数。这些计数是示例配置在该时间内从单个客户端接受的最大数量：

| 请求 | 10秒内 | 一分钟内 |
| --- | --- | --- |
| 公开API`/rpc/publira.v1.`，搜索除外 | 320 | 1,320 |
| 搜索过程`/rpc/publira.v1.CatalogService/SearchPublished…` | 40 | 140 |
| 搜索页面`/search`或`/<locale>/search` | 40 | 140 |
| 图片`/images` | 1,200 | 4,200 |

一个时间窗口会一次性接受其全部计数，因此请优先选择WAF提供的最短窗口。

- **AWS WAF**：在CloudFront分配或负载均衡器的Web ACL中为每一行设置一条[基于速率的规则](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based-high-level-settings.html)，使用匹配主机和路径的缩小范围语句，以源IP地址作为聚合键，评估窗口设为最短的60秒，并以一分钟的计数作为限制。请为其Block操作设置状态码为`429`的自定义响应；否则它会以`403`应答。
- **Google Cloud Armor**：在负载均衡器后端服务的安全策略中为每一行设置一条[速率限制规则](https://cloud.google.com/armor/docs/rate-limiting-overview)，使用`throttle`操作，匹配表达式基于`request.headers['host']`和`request.path`，以`IP`作为键，间隔设为10秒或60秒并以相应计数作为阈值，超出后的操作为`deny(429)`。请优先使用`throttle`而不是`rate_based_ban`：封禁会在整个持续时间内一直拒绝读者，即使对方已经放慢了速度。
- **Cloudflare**：为每一行设置一条[速率限制规则](https://developers.cloudflare.com/waf/rate-limiting-rules/)，匹配主机名和URI路径，按IP计数，周期为10秒或一分钟，操作为以`429`应答的Block。一个区域可以拥有的规则数由套餐决定：Free套餐一条（只能按10秒计数），Pro两条，Business五条；如果少于四条，请先限制搜索，因为它对数据库的开销最大。

## 在您运行的代理中

当前面没有任何东西进行限制时，由您运行的代理来限制请求。Traefik和nginx的[示例配置](../../2-deployments/4-edge/1-sample-configurations.md#每个示例做了什么)出厂时就限制了上述路径，而Caddy的示例配置中的限制被注释掉了，因为它们需要`caddy`镜像不包含的模块。

## publira server自身的限制

在边缘后面，`publira server`对相同的读取设有自己的限制，这样一来，不做任何限制的边缘，例如[Docker Compose](../../2-deployments/3-docker-compose.md)安装实例中原版的`caddy`镜像，只会让安装实例的保护变弱，而不至于毫无保护。它以10秒为窗口统计每位读者的地址，当`PUBLIRA_REDIS_URL`指定了Redis时，所有实例通过它共享计数。在您更改之前，它允许的数量是上表10秒列的两倍：

| 请求 | 10秒内，内置值 | 10秒内，最小值 | `publiractl policy set`选项 |
| --- | --- | --- | --- |
| 公开API`/rpc/publira.v1.`，搜索除外 | 640 | 320 | `--anonymous-read-public-api-per-10-seconds` |
| 搜索过程`/rpc/publira.v1.CatalogService/SearchPublished…` | 80 | 40 | `--anonymous-read-search-per-10-seconds` |
| 租户域名和图片主机上的图片`/images` | 2,400 | 1,200 | `--anonymous-read-images-per-10-seconds` |

超出限制的调用会以`resource_exhausted`被拒绝，图片则以`429`被拒绝，两者都带有注明等待时间的`Retry-After`响应头。在设置了上述限制的边缘后面，读者会先被边缘拒绝。无论边缘允许多少，服务器的限制都会生效，因此，为共用一个地址（例如运营商的NAT）的读者将边缘的允许量提高到超过服务器的限制时，就会放行随后被服务器拒绝的请求。请同时提高服务器的限制：它是[平台策略](../9-platform-policies.md#匿名浏览)的一部分，可以通过平台控制台的**安全**页面或上述选项更改。保存的更改会在十秒内传达到每个实例，无需重启。低于最小值（即示例配置在10秒内接受的数量）的值会被拒绝，并注明其字段或选项，以便边缘始终先拒绝读者。位于同一地址后面的读者共享服务器的限制，就像他们共享边缘的限制一样。

服务器无法统计从安装实例内部到达的请求。每一跳都是[受信任代理](../../2-deployments/4-edge/index.md#publira信任的代理)之一的请求，是Web应用以自身身份同时代表其所有读者发出的调用，因此不计入。这包括由`web-storefront`在服务器上执行的网站搜索页面，因此`web-storefront`会自行限制该页面，详见[web-storefront自身的限制](#web-storefront自身的限制)。控制台主机、Webhook和健康检查也不计入。

## web-storefront自身的限制

`web-storefront`按每位读者的地址限制网站的搜索页面`/search`或`/<locale>/search`，它像`publira server`一样从转发请求头中找出该地址。它允许10秒内80个请求，即上表10秒列的两倍，这样位于设置了上述限制的边缘后面的读者会先被边缘拒绝；对超出限制的请求，它以`429`和注明等待时间的`Retry-After`响应头应答。`web-storefront`的所有实例通过其`PUBLIRA_REDIS_URL`指定的Valkey或Redis（即服务器所用的那个）共同统计读者。没有该变量时，以及无法连接该服务器期间，每个实例各自计数，因此限制会放宽为每个实例一份，而不是消失。在搜索页面的位置发布在`/search`的页面也以同样的方式计数。

这项限制没有可调整的设置。为共用一个地址的读者将边缘对搜索页面的允许量提高到超过它时，就会放行随后被`web-storefront`拒绝的请求。

## 分布式拒绝服务

保护安装实例免受分布式拒绝服务攻击是托管服务商的职责，而不是边缘的职责：按地址的限制对来自大量地址的请求毫无作用。
