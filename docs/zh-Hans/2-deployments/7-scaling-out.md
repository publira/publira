---
title: 横向扩展
description: 当安装实例超出最初的规模时应增加哪些进程、所有副本必须共享什么，以及哪些部分无法横向扩展。
published: 2026-11-03
source_updated: 2026-11-02
---

安装实例变慢或即将增长时，要增加的是它已经在运行的进程：为繁忙的进程增加副本，按所响应的流量拆分`publira server`，按所做的工作拆分`publira worker`。本页说明哪些进程可以运行多个副本以及在此之前必须准备好什么、安装实例的负载落在哪里、`publira server`可以拆分到什么程度、`publira worker`如何拆分、随着副本增加数据库必须能接受什么、读者的目录读取和worker进程的每日重建如何转到数据库的只读副本上，以及哪些部分无论增加多少副本都无法缓解。本页适用于任何平台：[Kubernetes](./5-kubernetes/index.md)和[Fargate上的Amazon ECS](./6-ecs-fargate/index.md)给出了清单和命令。

## 可以运行多个副本的进程

每个常驻进程都可以运行任意数量的副本：`publira server`、`publira worker`、`web-storefront`、`web-admin`、`web-platform`和`email-renderer`。它们都不在自身保存第二个副本会需要的状态：

- **安装实例存储的内容都在PostgreSQL和对象存储中**。每一行数据都在数据库中，每一张上传的图片都在存储桶中，因此在任何地方启动的副本都服务于同一个安装实例。
- **会话是一个Cookie**。Web应用把读者或工作人员的会话封装进一个加密的Cookie，浏览器在每次请求时都会将其发回，API在每次调用时都会检查其中的访问令牌。应用的任何副本都能打开另一个副本签发的会话，因此边缘不需要会话粘滞。所以同一个应用的每个副本都需要相同的`PUBLIRA_AUTH_SECRET`，`publira server`的每个副本都需要相同的`PUBLIRA_AUTH_JWT_SECRET`和密钥加密密钥。
- **设置从数据库读取，而不是从进程读取**。保存的平台策略会在十秒内到达`publira server`的每个运行中的副本，保存的对象存储或搜索引擎设置会在30秒内到达服务器和worker进程的每个副本。因此保存设置无需重启，也不会有副本停留在旧值上。
- **副本在运行时共享的内容都在Valkey中**。速率限制计数器、转换后的图片以及Web应用的页面缓存都保存在那里，而不是保存在进程的内存中，详见[必须先共享的内容](#必须先共享的内容)。

因此每个进程也都可以作为平台自动扩缩容的对象，例如Kubernetes的HorizontalPodAutoscaler或ECS的服务自动扩缩容。请按照自动扩缩容可能启动的最多副本数来规划数据库的容量，计算方法见[数据库连接预算](#数据库连接预算)。

## 必须先共享的内容

在任何进程运行第二个副本之前，所有使用Valkey或任何Redis协议服务器的进程都必须指向同一个服务器：`publira server`和`web-storefront`上的`PUBLIRA_REDIS_URL`，以及`web-storefront`、`web-admin`和`web-platform`上的`PNCH_REDIS_URL`。[安装](./2-installing.md#准备服务)中已经准备好了它，其中保存四类内容：

| 内容 | 由谁保存 | 没有共享的Valkey时 |
| --- | --- | --- |
| 速率限制计数器：读者写入限制、二次验证密码限制和邮件限制 | `publira server` | 每个副本各自计数，因此请求分散到三个副本的读者会得到三倍的限额。详情见[计数保存的位置](../3-operations/9-platform-policies.md#计数保存的位置) |
| 搜索页面的速率限制计数器 | `web-storefront` | 每个副本各自计数，因此搜索页面请求分散到三个副本的读者会得到三倍的限额 |
| 转换后的图片 | `publira server` | 每个副本把自己转换的图片保存在自己的内存中，因此每个副本都会再次转换同一张图片 |
| Web应用缓存的页面和数据 | `web-storefront`、`web-admin`、`web-platform` | Web应用渲染的任何内容都不会被缓存：每个请求都会重新渲染页面，并为页面上的所有内容调用`publira server` |

每个Web应用都把自己的条目保存在独有的键前缀下，因此这些应用共享服务器而不共享条目。当一次写入使缓存的页面过期时，服务器的缓存重新验证会到达每个Web应用的一个副本，该副本在Valkey中记录这次失效，其他所有副本都会读取它：无论运行多少个副本，缓存都保持最新。`publira worker`和`email-renderer`不使用Valkey。

## 负载落在哪里

安装实例的流量落在三组进程上，每一组各自增长：

| 流量 | 进程 | 要增加什么 |
| --- | --- | --- |
| 读者：租户的网站和移动应用 | `web-storefront`，以及`publira server`的公开API和图片 | `web-storefront`的副本，以及租户域名所访问的`publira server`的副本 |
| 工作人员和运营人员：控制台 | `web-admin`、`web-platform`以及它们调用的`publira server` | 控制台及其`publira server`的副本，通常不需要那么多 |
| 后台工作：邮件、推送通知、缓存重新验证、定时任务 | `publira worker` | worker进程的副本 |

### 读者

转换图片是安装实例所做的最繁重的工作。`publira server`会在请求时把页面上显示的每张图片调整大小并转换为WebP或AVIF，并把结果在Valkey中保存`PUBLIRA_IMAGE_CACHE_TTL`的时长（未设置时为一小时），因此一个副本转换了一张图片后，其他所有副本都会提供缓存的结果，直到它过期。缓存中尚未保存的图片会在请求到达的那个副本上转换，因此提供租户图片的进程是网站增长时最先耗尽CPU的进程。

在边缘前面放置CDN可以分担大部分这类工作。`publira server`会把任何人都可以查看的图片（例如免费章节的页面或租户的徽标）标记为`public, max-age=3600`，如果免费阅读期更早结束则标记更短的时间；需要读者凭据的图片则标记为`private`。CDN可以在一小时内提供公开图片，而无需再次询问安装实例。它的缓存键必须包含主机、`Accept`标头、`Authorization`标头和完整的查询字符串，就像[缓存策略](./6-ecs-fargate/1-cloudfront.md#缓存策略)为CloudFront所设置的那样。除了`/images`之外，没有什么值得在CDN上缓存：页面取决于读者的会话，而且Web应用已经缓存了它们。

### 后台工作

除非只分配了部分工作，每个`publira worker`副本都会运行worker进程的所有类型的工作，并且任何一项工作都不会在两个副本上运行：

- **发件箱**负责发送邮件和推送通知以及重新验证Web应用的缓存，它的工作分散在各个副本上。每隔`PUBLIRA_OUTBOX_DRAIN_INTERVAL`（未设置时为两秒），由一个副本认领最多`PUBLIRA_OUTBOX_CLAIM_LIMIT`个到期条目（未设置时为一百个），并为每个条目排入一个作业。随后任何副本都可以运行这些作业，每个副本同时最多运行`PUBLIRA_OUTBOX_MAX_WORKERS`个（未设置时为八个），且每个作业只在一个副本上运行。更多副本可以同时发送更多条目，这在发送缓慢时有帮助，但无论运行多少个副本，发件箱每个间隔最多仍然只认领`PUBLIRA_OUTBOX_CLAIM_LIMIT`个条目。
- **定时任务**，即在预定时间发布章节、开启和结束免费阅读期以及重建和清除存储数据的任务，每个都同时只由一个副本运行。任务在一次运行进行期间是唯一的，因此第二个副本不会再为它安排第二次运行，并且运行时间超过其间隔的运行也不会在它之下被再次启动。
- **重建和清除**在所有副本之间一次只运行一个。轮到某个副本时，如果另一个副本正在运行其中一个，它会等待那个结束，而不是并行启动，并且这段等待不计为运行失败。运行所有类型工作并正忙于一小时重建的副本同时也是发送邮件的副本之一，[按队列拆分worker进程](#按队列拆分worker进程)可以避免这种情况。

因此，更多副本意味着同时发送更多邮件和推送通知，而不是更快的重建或更多的定时执行。[定时任务](../3-operations/10-scheduled-jobs.md)说明了每个任务的作用，[`publira worker`参考](https://github.com/publira/publira/blob/main/server/cmd/publira/README.md#publira-worker)列出了调整它的每个变量。

## 按角色拆分服务器

`publira server`在一个进程中提供公开API、两个控制台的API和图片，并且可以按所提供的内容进行拆分。下面的每一步都保留了前一步带来的好处：

1. **一个进程**。`publira server --with-worker`同时运行服务器和worker进程，就像[Docker Compose](./3-docker-compose.md)安装那样。增加一个副本就同时增加两者。
2. **服务器和worker进程分开**。`publira server`和`publira worker`作为两个进程运行，就像[安装](./2-installing.md)中那样。各自独立扩展，并且worker进程的数据库登录不再位于边缘所转发到的进程中。
3. **面向读者的服务器**。第二个`publira server`以`--role storefront`运行，承担每个租户域名的公开API和图片，`web-storefront`的`PUBLIRA_GRPC_URL`也指向它，因为`web-storefront`只调用公开API。第一个服务器继续为`web-admin`、`web-platform`和控制台主机提供服务。这样所有读者流量都到达专属的进程，您可以独立于控制台对它们进行扩展，而且这些进程既不持有任一控制台的数据库登录，也不持有Web服务凭据。[部署参考](https://github.com/publira/publira/blob/main/infra/deploy/README.md#long-lived-processes)列出了两者各自读取的内容。
4. **仅供控制台使用的服务器**。第一个`publira server`以`--role admin,platform`运行，把公开API留给面向读者的服务器。`web-admin`除了调用租户控制台的API之外，还会调用公开API来获取租户的主题和标签，因此它的`PUBLIRA_PUBLIC_GRPC_URL`指向面向读者的服务器，而它的`PUBLIRA_GRPC_URL`仍然指向第一个服务器。边缘也把控制台主机的公开API发送到面向读者的服务器（它在任何主机上都会响应），并把控制台主机的图片保留在第一个服务器上，因为`--role storefront`进程会对控制台主机的图片返回`404`。这样控制台的服务器不持有`publira_public`登录，也不做任何公开API的工作，而面向读者的服务器只随公开API的流量扩展。
5. **各自的副本**。按流量需要为每个进程运行任意数量的副本。

边缘仍然可以让图片转换远离响应公开API的进程。它在租户域名上按路径路由`/images`和`/rpc/publira.v1.`，因此两者可以分别发送到各自的一组`--role storefront`进程：一组转换图片，另一组响应API，每组都按其流量需要运行任意数量的副本。`web-storefront`调用API组，因为它从不自己获取图片；在第4步之后，`web-admin`也通过`PUBLIRA_PUBLIC_GRPC_URL`调用API组。进程本身没有任何变化，变化的只有边缘为每个路径转发到的后端以及提供给Web应用的URL。请把控制台主机的`/images`保留在`web-admin`通过`PUBLIRA_GRPC_URL`调用的`publira server`上，因为`--role storefront`进程会对控制台主机的图片返回`404`；在第4步把控制台主机的`/rpc/publira.v1.`发送到API组之前，它也一同保留在那里。

Kubernetes和ECS都提供了第3步和第4步所需的资源：Kubernetes见[让控制台的凭据远离租户的域名](./5-kubernetes/2-operating.md#让控制台的凭据远离租户的域名)，ECS见[同名章节](./6-ecs-fargate/2-operating.md#让控制台的凭据远离租户的域名)。

### 分开提供图片和公开API

这两组也可以位于两个负载均衡器之后，而不是一个，这样CDN可以缓存的图片和它无法缓存的API调用就永远不会共用同一个负载均衡器。每组都通过各自的主机名访问：

- **图片**位于每个租户的[图片主机](../3-operations/2-tenants.md#图片主机)上，例如`images.comics.example.com`。每个图片主机都指向图片组前面的负载均衡器，该负载均衡器为它终止TLS，并在保持`Host`不变的情况下只转发其上的`/images`，详见[租户的图片主机](./4-edge/index.md#租户的图片主机)。租户一旦有了图片主机，公开API就会在那里提供其网站的图片，因此它的网站和移动应用会通过该负载均衡器加载图片。没有图片主机的租户仍然通过边缘在其域名上提供图片，所以在依赖这种拆分之前，请为每个租户都设置一个图片主机。
- **公开API**位于专属的主机名上，例如`api.example.com`，它指向API组前面的负载均衡器，并且只转发`/rpc/publira.v1.`。公开API根据请求而不是主机来确定租户，因此一个主机可以服务所有租户，进程也无需为此做任何更改。`web-storefront`的`PUBLIRA_GRPC_URL`以及第4步之后`web-admin`的`PUBLIRA_PUBLIC_GRPC_URL`指向该组：Web应用在该组网络之外运行时为`https://api.example.com/rpc`，在其旁边运行时则为该组的私有地址，从而绕过负载均衡器。租户的移动应用以`PUBLIRA_BASE_URL=https://api.example.com`构建，详见[应用连接的地址](../5-mobile-app/2-building.md#应用连接的地址)。

两个负载均衡器都要对其转发的路径做到[边缘](./4-edge/index.md#边缘必须做什么)对边缘的要求，并且每组的`PUBLIRA_TRUSTED_PROXIES`都要涵盖自己的负载均衡器，详见[客户端地址](./4-edge/index.md#客户端地址)。每组都以`--role storefront`运行，变量与第3步中面向读者的服务器相同。租户域名和控制台主机仍然像以前一样位于边缘上，也仍然像以前一样转发`/images`和`/rpc/publira.v1.`：控制台的图片仍然在控制台主机上加载，而拆分前构建的应用仍然在租户域名上调用API。

只保留一个边缘的安装实例可以改为在该边缘上提供图片主机，按[租户的图片主机](./4-edge/index.md#租户的图片主机)所述进行路由；示例配置通过`PUBLIRA_EDGE_IMAGE_HOSTS`接收它们。Kubernetes上使用两个负载均衡器所需的资源见[分开提供图片和公开API](./5-kubernetes/2-operating.md#分开提供图片和公开api)，ECS见[同名章节](./6-ecs-fargate/2-operating.md#分开提供图片和公开api)。

## 按队列拆分worker进程

worker进程把工作放在六个队列中：`outbox`，即发件箱的邮件、推送通知和缓存重新验证；`ticker`，在预定时间执行的任务；`maintenance`，重建和清除；`search_index`，搜索索引的构建；`payment_reconciliation`，租户管理员发起的付款对账；以及`data_export`，读者索取的数据副本。指定了`--queue`的副本只承担它所列出的队列的工作，不做其他工作，因此发件箱可以拥有自己的副本，并独立于运行一小时重建的副本来确定规模。当安装实例的邮件和推送通知必须在重建运行期间及时发出时，请运行两个进程来代替一个`publira worker`：

```bash
publira worker --queue outbox
publira worker --queue ticker,maintenance,search_index,payment_reconciliation,data_export
```

第一个进程只负责发送和重新验证，不做其他任何事：请随发件箱的负载对它进行扩展，而且它只以一个而不是三个登录连接数据库。第二个进程运行所有定时任务，很少需要第二个副本，因为无论有多少副本，它的每个任务同时都只在一个副本上运行。在`publira server --with-worker`上，同一个标志会缩小它所承载的worker进程的范围。

每个队列都至少需要一个承载它的运行中的副本。作业队列选出来负责安排任务的那个副本会安排所有任务，无论它自己承担哪些队列，因此一个没有运行中的副本承担其队列的任务不会丢失：它会在数据库中等待，直到承担其队列的副本启动之前都没有任何进程运行它。每个副本在启动时都会以`worker leaves queues to other replicas`记录它留给其他副本的队列。请为每个副本设置相同的间隔变量，因为负责安排任务的副本会自行安排它们。[`--queue`参考](https://github.com/publira/publira/blob/main/server/cmd/publira/README.md#hosting-some-queues---queue)列出了每个队列带来的数据库登录和变量，[部署参考](https://github.com/publira/publira/blob/main/infra/deploy/README.md#long-lived-processes)列出了两者各自读取的内容。

## 数据库连接预算

`publira server`和`publira worker`的每个副本会为其登录所用的每个数据库登录打开一个连接池，每个连接池最多持有`PUBLIRA_DB_MAX_OPEN_CONNS`个连接（未设置时为十个）。Web应用和`email-renderer`不打开任何连接。因此数据库必须能接受：

```text
(the pools of every copy of publira server and publira worker, summed) × PUBLIRA_DB_MAX_OPEN_CONNS
```

| 进程 | 每个副本的连接池数 |
| --- | --- |
| `publira server` | 3 |
| `publira server --role <roles>` | 每个指定的角色1个：`--role storefront`为1个，`--role admin,platform`为2个 |
| 使用只读副本提供`storefront`的`publira server` | 再加1个，位于只读副本而非主库上 |
| `publira server --with-worker` | 6 |
| `publira worker` | 3 |
| `publira worker --queue <queues>` | 1个，含`ticker`时再加1个，含`maintenance`、`search_index`、`payment_reconciliation`和`data_export`中任意一个时再加1个：`--queue outbox`为1个 |
| 使用只读副本承载`maintenance`的`publira worker` | 再加1个，位于只读副本而非主库上 |
| 运行期间的`publiractl`命令 | 1个；指定了只读副本时，`job aggregate-content-stats`和`job build-recommend-features`在只读副本上再加1个 |

总和必须能容纳在数据库的`max_connections`之内，并减去PostgreSQL为超级用户保留的连接数`superuser_reserved_connections`（未设置时为三个）。一个服务器和一个worker进程会占用PostgreSQL默认100个连接中的60个。一个运行三个`publira server --role storefront`副本、两个`publira server`副本和两个`publira worker`副本的安装实例会占用(3 × 1 + 2 × 3 + 2 × 3) × 10 = 150个连接，默认值已经无法容纳。

对公开API的请求从开始到结束都占用公开API连接池中的一个连接，对租户控制台API的请求则占用控制台连接池中的一个连接，并且每个连接池都会保留一个连接，用于这些请求在租户之外进行的查询。因此一个副本最多同时响应比`PUBLIRA_DB_MAX_OPEN_CONNS`少一个的公开API请求，当它同时提供两者时，还可以并行响应同样数量的租户控制台请求。提高这个上限可以让每个副本响应更多请求，增加副本也可以；两者都会消耗数据库的连接。完整参考见[连接池](https://github.com/publira/publira/blob/main/server/README.md#connection-pools)。

## 从只读副本读取

有两类读取会随着安装实例的读者而增长。读者自身的流量几乎全部是对已发布目录的读取：系列和章节的页面、列表和搜索，以及提供每张租户图片之前读取的那一行数据。此外，读者的每次浏览都是`content_events`中的一行，worker进程的每日重建会跨所有租户读回这些行，以统计当天的数据并构建推荐。这两类读取都可以在数据库的热备库上进行，这样构成安装实例增长的读者就不再给主库增加这部分负载。

备库必须是同一集群的热备库，从主库进行流复制，例如托管PostgreSQL的只读副本：这样角色、它们的授权和密码会随其他所有内容一起到达备库，而且备库最多只落后片刻。从备份恢复的副本或不处于恢复模式的数据库都不是热备库。请为它单独设置一个`max_connections`，大小按照[数据库连接预算](#数据库连接预算)中统计的只读副本连接池来确定；PostgreSQL也会拒绝启动`max_connections`小于主库的备库。一个备库可以同时承担这两类读取。

在只读副本上读取的内容不会比主库读取的更旧。在只读副本可能进行的每次读取之前，进程会先读取主库的位置，只读副本只有在回放到该位置之后才会进行这次读取，因此当时已经提交的每次写入都包含在其中。等待之后仍然落后的只读副本会被排除在这次读取之外，改由主库进行读取。因此，落后时间更长或被提升为独立主库的只读副本会把读取送回主库，在它赶上之前主库的负载也会随之回来。对于只读副本承担的每次读取，主库仍然要响应一条语句，即读取其位置，这不会访问任何表。

要查看只读副本是否在承担读取，请开启[追踪](../3-operations/11-monitoring.md)：每个查询跨度都会在`server.address`和`server.port`中写明响应它的服务器，每个查询指标也是如此。

### 读者的目录读取

在每个提供`storefront`角色的`publira server`上（即`--role storefront`进程，或每个未指定`--role`的进程），把`PUBLIRA_PUBLIC_DB_REPLICA_URL`设置为以`publira_public`登录、密码与`PUBLIRA_PUBLIC_DB_URL`相同的备库连接。以其他任何登录连接的URL会使进程在启动时停止。不设置时（这是默认值），所有读取都保留在主库上。

只读副本响应的内容：

- 访客读取的目录：系列、章节、作者、品牌、类型和标签的页面和列表，排行榜，向所有读者展示的推荐，相关系列，活动横幅，以及站点地图。这些是`web-storefront`缓存并在读者之间共享的读取。
- 安装实例没有搜索引擎而在PostgreSQL中搜索时的目录搜索。
- 租户的图片，但章节的页面除外，因为它们需要检查读者可以阅读什么。

`publira server`响应的其他所有内容都保留在主库上：已登录读者的每个请求、每次写入、登录以及控制台。

读者在等待这些请求中的每一个，因此只读副本有50毫秒的时间来赶上。`/readyz`把只读副本的连接池命名为`db.public.replica`，因此停止响应的只读副本会使进程变为未就绪，与主库一样。

### 每日重建

在每个承载`maintenance`队列的`publira worker`上（包括每个未指定`--queue`的worker进程），把`PUBLIRA_CONTENT_STATS_DB_REPLICA_URL`设置为以`publira_content_stats`登录、密码与`PUBLIRA_CONTENT_STATS_DB_URL`相同的备库连接。`publiractl job aggregate-content-stats`和`publiractl job build-recommend-features`也会读取它，因此在手动运行这些命令的地方也要设置它。以其他任何登录连接的URL会使进程或命令在启动时停止。不设置时（这是默认值），所有读取都保留在主库上。

只读副本依次为每个租户响应的内容：

- 内容统计重建所统计的那一天：来自`content_events`的浏览、读完、评分和收藏，以及购买和评论。
- 推荐特征构建为每个已登录读者读取的租户`content_events`的最近时间窗口（未设置时为四周）。

worker进程所做的其他所有事情都保留在主库上：重建写入的每一行；排行榜和推荐的各作品数据，它们读取自重建刚刚写入的当天计数；把读完的阅读投影到`content_events`；每次清除；搜索索引的构建；以及其他队列上的任务。

没有人在等待重建，因此只读副本有5秒的时间来赶上，超过后该租户的重建改为在主库上读取。一天结束时并不会关闭对它的写入：延迟投影的读完记录会归入读者读完的那一天，而且工作人员可以隐藏任何一天的评论，所以这段等待可以防止重建在缺少这些数据的情况下统计某一天。`/readyz`把只读副本的连接池命名为`db.content_stats.replica`。

在大型租户上，重建在备库上的读取可能运行数分钟，而当回放主库的清理会删除查询仍在读取的行时，PostgreSQL会以`canceling statement due to conflict with recovery`取消备库上的查询。这时该租户的重建失败，下一次执行会从中断处重新重建这一天。请在备库上开启`hot_standby_feedback`，让主库保留这些行直到读取结束；代价是主库对所有表的死行清理都要等待它。

## 无法横向扩展的部分

进程的副本分担的是它们自己的工作。它们所依赖的服务对Publira来说各自都是一个服务，要扩大其中任何一个，或者让它在提供给Publira的那一个地址之后实现高可用，都要在该服务中完成：

- **PostgreSQL**。每个连接池都连接到其变量指定的那一个URL，因此每次写入都发往一个主库，除了[只读副本](#从只读副本读取)可以承担的读者目录读取和每日重建对`content_events`的读取之外，每次读取也都如此。控制台、已登录的读者和worker进程的其他任务仍然只访问主库，这使主库成为增长中的安装实例的负载最终汇聚之处：进程的副本越多，发给它的查询就越多，只有更大的主库才能缓解。
- **Valkey**。每个进程都读取同一个URL。
- **对象存储**。安装实例只有一个存储桶，保存在平台的设置中。
- **SMTP服务器**。worker进程通过设置中指定的SMTP服务器发送每封邮件。
- **搜索引擎**（安装实例运行搜索引擎时）。安装实例只有一个，保存在平台的设置中。

## 日常运行多个副本

### 停止副本

`publira server`和`publira worker`会在收到`SIGTERM`后30秒内停止：它们最多等待这么长时间让进行中的请求和作业完成，然后切断仍在运行的内容。请在平台强制终止进程之前给它一个比这更长的宽限期，例如在Kubernetes上把`terminationGracePeriodSeconds`设为45（默认为30），或在ECS的容器定义中把`stopTimeout`设为45秒（默认也是30）。在截止时间被切断的请求会失败，其调用方会看到连接关闭。被切断的作业会重新执行：作业队列会在一小时后把仍处于运行状态的定时任务视为卡住并再次运行它，而且每个任务都可以安全地重复执行。仍处于处理中的发件箱条目会在`PUBLIRA_OUTBOX_STALE_PROCESSING`（未设置时为十五分钟）之后回到队列并在那时发送：投递至少一次，因此在副本被终止之前邮件或推送通知刚刚发出的条目会被第二次发送。

`publira server`一收到停止指令就停止接受连接，并不会先让`/readyz`返回未就绪。因此边缘必须在副本停止之前停止向它发送请求。在ECS上边缘会这样做：服务会先把任务从其Application Load Balancer目标组中移出，等待目标排空，然后才停止任务。在Kubernetes上，Pod离开其Service的端点与它收到`SIGTERM`是同时发生的，因此在这一变化传到边缘之前，请求仍可能到达它；一个等待几秒钟的`preStop`钩子（例如使用`sleep`动作的钩子）可以在进程停止接受连接之前给这一变化留出时间，这能缩小这段间隙，但不能保证没有请求在其间到达。新副本的`/readyz`返回就绪后，边缘就会向它发送请求，详见[健康检查](../3-operations/11-monitoring.md#健康检查)。

### 重启副本

不改变版本的变更（例如变量的新值）可以一次一个副本地逐步推出，期间安装实例会持续提供服务。保存的设置则完全不需要重启。紧接在当前运行版本之后的版本也可以一次一个副本地逐步推出，worker进程也不例外，因为相邻两个版本的副本可以并存运行，而且两者的worker进程共享发件箱：[升级](./8-upgrading.md#决定是否先停止进程)说明了具体做法，以及跳过一个版本时会有什么变化。

### 备份

备份期间，worker进程从数据库备份开始之前一直保持停止，直到存储桶复制结束，这指的是它的每一个副本，详见[停止worker进程](./9-backup-and-restore.md#1-停止worker进程)。在运行`publira server --with-worker`的安装实例上，这就是该进程的每一个副本，服务器也会随之停止。

## 后续步骤

[升级](./8-upgrading.md)可以把运行任意数量副本的安装实例升级到新版本。[监控](../3-operations/11-monitoring.md)提供了用于观察负载的指标和日志。
