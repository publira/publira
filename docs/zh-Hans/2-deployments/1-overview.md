---
title: 概览
description: Publira安装实例运行什么，以及它依赖哪些服务。
published: 2026-11-03
updated: 2026-11-05
source_updated: 2026-11-05
---

一个Publira安装实例由四个长期运行的进程、它们依赖的几项服务，以及一个由您手动运行的命令行工具组成。本页介绍能为一个租户提供服务的最小安装实例：它的公开网站和控制台，通过`publiractl`而不是平台控制台来管理。

## 安装实例运行什么

| 进程 | 提供 | 由谁访问 |
| --- | --- | --- |
| `web-storefront` | 每个租户的公开网站 | 边缘，在每个租户的域名上 |
| `web-admin` | 租户控制台 | 边缘，在每个租户的控制台主机上，除非为租户另行指定，否则为`admin.<domain>` |
| `publira server` | 位于`/rpc`下的API以及图片分发，使用同一个端口 | 边缘，在`/rpc`下的公开API、API密钥可调用的读取请求和`/images`上；`web-storefront`和`web-admin`，在`/rpc`上 |
| `publira worker` | 外发邮件和推送通知、缓存重新验证，以及所有定时任务 | 无；它只应答健康检查 |

每个进程都会应答`GET /livez`和`GET /readyz`，因此编排系统可以对它进行探测。各个Web应用由同一个镜像构建，`publira server`和`publira worker`则由另一个镜像构建；[镜像构建说明](https://github.com/publira/publira/blob/main/infra/docker/README.md)列出了它们。

如果安装实例只在一台主机上运行，并且服务器和worker进程永远不会超过一个副本，那么可以把两者作为一个进程运行：`publira server --with-worker`完成两个进程的所有工作，使用相同的两个端口，并读取两者的变量。这样做会失去两点。您无法再分别扩展服务器和worker进程。而且，面向互联网的进程还会持有worker进程的三个数据库登录，其中一个拥有作业队列的表，并且可以自行创建表。[Docker Compose](./3-docker-compose.md)安装实例就把它们作为一个进程运行。如果其中任一点对您很重要——需要分别扩展它们，或者不想让worker进程的登录出现在面向互联网的进程中——请将两者分开运行。

`publira server`只监听一个端口，因此像Cloud Run这样每个服务只暴露一个端口的平台，可以将它原样作为一个服务运行。您也可以在负载均衡器后面再运行一个使用`--role storefront`的`publira server`服务，它只提供公开API和租户网站的图片，并把租户的域名以及只调用公开API的`web-storefront`路由到它：这样，为读者提供服务的进程只以店面的登录身份连接数据库，每个请求只限于一个租户，而且既不持有任何一个控制台的登录，也不持有Web应用调用控制台时使用的凭据。第一个服务继续为`web-admin`、`web-platform`和控制台主机提供服务。[部署参考](https://github.com/publira/publira/blob/main/infra/deploy/README.md#long-lived-processes)列出了每种角色提供什么、读取什么。

图片分发和公开API也可以分开访问，各自使用自己的主机名，并位于各自的负载均衡器后面：租户网站的图片在您为其指定的图片主机上，公开API在Web应用和移动应用所指向的主机上。两者都是`--role storefront`进程，因此进程本身没有任何变化，变化的只是主机名以及它们前面的负载均衡器。[分开提供图片和公开API](./7-scaling-out.md#分开提供图片和公开api)介绍了具体做法。

没有任何进程保存自己的状态。安装实例存储的内容位于PostgreSQL和对象存储中，进程运行时共享的内容位于Valkey中，而会话是浏览器回传的Cookie，因此任何进程都可以运行多个副本，边缘在它们之间分发请求时也不需要会话粘滞。[横向扩展](./7-scaling-out.md)说明了安装实例增长时应该增加哪些进程，以及哪些内容必须先共享。

## 它依赖的服务

| 服务 | 使用者 | 保存的内容 |
| --- | --- | --- |
| 边缘：负载均衡器、反向代理，或位于其前面的CDN | 浏览器和移动应用 | 将每个主机和路径发送到正确进程的路由，以及TLS |
| PostgreSQL | 所有进程 | 安装实例存储的全部内容 |
| Valkey，或任何支持Redis协议的服务器 | `publira server`、`web-storefront`、`web-admin` | 图片转换缓存、速率限制计数器，以及Web应用的共享缓存 |
| 兼容S3的对象存储 | `publira server`、`publira worker` | 所有上传的图片 |
| SMTP服务器 | `publira worker` | 无；它投递安装实例发送的邮件，例如读者注册和密码重置邮件 |

数据库和存储桶由您创建；其中的所有内容由Publira创建。边缘是您的平台在进程前面提供的任何东西，例如托管的负载均衡器或您自己运行的代理，无论是哪一种，[边缘](./4-edge/index.md#边缘必须做什么)都说明了它必须做什么。仓库中的Traefik、nginx和Caddy示例配置是实现方式之一。

## 需要手动运行的命令

`publiractl`在每个版本中应用数据库迁移和角色、设置新的安装实例，并在之后修改平台设置。不需要任何东西定时运行它：`publira worker`会自行调度所有周期性作业。

## 可以添加的进程

| 进程 | 增加的功能 |
| --- | --- |
| `email-renderer` | 为每封邮件添加HTML部分。不使用它时，同样的邮件以纯文本发送 |
| `web-platform` | 平台控制台，运营人员可以在浏览器中而不是通过`publiractl`管理租户和平台设置 |

## 后续步骤

[安装](./2-installing.md)会逐步引导您让一个空的安装实例投入使用。每个进程读取的环境变量列在[部署参考](https://github.com/publira/publira/blob/main/infra/deploy/README.md)中。
