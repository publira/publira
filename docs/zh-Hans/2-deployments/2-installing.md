---
title: 安装
description: 让一个空的安装实例投入使用，从它依赖的服务一直到首次登录租户控制台。
published: 2026-11-03
updated: 2026-11-05
source_updated: 2026-11-05
---

本页将一个安装实例从零开始，带到第一位管理员可以登录的租户控制台。它按照各步骤必须执行的顺序展开，并说明每一步决定了什么；每个进程读取的完整变量列表以及`publiractl`的所有参数，仍保留在各步骤所链接的参考文档中。

本页介绍的是[概览](./1-overview.md)中的最小安装实例：`web-storefront`、`web-admin`、`publira server`和`publira worker`，通过`publiractl`管理。末尾的[启用可选进程](#启用可选进程)会加入HTML邮件和平台控制台。

## 开始之前

每个版本都会将其镜像以`ghcr.io/publira/<name>:<tag>`的形式发布到GitHub Container Registry，标签为该版本的版本号，即去掉`v`的Git标签，例如`v0.1.0`对应`0.1.0`。这些镜像包括`publira`、`publiractl`、`web-storefront`和`web-admin`，以及用于可选进程的`web-platform`和`email-renderer`。它们是公开的，因此您的主机无需登录即可拉取，也无需构建任何东西。每个镜像都为`linux/amd64`和`linux/arm64`发布；其他平台上的主机找不到可拉取的镜像。本页的示例将它们写作`ghcr.io/publira/<name>:<tag>`；请把`<tag>`替换为您要安装的版本的版本号。[版本发布](./10-releases.md)说明了标签的编号方式。

修改了代码，或运行在其他平台上的安装实例，则改为自行构建镜像：在它所运行的提交上按照[镜像构建说明](https://github.com/publira/publira/blob/main/infra/docker/README.md)构建，推送到其主机拉取镜像的位置，并在所有地方用它们替代已发布的镜像。

每个`publiractl`步骤都运行您要安装的版本的`publiractl`镜像。该镜像包含这个版本的迁移和角色定义，因此使用其他版本的镜像会应用进程所不期望的数据库结构。

如果要在一台主机上运行整个安装实例，仓库中的Compose文件会为您准备好各项服务并接好变量，详见[Docker Compose](./3-docker-compose.md)。它运行的仍然是下面这些步骤。

## 准备服务

请在第一步之前创建以下内容。Publira会在其中创建所需的一切，因此每一项都从空的状态开始。

- **一个PostgreSQL数据库**，以及一个拥有该数据库并可以创建角色的管理登录。在您自己运行的PostgreSQL服务器上，这就是它的超级用户。对于把超级用户留给自己的托管PostgreSQL，它会改为提供这类登录，例如Cloud SQL的`postgres`用户，而Publira需要的也不过如此：不需要超级用户，也不需要能绕过行级安全的角色。只有`publiractl db`命令以这个登录连接，任何长期运行的进程都不会使用它。
- **一个Valkey实例**，或任何支持Redis协议的服务器。`publira server`、`web-storefront`和`web-admin`共享它，用于图片转换缓存、速率限制计数器以及Web应用的缓存。带密码的连接必须使用启用TLS的`rediss://`：如果`redis://` URL中带有密码，`publira server`会拒绝启动。
- **兼容S3的对象存储中的一个空存储桶**，以及一个可以读写它的凭据。所有上传的图片都保存在这里。`publiractl setup`会保存存储桶和凭据，因此进程访问它时不需要其他任何东西。如果希望进程改用其环境中的凭据（例如实例角色），请在设置时省略访问密钥，并为`publira server`、`publira worker`和`publiractl`提供`AWS_*`变量。
- **一台SMTP服务器**：它的主机、端口、加密方式、发件地址，以及用于登录的用户名和密码——除非它像本地MTA或信任主机地址的中继那样无需凭据即可转发。读者注册、密码重置和管理员邀请都通过它发送。
- **DNS**：为租户的域名和`admin.<domain>`设置记录，两者都指向安装实例前面的边缘。前者提供租户的公开网站，后者提供其控制台。如果控制台应该使用其他主机名，请现在就决定：`publiractl setup`通过`--admin-domain`接收它。

## 生成密钥

安装实例需要几项只有您持有的密钥。请为每个环境生成一组全新的值，保存在您的密钥存储中，并且绝不要复用仓库中写着的任何值：那些值用于本地开发，是公开的。

| 密钥 | 生成方式 | 设置在 | 保护的内容 |
| --- | --- | --- | --- |
| 密钥加密密钥 | `k1:$(openssl rand -base64 32)`作为`PUBLIRA_SECRET_ENCRYPTION_KEYS`，`k1`作为`PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID` | `publira server`、`publira worker`、`publiractl` | 安装实例存储的所有凭据：SMTP密码、对象存储的私有密钥、搜索引擎的密码、Web Push私钥，以及每个租户的支付、推送和登录凭据 |
| 访问令牌签名密钥 | `openssl rand -base64 32`作为`PUBLIRA_AUTH_JWT_SECRET` | `publira server` | 每个已登录的会话。持有它的人可以为任意用户签发令牌，并以该用户的身份调用所有API |
| 每个Web应用的会话密钥 | `openssl rand -base64 32`作为该应用的`PUBLIRA_AUTH_SECRET` | `web-storefront`和`web-admin`，各一个 | 携带用户访问令牌的会话Cookie。两个应用可以共用一个，但不是必须 |
| 缓存重新验证令牌 | `openssl rand -hex 32` | `publira server`、`publira worker`、`web-storefront`和`web-admin`，作为`PUBLIRA_REVALIDATE_TOKEN` | 服务器在发生更改后调用、用于丢弃Web应用已缓存页面的端点。没有它，服务器不会发送任何请求，Web应用会继续提供更改前缓存的内容 |
| Web服务令牌 | `openssl rand -base64 32`作为`PUBLIRA_WEB_SERVICE_TOKEN` | `publira server`和`web-admin` | 控制台以自身身份而不是以某位工作人员的身份进行的读取，例如所有工作人员看到的都相同的目录列表，这样它就可以为所有人只缓存一次。没有它，`web-admin`不会启动 |
| 每个数据库角色各一个密码 | `openssl rand -hex 32`，执行六次 | `publiractl db roles`，以及使用该角色的进程的连接URL | 数据库本身。连接URL中的密码不经转义，因此请只使用URL安全的字符，十六进制输出正是如此 |

加密密钥最需要小心对待。您向`publiractl setup`提供SMTP密码或对象存储的密钥时，它会用这些加密密钥将其封存，而`publira server`和`publira worker`会用它们收到的密钥解封。使用其他密钥的进程无法读取`publiractl`存储的内容：worker进程将无法发送邮件，服务器将无法访问对象存储。一旦丢失这些密钥，所有已存储的凭据都必须重新输入。如果以后要替换某个密钥而不丢失它所封存的内容，请把新密钥添加在旧密钥旁边，而不是替换旧密钥，详见[轮换密钥加密密钥](../3-operations/12-security/1-rotating-secrets.md#轮换密钥加密密钥)。

## 数据库角色

进程从不以管理登录连接。`publiractl db roles`会创建六个登录角色，安装实例的每个部分都以与其职责相符的角色连接：

| 角色 | 连接目的 | 可以访问的内容 |
| --- | --- | --- |
| `publira_public` | `publira server`，为公开网站和移动应用提供服务 | 请求所针对的租户的行 |
| `publira_admin` | `publira server`，为租户控制台提供服务 | 请求所针对的租户的行 |
| `publira_platform` | `publira server`，为平台控制台提供服务，以及修改平台设置的`publiractl`命令，其中包括`setup` | 所有租户，以及平台自身的设置 |
| `publira_outbox` | `publira worker`，发送邮件和推送通知、重新验证缓存 | 所有租户，以及其邮件所需的平台设置 |
| `publira_ticker` | `publira worker`，运行在预定时间一到就立即执行的作业，例如发布章节 | 这些作业涉及的少数几张表 |
| `publira_content_stats` | `publira worker`和`publiractl job`，运行维护和汇总作业 | 所有租户，以及这些作业读取的平台设置 |

正是这种拆分让一个租户的数据与其他租户的数据保持隔离。应答读者请求和租户工作人员请求的两个角色受行级安全约束，只能访问请求所指定的租户，因此其中任一路径上的缺陷都无法读取其他租户的行。平台自身的表保存着运营人员的密码哈希和平台的邮件凭据，除`publira_platform`之外的所有角色都无法访问，只有回授给其他角色的少量读取权限例外：worker进程的角色可以读取其作业和邮件所需的设置，租户控制台的角色可以读取其请求所应用的少数设置，其中包括平台邮件的发件地址，但不包括与之一同存储的邮件服务器、账户和密码。因此，每个进程对其使用的每个角色各有一个连接URL，[部署参考](https://github.com/publira/publira/blob/main/infra/deploy/README.md#per-process)列出了哪个变量对应哪个连接。

## 启动安装实例

### 1. 应用迁移

在管理登录的连接上运行`db migrate`。它会创建数据库结构，没有需要应用的内容时则不做任何更改就退出。

```bash
docker run --rm -e PUBLIRA_DB_URL ghcr.io/publira/publiractl:<tag> db migrate
```

`PUBLIRA_DB_URL`就是这个连接，例如`postgres://postgres:<password>@db.internal:5432/publira?sslmode=require`。

### 2. 创建角色

在同一个连接上运行`db roles`，为每个角色提供您为它生成的密码。它会对迁移创建的表授予权限，因此在第二步运行。

```bash
docker run --rm -e PUBLIRA_DB_URL -v /run/secrets:/run/secrets:ro ghcr.io/publira/publiractl:<tag> db roles \
  --public-password-file /run/secrets/publira-public-db-password \
  --admin-password-file /run/secrets/publira-admin-db-password \
  --platform-password-file /run/secrets/publira-platform-db-password \
  --outbox-password-file /run/secrets/publira-outbox-db-password \
  --ticker-password-file /run/secrets/publira-ticker-db-password \
  --content-stats-password-file /run/secrets/publira-content-stats-db-password
```

再次运行它时，除了所提供的密码之外不会改变任何东西，因此以后轮换角色密码也是用它。传递密码的其他方式见[`publiractl`参考](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#db)。

### 3. 启动四个进程

使用同一版本的镜像启动`publira server`、`publira worker`、`web-storefront`和`web-admin`——前两个使用`ghcr.io/publira/publira:<tag>`，第二个以`worker`作为容器参数，另外两个分别使用`ghcr.io/publira/web-storefront:<tag>`和`ghcr.io/publira/web-admin:<tag>`——并设置[部署参考](https://github.com/publira/publira/blob/main/infra/deploy/README.md#environment-variables)中的变量。每个连接URL都写明其角色以及`db roles`为它设置的密码，例如`PUBLIRA_PUBLIC_DB_URL`为`postgres://publira_public:<password>@db.internal:5432/publira?sslmode=require`。请设置所有连接URL：未设置的连接URL会回退到开发用的URL，而不是您的其他某个变量，并因此无法登录。

`publira worker`在启动时会创建其作业队列的表，因此不需要单独的步骤。`publira server`和`publira worker`都会在`GET /readyz`中为每个数据库登录报告一项检查，因此密码不匹配的角色会在那里被指出。

### 4. 设置安装实例

`publiractl setup`会保存安装实例为第一个租户提供服务所需的内容，并创建该租户的第一位管理员：

1. 平台的默认语言区域、新租户起始使用的时区，以及在租户管理员选择之前租户销售时使用的货币（除非另行指定，否则为`USD`）。
2. 对象存储，必须先通过连接测试。
3. 可选：作品目录搜索引擎，除非您另行选择，否则就是数据库本身。
4. SMTP设置，以及测试邮件（如果您提供了接收地址）。对于不需要凭据的中继，请将用户名留空：邮件将不经登录直接发送，也不会询问密码。
5. 可选：Web Push。
6. 租户，及其域名。
7. 租户的第一位管理员，密码可以由您输入，也可以由它生成。

它以`publira_platform`连接，并用加密密钥封存它保存的凭据，因此请为它提供与进程运行时相同的密钥：

```bash
docker run --rm -it \
  -e PUBLIRA_PLATFORM_DB_URL \
  -e PUBLIRA_SECRET_ENCRYPTION_KEYS -e PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID \
  ghcr.io/publira/publiractl:<tag> setup
```

在终端中运行时，它会询问每一个值。同样的运行也可以在无人值守的情况下进行，例如在CI作业或初始化容器中，通过参数提供所有值；这种形式见[`publiractl`参考](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#setup)。它输出的链接基于`PUBLIRA_TENANT_URL_SCHEME`构建，即读者浏览器访问租户时使用的协议，未设置时为`https`。它描述的是公开地址，而不是代理如何访问进程，因此TLS终止点后面的纯HTTP这一跳不会改变它。只有当浏览器确实通过HTTP打开租户时才将其设为`http`，并且要在`publiractl`和各进程上同样设置。

如果运行中途停止，例如某项连接测试失败，再运行一次即可完成：它会保留已经保存的每一步，只询问剩下的部分。测试邮件被拒绝是个例外：SMTP设置在测试之前就已保存，因此下一次运行会保留它们，并且不再发送测试邮件。请用`publiractl smtp set`更正错误的设置，用`publiractl smtp test`发送测试邮件，详见[邮件](../3-operations/6-email.md#测试账户)，然后再次运行`setup`。

`setup`也可以自己完成第1步和第2步，并创建尚不存在的空存储桶。提供`PUBLIRA_DB_URL`和每个角色的密码时，它会在自己的步骤之前应用迁移并创建角色；使用`--create-bucket`时，它会在连接测试之前创建存储桶。对于在`setup`完成之后才运行所有进程的安装实例（[Docker Compose](./3-docker-compose.md)安装实例就是如此），这样就不再需要其他命令；相关参数见[`publiractl`参考](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#the-database-steps)。

最后的摘要会列出租户网站和租户控制台，如果管理员密码是生成的，还会输出该密码。生成的密码只会出现在这里，因此请在关闭终端之前保存好它。

### 5. 在前面放置边缘

边缘是接收读者请求并将其转发给进程的任何东西：由您的平台管理的负载均衡器、您自己运行的反向代理，或由它们组成的链。将两个主机名路由到各个进程：

- `admin.<domain>`或您选择的控制台主机，路由到`web-admin`。
- 租户的域名，路由到`web-storefront`。
- 两个主机上的`/rpc/publira.v1.`和`/images`，路由到`publira server`，默认端口为`8000`。
- 两个主机上`/rpc`的其余部分不路由到任何地方：由边缘以`404`应答。那里是`publira server`应答控制台API的位置，Web应用通过私有网络调用这些API，详见[只有公开API经过边缘](./4-edge/index.md#只有公开api经过边缘)。使用API密钥的租户自有系统需要在控制台主机上转发其中的[少数读取请求](./4-edge/index.md#api密钥可调用的读取请求)。

在边缘为两个主机名终止TLS。无论边缘由什么构成，[边缘必须做什么](./4-edge/index.md#边缘必须做什么)都说明了它还需要做的其余事项：它要传递和要移除的请求头、客户端地址，以及它必须放行的上传和Webhook。仓库中针对Traefik、nginx和Caddy的[示例配置](./4-edge/1-sample-configurations.md)是实现这一切的方式之一。

### 6. 登录

打开`setup`摘要中输出的租户控制台URL——`https://admin.<domain>`，或您通过`--admin-domain`指定的控制台主机——然后使用管理员的电子邮件地址和密码登录。租户控制台会打开`setup`创建的租户，从这里可以邀请其工作人员并配置网站。租户的公开网站在`https://<domain>`上应答。

## 启用可选进程

这两个进程都可以添加到已经在提供服务的安装实例中。它们都不保存自己的数据；启用其中一个，只需运行它，并重启变量发生变化的进程。

### 使用`email-renderer`发送HTML邮件

没有`email-renderer`时，worker进程以纯文本发送所有邮件。运行它，并在`publira worker`上将`PUBLIRA_EMAIL_RENDERER_URL`设为它在私有网络上的地址，例如`http://email-renderer:8080`；此后每封邮件都会在同样的文本旁边附带HTML部分。设置该变量后，渲染器就成为发送邮件的一部分：它停止运行时，worker进程会暂存每封邮件并重试，而不会回退到纯文本。

### 使用`web-platform`提供平台控制台

`web-platform`就是平台控制台，运营人员可以在浏览器中而不是通过`publiractl`管理租户和平台设置。运行它需要：

- 用与其他Web应用相同的方式为它生成一个会话密钥，并设为它的`PUBLIRA_AUTH_SECRET`，长度至少32字节；没有它，任何运营人员都无法登录。为它设置与`web-admin`相同的`PUBLIRA_GRPC_URL`、`PUBLIRA_WEB_SERVICE_TOKEN`、`PNCH_REDIS_URL`和`PUBLIRA_REVALIDATE_TOKEN`。
- 在`publira server`和`publira worker`上设置`PUBLIRA_WEB_PLATFORM_INTERNAL_URL`，使缓存重新验证能够到达它；并在`publira worker`上设置`PUBLIRA_PLATFORM_APP_URL`，即运营人员打开它的地址，其邮件中的链接以此构建。
- 为它选择一个主机名，例如`platform.example.com`，将其指向边缘，为边缘提供该主机名的证书，并将其路由到`web-platform`，路径与其他主机相同，详见[路由](./4-edge/index.md#路由)。示例配置通过`PUBLIRA_EDGE_PLATFORM_HOSTS`接收它。

打开它，并在设置界面上创建第一位运营人员。该运营人员与`publiractl setup`创建的租户管理员是分开的：平台控制台有自己的账户，在第一个账户创建之前会一直提供设置界面。在该界面上选择的语言会成为平台的默认语言区域，替换`publiractl setup`保存的那个，时区也是如此，界面初始显示的是您浏览器的时区。界面还会询问默认货币，初始为`publiractl setup`保存的货币，因此保持不变即可沿用它。其他所有设置都保持不变，`publiractl`也可以与控制台并行使用。

## 后续步骤

每个进程读取的完整变量列表见[部署参考](https://github.com/publira/publira/blob/main/infra/deploy/README.md)，可选变量则见[`publira server`和`publira worker`](https://github.com/publira/publira/blob/main/server/cmd/publira/README.md)、[`web-storefront`](https://github.com/publira/publira/blob/main/apps/web-storefront/README.md)、[`web-admin`](https://github.com/publira/publira/blob/main/apps/web-admin/README.md)以及[`web-platform`](https://github.com/publira/publira/blob/main/apps/web-platform/README.md)的README。所有`publiractl`命令见[`publiractl`参考](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md)。

此后每发布一个新版本，[升级](./8-upgrading.md)都会将安装实例带到新版本：先使用该版本的`publiractl`镜像应用迁移和角色，然后升级其进程。
