---
title: 监控
description: 通过/livez和/readyz探测每个进程，值得告警的日志行和指标，以及开启OpenTelemetry指标和链路追踪。
published: 2026-11-03
updated: 2026-11-04
source_updated: 2026-11-04
---

安装实例通过四种方式告诉您它的运行状况：每个进程都会响应存活检查和就绪检查，`publira server`和`publira worker`会写入结构化日志，这两者在开启后还会导出OpenTelemetry指标，而除`email-renderer`之外的每个进程都可以导出OpenTelemetry链路追踪。本页说明每种方式报告什么、如何将其接入编排系统和告警系统，以及哪些情况值得告警。由哪个监控系统接收这些数据由您决定；本页只说明安装实例发送什么。

这些变量的完整说明请参阅[`publira server`和`publira worker`参考](https://github.com/publira/publira/blob/main/server/cmd/publira/README.md)、[服务器的链路追踪与指标参考](https://github.com/publira/publira/blob/main/server/README.md#distributed-tracing-opentelemetry)以及[Web应用的链路追踪参考](https://github.com/publira/publira/blob/main/packages/tracing/README.md)；本页只链接到这些参考，不再重复。

## 健康检查

每个进程都通过普通HTTP响应两个请求：

- **`GET /livez`**：只要进程能够响应，就会以`200`和文本`ok`应答。它不检查其他任何东西，因此只有在进程挂起或停止时才会失败。
- **`GET /readyz`**：检查进程所依赖的内容，所有检查都通过时以`200`应答，任一检查失败时以`503`应答。响应正文会列出每项检查。

| 进程 | 端口 | `/readyz`检查的内容 |
| --- | --- | --- |
| `publira server` | `8000`（`PUBLIRA_PUBLIC_API_ADDR`） | 它的三个数据库登录名：`db.public`、`db.admin`和`db.platform`，或者`--role`指定的角色所对应的登录名；在为其提供了[只读副本](../2-deployments/7-scaling-out.md#从只读副本读取)时，还有`db.public.replica` |
| `publira worker` | `8003`（`PUBLIRA_WORKER_ADDR`） | 它的三个数据库登录名：`db.outbox`、`db.ticker`和`db.content_stats`，或者`--queue`指定的队列所对应的登录名；在它承载`maintenance`队列并为其提供了[只读副本](../2-deployments/7-scaling-out.md#每日重建)时，还有`db.content_stats.replica`。在其任务队列启动之前，它也会应答未就绪 |
| `web-storefront`、`web-admin`、`web-platform` | `PORT`：在按本仓库方式构建的镜像中分别为`3000`、`4000`和`4100` | `api`，即`PUBLIRA_GRPC_URL`所指主机上`publira server`的`/readyz`；在设置了`PUBLIRA_PUBLIC_GRPC_URL`的`web-admin`上，还有`public-api`，即该变量所指主机上的同一检查；以及`redis`，即对`PNCH_REDIS_URL`处共享缓存的ping，在该缓存关闭时始终通过 |
| `email-renderer` | `8080`（`PORT`） | 无：它不依赖任何其他服务，因此只要在运行就处于就绪状态 |

`publira server --with-worker`进程会在前两行的两个端口上都作出响应，每个端口执行其所在行列出的检查，因此请像探测这两个进程一样探测它。

它们都不检查对象存储、SMTP服务器或搜索引擎。这些服务的故障会出现在日志和读者看到的内容中，而不会出现在`/readyz`中。

健康的响应如下所示：

```json
{
  "status": "ok",
  "checks": {
    "db.outbox": { "status": "ok" },
    "db.ticker": { "status": "ok" },
    "db.content_stats": { "status": "ok" }
  }
}
```

所有检查都通过时，`status`为`ok`；有检查失败时为`unavailable`；worker进程的任务队列尚未启动时为`starting`。失败的检查带有一个`error`，它只说明失败的类型——`timeout`、`dependency_failed`或`not configured`——绝不包含主机名或连接字符串，因此可以放心地向任何人展示该响应。具体原因会以注明检查名称的`readiness check failed`行写入进程的日志。

每项检查有两秒时间。`publira server`和`publira worker`依次执行各项检查，因此当所有登录名都挂起时，它们的响应大约需要六秒；Web应用则并行执行检查，大约两秒内就会响应。

### 从编排系统探测

将每个进程的存活探针指向`/livez`，就绪探针指向`/readyz`。切勿将`/readyz`用作存活探针：数据库停止响应时，编排系统会同时重启所有进程，这既不能让数据库恢复，又会使进程失去仍能通过缓存提供的内容。

只要`publira server`的`/readyz`失败，Web应用的`/readyz`也会失败，因此只要一个数据库登录名停止响应，所有Web应用就会与`publira server`一起变为未就绪。这是有意为之——无法连接到正常API的Web应用无法提供未缓存的页面——但这意味着遵循就绪状态的负载均衡器会同时停止向它们所有发送流量。在将负载均衡器指向`/readyz`之前，请先确定这是否是您想要的行为。

请为`publira server`或`publira worker`的`/readyz`探针设置超过六秒的超时，这样缓慢的检查会以其指明的失败报告出来，而不是被报告为探针超时。在Kubernetes上，worker进程的探针如下所示，[Kubernetes](../2-deployments/5-kubernetes/index.md#4-启动进程)中给出了每个进程的探针：

```yaml
livenessProbe:
  httpGet:
    path: /livez
    port: 8003
readinessProbe:
  httpGet:
    path: /readyz
    port: 8003
  timeoutSeconds: 8
```

在ECS上，服务任务的每项健康检查都相当于存活探针，因为服务会替换检查失败的任务；[健康检查](../2-deployments/6-ecs-fargate/index.md#健康检查)将它们全部指向`/livez`。

[Docker Compose](../2-deployments/3-docker-compose.md)安装实例为每个Publira进程都设置了针对其`/readyz`的healthcheck，从容器内部发起：启动后的第一分钟内每两秒检查一次，此时的失败不计入；之后每十秒检查一次，连续三次失败会将进程标记为`unhealthy`；`server`的两个端口都会被检查。`docker compose ps`会在每个服务旁显示结果，Web应用只有在`server`和Valkey健康后才会启动，代理则要等`server`、`web-storefront`和`web-admin`都健康后才会启动。镜像本身没有声明Docker的`HEALTHCHECK`：由于它们都不包含`curl`，Compose文件在服务器镜像中运行`bash`，在其他镜像中运行`node`。

没有任何东西会根据这些结果重启进程：Compose会重启已退出的进程，但不会重启挂起或变为不健康的进程，它只用这些结果来推迟等待该进程的服务。如果希望在这种情况发生时收到通知，请从外部探测安装实例，使用能够访问容器网络的监控程序，或者关注`docker compose ps`。租户网站的`/livez`和`/readyz`也可以通过每个租户域名上的反向代理访问，例如`https://comics.example.com/readyz`，互联网上的可用性监控可以使用它；API和worker进程的则不行，因为代理只会将`/rpc`和`/images`转发给`publira server`。

## 日志

`publira server`、`publira worker`和`publiractl`将日志写入标准输出，每行一条记录，默认格式为`key=value`对：

```text
time=2026-10-07T09:41:03.402Z level=ERROR msg="outbox event dead" event_id=0199b5f0-1c2e-7c41-9a8e-3f5d2a6b7c80 event_type=contact_message_reply_email idempotency_key=… attempts=10 trace_id=4bf92f3577b34da6a3ce929d0e0e4736 span_id=00f067aa0ba902b7 error="dial tcp: connection refused"
```

设置`PUBLIRA_LOG_FORMAT=json`后，每条记录改为一个带有相同键的JSON对象，日志收集器无需自己的解析规则即可读取：

```jsonl
{"time":"2026-10-07T09:41:03.402Z","level":"ERROR","msg":"outbox event dead","event_id":"0199b5f0-1c2e-7c41-9a8e-3f5d2a6b7c80","event_type":"contact_message_reply_email","idempotency_key":"…","attempts":10,"trace_id":"4bf92f3577b34da6a3ce929d0e0e4736","span_id":"00f067aa0ba902b7","error":"dial tcp: connection refused"}
```

每条记录都有`time`、`level`（`DEBUG`、`INFO`、`WARN`或`ERROR`）和`msg`。在处理被追踪的请求或任务时记录的日志还带有`trace_id`和`span_id`，可以据此在链路追踪后端找到对应的链路。其余字段取决于记录日志的来源：发件箱的记录会注明条目（`event_id`、`event_type`、`attempts`），维护任务的记录会注明运行（`job_kind`、`job_id`、`attempt`），失败的记录带有`error`。

`PUBLIRA_LOG_LEVEL`设置写入的最低级别：`debug`、`info`（默认）、`warn`或`error`。`warn`会省略繁忙安装实例中例行的`INFO`记录，同时保留所有问题。审计日志的`audit`记录以及每次登录尝试的`audit auth`记录，无论级别如何都以`INFO`写入，因为它们记录的是谁做了什么，而不是进程的运行状况。任一变量的值无法识别时，进程会在启动时停止，并给出注明该变量的消息。

Web应用和`email-renderer`则写入Next.js和Node.js自身的纯文本输出。它们的失败是以应用名称为前缀的行，例如`[web-storefront] getTenantSiteInfo failed`，失败的就绪检查记录为`health check api failed`。

### 应该针对什么告警

针对`publira server`和`publira worker`的每条`ERROR`记录设置告警是一个合理的起点：API无法响应的请求会以该级别连同其背后的错误一起记录。以下记录值得单独告警，因为每一条都意味着有东西丢失或卡住了：

| 记录 | 进程 | 含义 |
| --- | --- | --- |
| `outbox event dead` | `publira worker` | 一封邮件、一条推送通知或一次缓存重新验证被永久放弃。`event_type`指明是哪一种；[发件箱](./10-scheduled-jobs.md#查看被放弃的内容)说明了其影响 |
| `outbox event retry scheduled`，反复出现 | `publira worker` | 条目的发送目标——SMTP服务器、`email-renderer`、某个Web应用——出现故障。条目会被重试约九分钟，然后变为dead |
| `episode publish failed after all retries` | `publira worker` | 预约的章节仍为**已预约**。租户的管理员和每位运营人员也会收到通知，详见[定时发布](./10-scheduled-jobs.md#定时发布) |
| `auditlog: queue is full; dropping entry`、`auditlog: failed to persist; dropping entry` | `publira server` | 租户或平台的审计日志中丢失了一个条目 |
| `readiness check failed` | `publira server`、`publira worker` | 其指明的检查失败；`error`字段说明原因 |
| `opentelemetry error` | `publira server`、`publira worker` | 无法导出指标或链路追踪，通常是因为无法连接到收集器 |
| `failed to initialize …` | `publira server`、`publira worker` | 进程无法启动并已退出。编排系统会重启它，在原因解决之前，同样的行会反复出现 |

worker进程的定时任务如何在日志和`river_job`表中记录失败，请参阅[任务失败记录在哪里](./10-scheduled-jobs.md#任务失败记录在哪里)。

## 指标

在`publira server`和`publira worker`上设置`PUBLIRA_METRICS_ENABLED=true`后，它们会导出OpenTelemetry指标。不设置时则不导出任何指标。Web应用和`email-renderer`不导出指标。

使用`OTEL_METRICS_EXPORTER`选择导出方式：

- **`otlp`**（默认值）每60秒将指标推送到`OTEL_EXPORTER_OTLP_ENDPOINT`，即链路追踪使用的同一收集器地址。
- **`prometheus`**：在端口`9464`上的`/metrics`为Prometheus抓取器提供指标。请同时设置`OTEL_EXPORTER_PROMETHEUS_HOST=0.0.0.0`：默认值`localhost`无法从容器外部访问。当`publira server`和`publira worker`共享网络命名空间时，例如同一个Kubernetes Pod，请为它们分别设置`OTEL_EXPORTER_PROMETHEUS_PORT`。

在[Docker Compose](../2-deployments/3-docker-compose.md)安装实例上，请在`.env`中设置`PUBLIRA_METRICS_ENABLED`、`OTEL_METRICS_EXPORTER`和`OTEL_EXPORTER_PROMETHEUS_HOST`，它们会被传给`server`，然后再次运行`docker compose up -d`。其他变量以及所记录内容的完整列表，请参阅[指标参考](https://github.com/publira/publira/blob/main/server/README.md#metrics-opentelemetry)。每个进程都以一个`service.name`报告：`publira server`为`publira-api-server`，`publira worker`为`publira-worker`。`publira server --with-worker`进程（Compose文件中的`server`就是这种进程）会以`publira-api-server`报告所有内容。

### 发件箱

worker进程的指标跟踪发件箱，每封邮件、每条推送通知、每次缓存重新验证和每次Webhook发送都通过它发送，详见[发件箱](./10-scheduled-jobs.md#发件箱邮件推送和缓存重新验证)。每个指标都以`outbox.event_type`带有条目的类型。

`webhook_delivery`条目把事件发送到租户运行的服务器，无论`PUBLIRA_OUTBOX_MAX_ATTEMPTS`如何设置，都会尝试20次后才被放弃。它的重试和dead条目表示租户的端点停止运行或拒绝接收，而不是安装实例出现故障；租户管理员会在控制台中看到这些发送并重新发送。请将`outbox.event_type`为`webhook_delivery`的条目与其他条目分开告警，或将其排除在dead条目的告警之外。

| 指标 | 统计的内容 | 关注点 |
| --- | --- | --- |
| `publira.outbox.events.dead` | 被永久放弃的条目 | 任何增长。请针对它设置告警 |
| `publira.outbox.events.retry` | 将会重试的失败尝试 | 持续偏高的速率：该`outbox.event_type`的发送目标出现故障 |
| `publira.outbox.events.claimed` | worker进程领取条目进行发送的次数。被重试或恢复的条目会被再次领取并再次计数，因此即使所有条目都已发送，它的增长也比`done`快 | — |
| `publira.outbox.events.done` | 已发送的条目 | — |
| `publira.outbox.events.resumed` | 完成部分工作后被放回、留待之后继续的条目，例如发给大量读者的推送通知 | — |
| `publira.outbox.handler.duration` | 一次尝试所用的时间（秒） | 上升：SMTP服务器、`email-renderer`或某个Web应用正在变慢 |

这些计数器说明的是worker进程做了什么，而不是还有什么在等待。已停止发送的worker进程根本不会报告任何内容，其`/readyz`也不会察觉：它检查的是数据库登录名，而不是条目是否在流动。要查看在等待的内容，请以数据库的[管理登录名](../2-deployments/2-installing.md#准备服务)连接，使用`psql`统计已到期但未发送的条目，以及已领取却始终未完成的条目：

```sql
SELECT status, count(*), min(updated_at)
FROM outbox_events
WHERE (status = 'pending' AND available_at < now() - interval '5 minutes')
   OR (status = 'processing' AND updated_at < now() - interval '15 minutes')
GROUP BY status;
```

健康的worker进程会在条目到期后几秒内发送它，并在15分钟后将处理到一半的条目放回等待，因此这条查询只要返回任何行，就说明worker进程没有在消化积压。

### 审计日志

`publira server`通过队列写入租户控制台和平台控制台的审计日志，因此请求不必等待其条目写入。`publira.auditlog.queue.depth`是等待中的条目数，`publira.auditlog.entries.dropped`按`auditlog.drop_reason`统计丢失的条目。请针对任何丢失以及持续增长的队列深度设置告警：这说明数据库跟不上了。审计日志的其他指标请参阅其[参考](https://github.com/publira/publira/blob/main/server/README.md#operational-monitoring-for-the-asynchronous-audit-log)。

## 链路追踪

除`email-renderer`之外的每个进程，在设置`PUBLIRA_TRACING_ENABLED=true`后都会导出OpenTelemetry链路追踪。请同时为`publira server`、`publira worker`和Web应用开启：这样一个页面请求就是一条链路，从Web应用经过API一直到它执行的数据库查询。

使用OpenTelemetry SDK自行读取的变量将它们指向您的收集器：

| 变量 | 设置内容 |
| --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | 收集器，例如`http://otel-collector:4318` |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf`。`publira server`和`publira worker`也接受`grpc`，但Web应用不接受，因此`http/protobuf`是适用于所有进程的值 |
| `PUBLIRA_DEPLOYMENT_ENVIRONMENT` | `production`或环境名称。它会记录在每个span上，并决定下面的采样 |

在[Docker Compose](../2-deployments/3-docker-compose.md)安装实例上，请在`.env`中设置这些变量和`PUBLIRA_TRACING_ENABLED`，它们会被传给`server`（它同时运行worker进程）和Web应用，然后再次运行`docker compose up -d`。

每个进程都以自己的`service.name`报告：`publira server`提供的三个API分别为`publira-api-server`、`publira-admin-api-server`和`publira-platform-api-server`，其图片分发为`publira-image-server`；`publira worker`为`publira-worker`，每个定时任务各有一个名称；`publira server --with-worker`在一个进程中同时运行两者时，这些名称全部保留；Web应用分别为`publira-web-storefront`、`publira-web-admin`和`publira-web-platform`。完整列表以及每个span上记录的内容，请参阅[服务器的链路追踪参考](https://github.com/publira/publira/blob/main/server/README.md#distributed-tracing-opentelemetry)。`publira server`的健康检查不会被追踪，因此探针不会每隔几秒就向后端塞入一条链路。

### 采样

未设置`PUBLIRA_DEPLOYMENT_ENVIRONMENT`时，每个进程都将自己视为`development`，并记录每一条链路。设置为其他任何值时，每十条链路记录一条。这个决定只在链路开始的地方做出一次，请求随后到达的每个进程都会沿用它，因此一条链路要么被完整记录，要么完全不被记录。请在每个进程上设置相同的值。

要以其他比率采样，请设置SDK自身的`OTEL_TRACES_SAMPLER`和`OTEL_TRACES_SAMPLER_ARG`，例如`parentbased_traceidratio`和`0.25`，它们会在所设置的每个进程上取代默认设置。

### 边缘为什么要删除链路追踪请求头

每个进程都信任请求携带的链路上下文：`traceparent`请求头会让其span成为调用方链路的一部分，并带有调用方的采样决定。Web应用的span正是由此与API的span连接起来的。然而，浏览器或移动应用也可以发送同样的请求头，借此将自己的span附加到别人的链路上，或者将每个请求都标记为已采样，从而突破十分之一的比率，为每个请求导出一条链路。

因此，安装实例前面的边缘会从其转发的每个请求中删除`traceparent`、`tracestate`和`baggage`，这是[追踪上下文](../2-deployments/4-edge/index.md#追踪上下文)对每个边缘的要求，于是来自外部的每个请求都会开始一条新的链路。Web应用调用API，以及API和worker进程调用Web应用，都是直接在私有网络上进行，而不经过边缘，因此它们的链路上下文会被保留。
