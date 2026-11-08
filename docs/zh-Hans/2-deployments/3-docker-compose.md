---
title: Docker Compose
description: 使用每个版本发布的Compose文件在一台主机上运行完整的安装实例，从下载文件一直到首次登录租户控制台。
published: 2026-11-03
updated: 2026-11-08
source_updated: 2026-11-08
---

每个版本都会发布一个Compose文件，用于在一台主机上运行完整的安装实例：Publira依赖的服务、安装实例的各个进程，以及位于它们前面的反向代理，全部已经连接好。这是获得一个可用安装实例的最短路径，本页将带您从一台空主机走到首次登录租户控制台。

Compose文件执行的步骤与[安装](./2-installing.md)相同，那个页面解释了每一步为何存在、每项密钥保护什么，以及每个数据库角色可以访问什么。本页介绍Compose文件特有的内容：它运行什么、您需要在其中设置什么，以及启动它的命令。它读取的完整变量列表见[部署参考](https://github.com/publira/publira/blob/main/infra/deploy/README.md#running-it-with-docker-compose)。

## 文件运行什么

[`infra/deploy/compose.yaml`](https://github.com/publira/publira/blob/main/infra/deploy/compose.yaml)定义了以下服务：

| 服务 | 是什么 | 在主机上保存的内容 |
| --- | --- | --- |
| `postgres` | PostgreSQL，保存安装实例存储的全部内容 | `postgres-data`卷 |
| `valkey` | Valkey，保存图片转换缓存、速率限制计数器以及Web应用的缓存 | 无；每次重启后都从空的状态开始 |
| `rustfs` | [RustFS](https://github.com/rustfs/rustfs)，一个兼容S3的对象存储，保存所有上传的图片 | `rustfs-data`卷 |
| `proxy` | Caddy，即反向代理，使用仓库自带的路由，负责获取并续期您的主机名的证书 | `caddy-data`卷，保存证书 |
| `server` | 作为一个进程运行的`publira server`和`publira worker`，即`publira server --with-worker`，[概览](./1-overview.md#安装实例运行什么)中有相关说明 | 无 |
| `web-storefront`、`web-admin` | 公开网站和租户控制台 | 无 |
| `web-platform`、`email-renderer` | 可选进程，只有在您启用时才运行 | 无 |
| `publiractl` | 命令行工具，从不常驻运行：通过`docker compose run --rm publiractl <command>`运行 | 无 |
| `setup` | 已经传入安装实例的数据库密码和RustFS存储桶的`publiractl setup`，从不常驻运行：通过`docker compose run --rm setup`运行 | 无 |

服务器和worker进程作为一个进程运行，因此主机上少运行一个容器。如果以下任一点对您的安装实例很重要，请改为将它们作为两个进程运行：需要分别扩展它们，或者不想让worker进程的数据库登录出现在代理转发请求的进程中。[部署参考](https://github.com/publira/publira/blob/main/infra/deploy/README.md#environment-variables)列出了两者各自读取的变量。

代理在主机的所有网络接口上发布80和443端口，是互联网唯一能访问到的服务：它为您列出的主机名提供HTTPS，并将纯HTTP重定向到那里。其他所有服务只能由彼此访问。

这些服务位于两个Docker网络上。`edge`包含代理以及它转发请求的目标：`server`和各个Web应用。`default`包含除代理之外的所有服务。因此，代理既访问不到数据库，也访问不到Valkey，代理中的缺陷不会成为进入两者的途径。

项目名称固定为`publira-deploy`，因此无论您从哪个目录运行哪条命令，卷都保持相同的名称，并且一台主机只运行一个安装实例。

## 开始之前

您需要：

- **一台装有Docker Engine和Compose插件（`docker compose`）的主机**，平台为`linux/amd64`或`linux/arm64`，即镜像所发布的两个平台。在其他平台上，第一次拉取会以`no matching manifest`失败，主机需要改为运行为它构建的镜像，详见[镜像](#镜像)。
- **您要安装的版本**，它以`publira-deploy-<version>.tar.gz`的形式附在[Releases](https://github.com/publira/publira/releases)页面上对应的版本中，[下载Compose文件](#下载compose文件)会获取它。主机上不需要仓库中的其他任何东西。
- **主机能够访问`ghcr.io`**，每个版本都在那里发布其镜像。`docker compose`会在某条命令第一次需要镜像时拉取它们，无需登录，因此主机上不需要构建任何东西。
- **一台SMTP服务器**，`publiractl setup`会询问它的信息：主机、端口、加密方式、发件地址，以及用于登录的用户名和密码——除非它无需凭据即可转发。
- **DNS**：为租户的域名及其控制台主机（`admin.<domain>`，或您将通过`--admin-domain`指定的主机）设置记录，两者都指向这台主机。
- **向互联网开放的80和443端口**，并且主机上没有其他程序监听这两个端口。代理在两个端口上都会应答，证书颁发机构在为每个主机名签发证书之前，会通过其中一个端口检查该主机名。

## 下载Compose文件

下载您要安装的版本的归档文件，其中`<version>`是该版本的版本号：即去掉`v`的标签，例如`v0.1.0`对应`0.1.0`。然后解压，并进入解压出的目录：

```bash
curl -fsSLO https://github.com/publira/publira/releases/download/v<version>/publira-deploy-<version>.tar.gz
tar -xzf publira-deploy-<version>.tar.gz
cd publira-deploy-<version>
```

版本还附带了归档文件的签名。要确认归档文件就是该版本发布的那个，请在运行`tar`之前，按照[Compose安装文件](./10-releases.md#compose安装文件)中的说明进行验证。

其中包含`compose.yaml`、`.env.example`、代理的`Caddyfile`，以及一个列出全部变量的`README.md`。本页的所有命令都在这个目录中运行。

如果您修改了代码，请改为从仓库的检出副本运行安装实例：检出到该版本的标签，在`infra/deploy/`中运行。那里包含相同的文件，只是其中的`Caddyfile`是指向`infra/proxy/`的链接，因此请保留整个检出副本，而不要把`infra/deploy/`单独复制出来。

## 编写`.env`

文件所需的每个值都来自它旁边的`.env`文件。`publiractl env generate`会根据`.env.example`写出这个文件，`.env.example`列出了文件读取的每个变量并为每个变量附有注释，而该命令会为每项密钥填入一个独立的值。请使用您要安装的版本的`publiractl`镜像运行它，其中`<version>`是该版本的版本号，与[下载Compose文件](#下载compose文件)中相同：

```bash
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD":/work -w /work \
  ghcr.io/publira/publiractl:<version> env generate
```

它会输出`Wrote .env with 17 secrets generated.`，除此之外没有其他输出。镜像以您的用户身份运行，因此该文件归您所有，并且创建时只有您可以读取。它拒绝覆盖已有的`.env`，因为其中可能保存着封存安装实例数据所用的密钥。这一步无法用`docker compose run`来运行，因为在`.env`缺少接下来三节所设置的值时，它会停止。

`.env`保存着安装实例的所有密钥，其中包括加密密钥，因此请在主机之外的地方保留一份副本。

其中还剩三个值需要您设置：两个主机列表`PUBLIRA_EDGE_SITE_HOSTS`和`PUBLIRA_EDGE_ADMIN_HOSTS`，以及用于启用HTTPS的`PUBLIRA_EDGE_ACME_EMAIL`。在检出副本中，`PUBLIRA_IMAGE_TAG`是第四个。

### 镜像

`PUBLIRA_IMAGE_REGISTRY`和`PUBLIRA_IMAGE_TAG`以`<registry>/<name>:<tag>`的形式指定镜像。示例中的镜像仓库`ghcr.io/publira`是每个版本发布镜像的位置；请保持不变。标签已经是您下载的版本的版本号，例如在`v0.1.0`的归档中为`0.1.0`：

```text
PUBLIRA_IMAGE_TAG=0.1.0
```

它也请保持不变。所有镜像都运行这一个标签，而且它必须与`.env`旁边的文件相匹配：`publiractl`包含其版本的迁移，各进程期望其版本的数据库结构，代理则运行旁边`Caddyfile`中的路由。在检出副本中，`.env.example`将标签留空：请将其设为检出副本所在版本的版本号。

如果您修改了代码，或者主机既不是`linux/amd64`也不是`linux/arm64`，请改为按照[镜像构建说明](https://github.com/publira/publira/blob/main/infra/docker/README.md)自行构建镜像，并将这两个变量设为镜像所在的位置：您推送镜像的镜像仓库地址（例如`registry.example.com/publira`）和您自己的标签；对于`task docker:verify:full`在主机本身上构建的镜像，则设为`publira`和`local`。

### HTTPS与租户URL协议

`PUBLIRA_EDGE_ACME_EMAIL`用于启用HTTPS。请将其设为您自己的地址，代理会用它在证书颁发机构注册账户：

```text
PUBLIRA_EDGE_ACME_EMAIL=ops@example.com
```

之后，代理会为主机列表中的每个主机名从[Let's Encrypt](https://letsencrypt.org/)获取证书（Let's Encrypt失败时则从ZeroSSL获取），在每张证书过期前续期，在443端口上提供HTTPS，并将80端口上的纯HTTP重定向到那里。留空时，代理只提供纯HTTP，只有[在一台机器上试用](#在一台机器上试用)和[前面有CDN或负载均衡器](#前面有cdn或负载均衡器)才需要这样做。

`PUBLIRA_EDGE_HTTP_PORT`和`PUBLIRA_EDGE_HTTPS_PORT`是代理发布的端口，即`80`和`443`。在代理获取证书期间请保持不变：证书颁发机构只通过这两个端口访问它。

浏览器通过HTTPS访问安装实例时，请将`PUBLIRA_TENANT_URL_SCHEME`留空。它是Publira构建的链接所使用的协议，这些链接出现在邮件和`setup`摘要中。只有当浏览器确实通过HTTP打开安装实例时才将其设为`http`，例如[在一台机器上试用](#在一台机器上试用)的情况。

### 主机名

`PUBLIRA_EDGE_SITE_HOSTS`和`PUBLIRA_EDGE_ADMIN_HOSTS`是代理分别路由到租户网站和租户控制台的主机名：租户的域名，例如`comics.example.com`，以及其控制台主机，除非您将通过`--admin-domain`另行指定，否则为`admin.comics.example.com`。请写出不带端口的名称。每个变量可以接收多个以空格分隔的名称，每个租户一个，对于两者都不包含的主机，代理会用它自己的404应答。

```text
PUBLIRA_EDGE_SITE_HOSTS=comics.example.com
PUBLIRA_EDGE_ADMIN_HOSTS=admin.comics.example.com
```

`PUBLIRA_EDGE_PLATFORM_HOSTS`是平台控制台的主机名，除非您运行平台控制台，否则保持为空。`PUBLIRA_EDGE_IMAGE_HOSTS`保存您为其指定了图片主机的每个租户的图片主机，详见[图片主机](../3-operations/2-tenants.md#图片主机)，在您指定之前保持为空；代理在这些主机上只转发`/images`，不转发其他任何内容。设置了`PUBLIRA_EDGE_ACME_EMAIL`时，代理会为这四个变量中的所有名称获取证书。

### 密钥

`env generate`已经填入了以下各项，每一项都是不与其他任何安装实例共享的全新值：

| 变量 | 生成的内容 |
| --- | --- |
| `PUBLIRA_POSTGRES_PASSWORD` | 32个随机字节，十六进制表示 |
| `PUBLIRA_PUBLIC_DB_PASSWORD`、`PUBLIRA_ADMIN_DB_PASSWORD`、`PUBLIRA_PLATFORM_DB_PASSWORD`、`PUBLIRA_OUTBOX_DB_PASSWORD`、`PUBLIRA_TICKER_DB_PASSWORD`、`PUBLIRA_CONTENT_STATS_DB_PASSWORD` | 32个随机字节，十六进制表示，各一个 |
| `PUBLIRA_SECRET_ENCRYPTION_KEYS` | `k1:`加上32个随机字节，base64表示 |
| `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID` | `k1`，即上面那个密钥前面的ID |
| `PUBLIRA_AUTH_JWT_SECRET`、`PUBLIRA_WEB_STOREFRONT_AUTH_SECRET`、`PUBLIRA_WEB_ADMIN_AUTH_SECRET`、`PUBLIRA_WEB_PLATFORM_AUTH_SECRET`、`PUBLIRA_WEB_SERVICE_TOKEN` | 32个随机字节，base64表示，各一个 |
| `PUBLIRA_REVALIDATE_TOKEN` | 32个随机字节，十六进制表示 |
| `PUBLIRA_RUSTFS_ACCESS_KEY`、`PUBLIRA_RUSTFS_SECRET_KEY` | 32个随机字节，十六进制表示，各一个 |

请保持它们不变。数据库密码会不经转义地写入连接URL，因此采用十六进制；如果您改为手动设置某个值，也必须只使用URL安全的字符。第一个是PostgreSQL超级用户的密码，只有`publiractl setup`和`publiractl db`命令以该用户连接；另外六个是`setup`为各进程连接所用的角色设置的密码。两个RustFS值是对象存储自身的凭据：RustFS以它启动，`setup`则将它保存为Publira访问存储桶所用的凭据。其余各项保护什么，见[生成密钥](./2-installing.md#生成密钥)。

### 什么会让`docker compose`停止

`PUBLIRA_IMAGE_TAG`和两个主机列表是必需的，除`PUBLIRA_WEB_PLATFORM_AUTH_SECRET`之外的所有密钥也是必需的。只要其中任何一个为空，每条`docker compose`命令（包括`run`）都会在启动任何东西之前停止，并列出每个缺失的变量，读取该变量的每个服务各列一次：

```text
error while interpolating services.email-renderer.image: required variable PUBLIRA_IMAGE_TAG is missing a value
error while interpolating services.proxy.environment.PUBLIRA_EDGE_ADMIN_HOSTS: required variable PUBLIRA_EDGE_ADMIN_HOSTS is missing a value
```

`PUBLIRA_EDGE_ACME_EMAIL`为空时不会让`docker compose`停止：代理会改为提供纯HTTP。文件中的其余变量也可以留空：`PUBLIRA_TENANT_URL_SCHEME`、`COMPOSE_PROFILES`、`PUBLIRA_EDGE_PLATFORM_HOSTS`、`PUBLIRA_EDGE_IMAGE_HOSTS`、只有[前面有CDN或负载均衡器](#前面有cdn或负载均衡器)才需要填写的`PUBLIRA_EDGE_TRUSTED_PROXIES`，以及可选进程的变量——启用某个可选进程时，下一节会填写它们。

在运行`docker compose`的shell中导出的变量，优先于`.env`中的同名变量。如果您在`.env`中写入的某个值似乎被忽略了，请检查shell环境中是否有`PUBLIRA_*`变量。

## 选择可选进程

当`COMPOSE_PROFILES`以逗号分隔的列表列出可选进程时，它们就会运行。每个可选进程还需要在`.env`中设置其下列出的变量：

| 配置文件 | 增加的功能 | 还需在`.env`中设置的内容 |
| --- | --- | --- |
| `email-renderer` | 为每封邮件添加HTML部分 | `PUBLIRA_EMAIL_RENDERER_URL=http://email-renderer:8080` |
| `web-platform` | 平台控制台 | `PUBLIRA_WEB_PLATFORM_INTERNAL_URL=http://web-platform:4100`；将`PUBLIRA_PLATFORM_APP_URL`设为运营人员打开它的地址，例如`https://platform.example.com`；将`PUBLIRA_EDGE_PLATFORM_HOSTS`设为该地址中的主机名，例如`platform.example.com`。`env generate`已经填入了它的会话密钥`PUBLIRA_WEB_PLATFORM_AUTH_SECRET` |

例如，要同时运行两者：

```text
COMPOSE_PROFILES=web-platform,email-renderer
```

`PUBLIRA_WEB_PLATFORM_AUTH_SECRET`为空时`docker compose`不会停止，因为它只在该配置文件运行时才有意义，但没有它，任何运营人员都无法登录平台控制台，因此请保留`env generate`写入的值。它的主机名同样需要指向这台主机的DNS，并且设置了`PUBLIRA_EDGE_ACME_EMAIL`时，代理会与其他证书一同获取它的证书。

您可以现在选择，也可以以后再选。要在已经运行的安装实例中启用某个可选进程，请将其加入`COMPOSE_PROFILES`，设置它的变量，然后再次运行`docker compose up -d`：它会启动新的进程，并重启变量发生变化的进程。每个进程运行后做什么，见[启用可选进程](./2-installing.md#启用可选进程)。

## 启动安装实例

请在解压出的目录中按以下顺序运行每一步。

### 1. 设置安装实例

```bash
docker compose run --rm setup
```

第一条命令会拉取所需的镜像，启动PostgreSQL和RustFS，并等待两者都能应答。随后，`setup`会一步接一步地将安装实例从空数据库带到管理员可以登录的租户，并在每一步完成时输出该步骤：

1. 应用迁移并创建六个数据库角色，使用`.env`中的密码；Compose文件以文件的形式将这些密码传给它，因此它们从不出现在命令行上。
2. 在RustFS中创建名为`publira`的存储桶，并在其测试通过后，与`.env`中的RustFS凭据一起保存。
3. 在终端中询问其余所有内容：平台的默认语言区域、时区和货币，SMTP设置，是否设置Web Push，租户的名称和域名，以及租户的第一位管理员。[设置安装实例](./2-installing.md#4-设置安装实例)介绍了每一步。

当它询问租户网站域名时，请提供您在`PUBLIRA_EDGE_SITE_HOSTS`中列出的域名，例如`comics.example.com`。当它询问租户控制台域名时，如果您在`PUBLIRA_EDGE_ADMIN_HOSTS`中列出的是`admin.<domain>`，请留空；否则请提供您列出的名称。

最后的摘要会列出租户网站和租户控制台，如果管理员密码是`setup`生成的，还会输出该密码。它只会出现在这里，因此请在关闭终端之前保存好它。

如果运行中途停止，例如某项连接测试失败或您按下了Ctrl+C，请再次运行同一条命令：它会保留已完成的每一步，只询问剩下的部分。在已经完成的安装实例上运行时，它不会改变任何东西。

测试邮件被拒绝是个例外。`setup`在发送测试邮件之前就保存了SMTP设置，因此下一次运行会保留这些设置，并且不再发送测试邮件。请先用`docker compose run --rm publiractl smtp set`更正错误的设置，它会用所提供的参数替换所有已保存的设置，详见[更改账户](../3-operations/6-email.md#更改账户)；如果设置本身正确，只是SMTP服务器暂时无法访问，请保持设置不变。用`docker compose run --rm publiractl smtp test --to operator@example.com`发送测试邮件，发送成功后，再次运行`docker compose run --rm setup`，完成SMTP之后的步骤。

### 2. 启动安装实例

```bash
docker compose up -d
docker compose ps
```

`docker compose up -d`会先启动`server`，在`server`报告就绪且Valkey健康后启动各个Web应用，在`web-storefront`和`web-admin`也就绪后启动代理，并在所有内容都启动后返回。`docker compose ps`会将安装实例的每个服务列为正在运行，并将`server`、各个Web应用和`email-renderer`同时列为`healthy`；`publiractl`和`setup`不在其中，因为它们只会为单条命令运行。没有任何东西等待`web-platform`或`email-renderer`，因此在命令返回后的几秒内，两者都可能仍显示`health: starting`。如果某个进程不断重启，或者变为`unhealthy`，`docker compose logs <service>`会说明原因。

当`server`在启动时退出，或在启动一分半钟后仍未就绪时，`docker compose up -d`会以`dependency failed to start`错误停止，并指出`publira-deploy-server-1`不健康或已退出，同时不启动各个Web应用和代理。`docker compose logs server`会说明原因：`setup`尚未创建的角色，或密码与`.env`不匹配的角色，会被记录为`failed to initialize db`，并附上它尝试使用的登录。正在运行但未就绪的`server`会将失败的检查记录为一行`readiness check failed`，详见[健康检查](../3-operations/11-monitoring.md#健康检查)。修复原因后，请再次运行`docker compose up -d`。

设置了`PUBLIRA_EDGE_ACME_EMAIL`时，代理会在启动时申请证书，`docker compose logs proxy`会为每个主机名输出一次`certificate obtained successfully`。无法获取证书的名称会被记录为`could not get certificate from issuer`，并附上证书颁发机构给出的原因，最常见的是DNS尚未指向这台主机，或某个端口未向互联网开放。代理会自行不断重试，因此只需修复原因即可。

### 3. 登录

打开`setup`摘要中输出的租户控制台URL，即`https://admin.<domain>`或您为它指定的控制台主机，然后使用管理员的电子邮件地址和密码登录。租户控制台会打开`setup`创建的租户，租户的公开网站则在`https://<domain>`上应答。

如果您启用了平台控制台，请打开`PUBLIRA_PLATFORM_APP_URL`，并在设置界面上创建第一位运营人员。它的账户与租户管理员的账户是分开的。

## 在一台机器上试用

要在您自己的电脑上试用安装实例，而不使用DNS或证书，请使用`.localhost`下的主机名。基于Chromium的浏览器和Firefox会将所有`.localhost`名称发送到本机，并且即使通过纯HTTP也将其视为安全的，因此它们会保留登录时设置的会话Cookie。如果在任何其他主机名上使用纯HTTP，登录看起来会成功，但您打开的下一个页面会把您送回登录界面。

1. 在`.env`中设置`PUBLIRA_TENANT_URL_SCHEME=http`，并列出`.localhost`名称：`PUBLIRA_EDGE_SITE_HOSTS=comics.localhost`和`PUBLIRA_EDGE_ADMIN_HOSTS=admin.comics.localhost`，如果运行平台控制台，再加上`PUBLIRA_EDGE_PLATFORM_HOSTS=platform.localhost`。将`PUBLIRA_EDGE_ACME_EMAIL`留空：没有任何证书颁发机构能访问`.localhost`名称，因此代理提供纯HTTP。
2. 按照上面的第1步和第2步操作，并向`setup`提供租户域名`comics.localhost`。
3. 打开`http://admin.comics.localhost`进行登录。

租户网站在`http://comics.localhost`上应答；如果您通过`PUBLIRA_PLATFORM_APP_URL=http://platform.localhost`启用了平台控制台，它就在该地址上应答。

即使只提供纯HTTP，代理也会发布443端口，因此当您电脑上已经有程序监听其中任一端口时，`docker compose up`将无法启动代理。对于443端口，请将`PUBLIRA_EDGE_HTTPS_PORT`设为另一个空闲端口，例如`8443`；其他都不需要改变，因为试用时从不使用它。对于80端口，请将`PUBLIRA_EDGE_HTTP_PORT`设为另一个端口，例如`8080`，并把它加到上面的每个地址中：此时您提供给`setup`的租户域名是`comics.localhost:8080`，控制台在`http://admin.comics.localhost:8080`上打开。只要浏览器通过80或443以外的端口访问安装实例，端口就是域名的一部分，但不属于代理所列出的名称。

这种方式只用于试用安装实例：浏览器与主机之间传输的任何内容都没有加密，而且代理会在您电脑的所有网络接口上应答，而不只是对本机应答。

## 前面有CDN或负载均衡器

如果改由CDN或您的平台的负载均衡器为安装实例终止TLS，请将`PUBLIRA_EDGE_ACME_EMAIL`留空，并让它转发到代理的80端口，同时保留浏览器发送的`Host`请求头：代理根据它选择租户网站、租户控制台或平台控制台，Publira也根据它确定租户。如果这一跳改为通过HTTPS访问代理，则可以保留该设置，只要证书颁发机构仍能在每个主机名上通过80或443端口访问到代理即可。

此时，代理会用这一跳的地址记录每个请求，因此审计日志对所有人都显示同一个地址，Publira按客户端地址实施的限制也会由所有读者共享。要改为记录读者的地址，请让这一跳自行设置`X-Forwarded-For`、`X-Forwarded-Host`和`X-Forwarded-Proto`，并在`.env`中将`PUBLIRA_EDGE_TRUSTED_PROXIES`设为它发起连接所用的地址或CIDR范围（由其提供商公布），以空格分隔。然后运行`docker compose up -d proxy`，用这些设置重新创建代理。[代理前面的一跳](./4-edge/1-sample-configurations.md#代理前面的一跳)解释了信任这一跳意味着什么。

代理也会传递受信任的一跳所发送的`X-Forwarded-CountryRegion`，它将读者所在的地区传给租户的Google代码网关，详见[读者所在地区](./4-edge/index.md#读者所在地区)。请让能够查询读者地区的一跳设置它，并让不能查询的一跳移除该请求头，这样就没有读者能自行指定地区。

## 一台主机无法提供的东西

Compose文件是一个完整的安装实例，但它的每个部分都在同一台机器上：

- **没有冗余**。每个进程只运行一个。Docker会重启退出的进程，并在主机重启时重启整个安装实例，但主机停机期间，每个租户的网站也随之停止。
- **数据库和图片共用一块磁盘**。PostgreSQL和RustFS将数据保存在`publira-deploy_postgres-data`和`publira-deploy_rustfs-data`卷中，位于主机自己的磁盘上。磁盘故障会让两者一起丢失，因此请同时备份两者，并连同`.env`一起备份：没有其中的加密密钥，SMTP密码以及安装实例存储的其他所有凭据都将无法读取。Valkey不保存任何需要备份的内容，`publira-deploy_caddy-data`卷也一样：代理发现它为空时会重新获取证书。相关命令见[备份与恢复](./9-backup-and-restore.md#在docker-compose安装实例上)。
- **`docker compose down -v`会删除数据**。`-v`会移除卷，连同每一行数据和每一张图片。要停止安装实例并保留它们，请不要加这个参数。

当安装实例超出一台主机的承载能力时，同样的进程可以连接到其他地方的托管PostgreSQL和兼容S3的对象存储运行；[安装](./2-installing.md)会逐步启动这样的安装实例，[横向扩展](./7-scaling-out.md)则说明应该为哪些进程运行更多副本，以及它们必须共享什么。

## 后续步骤

添加租户时，请将其域名和控制台主机加入`.env`中的主机列表，然后运行`docker compose up -d proxy`：代理会路由这两个名称，并在设置了`PUBLIRA_EDGE_ACME_EMAIL`时获取它们的证书。[添加租户](./4-edge/index.md#添加租户)列出了操作顺序，首先是DNS。

此后每发布一个新版本，[升级](./8-upgrading.md#在docker-compose安装实例上)都会将安装实例带到该版本：下载版本、备份、迁移，以及使用新镜像重启。

Compose文件读取的完整变量列表，以及仓库对它运行的检查，见[部署参考](https://github.com/publira/publira/blob/main/infra/deploy/README.md#running-it-with-docker-compose)。
