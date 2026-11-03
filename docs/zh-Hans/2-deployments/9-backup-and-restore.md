---
title: 备份与恢复
description: 安装实例保存了什么、哪些必须备份、如何进行可以恢复的备份，以及如何在空的服务上恢复安装实例。
published: 2026-11-03
source_updated: 2026-11-02
---

安装实例把状态保存在三个地方：PostgreSQL数据库、对象存储的存储桶，以及只有您持有的密钥加密密钥。缺少其他两者时，单独恢复其中任何一个都是不完整的：数据行指向存储桶中没有的图片，存储桶中保存着没有任何数据行指向的图片，而数据库中的凭据是用没有人持有的密钥封装的。本页说明要备份什么以及原因、如何进行能恢复成可正常工作的安装实例的备份，以及如何在空的服务上用它恢复安装实例。

这些步骤是为您自己运行的安装实例（即[安装](./2-installing.md)所搭建的那种）编写的。通过仓库中的Compose文件安装的实例用它自己的命令执行相同的步骤，见[在Docker Compose安装实例上](#在docker-compose安装实例上)。

命令中的`publiractl`代表安装实例所运行版本的`publiractl`镜像，与[安装](./2-installing.md#开始之前)中相同，并向其传入每条命令读取的变量：`db`读取管理登录的连接`PUBLIRA_DB_URL`；`storage`读取`PUBLIRA_PLATFORM_DB_URL`，`search reindex`读取`PUBLIRA_CONTENT_STATS_DB_URL`，两者都还要读取`PUBLIRA_SECRET_ENCRYPTION_KEYS`和`PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID`。每当数据库结构发生变化，CI都会在[`scripts/backup-and-restore.sh`](https://github.com/publira/publira/blob/main/scripts/backup-and-restore.sh)中用这些命令进行一次备份并恢复它。

## 要备份什么

| 对象 | 保存的内容 | 是否备份 |
| --- | --- | --- |
| PostgreSQL数据库 | 安装实例存储的所有内容，以及它还要做的工作 | 是 |
| 对象存储的存储桶 | 每张上传的图片 | 是，在数据库之后 |
| 密钥加密密钥 | 封装所有已存储凭据的密钥 | 是，与数据库分开 |
| 其他密钥 | 角色密码、签名密钥以及进程之间共享的令牌 | 请保留；每一个都可以替换 |
| Valkey | 缓存和计数器 | 否 |
| 搜索引擎的索引 | 搜索在OpenSearch或Elasticsearch上运行时的目录副本 | 否；它会根据数据库重建 |

### 数据库

数据库保存每个租户、每个账户、目录、每条评论和每笔购买，以及平台和每个租户的所有设置。它还保存安装实例尚未完成的工作：仍待发送的邮件和推送通知，以及`publira worker`的作业队列，其表与Publira自己的表放在一起。数据库对存储桶具有权威性：只有当某一行数据指向一张图片时，这张图片对Publira来说才存在。

### 存储桶

存储桶保存工作人员上传的每张图片——封面、章节页面、徽标、作者肖像——每张图片都是`tenants/`下的一组对象，每种尺寸和格式各一个。数据库中的数据行通过键指向每个对象，除此之外Publira不在存储桶中保存任何东西。

### 密钥加密密钥

`PUBLIRA_SECRET_ENCRYPTION_KEYS`和`PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID`不保存在安装实例的任何地方。数据库保存的是用它们封装的所有凭据：

- 平台的SMTP密码、对象存储的私有密钥、搜索引擎的密码，以及Web Push私钥。
- 每个租户自己的SMTP密码，以及其支付服务商、App Store、Google Play、Firebase、Sign in with Apple和入站邮件的凭据。
- 开启了两步验证的每个租户控制台管理员的两步验证密钥。

在没有这些密钥的情况下恢复的数据库拥有每一行数据，但这些内容都无法读取。worker进程无法发送邮件，服务器无法访问存储桶，每个租户都必须重新输入其凭据，而且任何管理员的身份验证器应用都无法通过两步验证。

请保留列表中的每个密钥，包括您已经轮换掉但仍有值用它封装的密钥，并把它们与数据库备份分开保存。数据库的副本加上这些密钥，就是安装实例存储的全部凭据。

### 不需要备份的内容

- **Valkey**保存图片转换缓存、速率限制计数器和Web应用的缓存。其中的每个条目要么会根据数据库和存储桶重建，要么会自行过期，因此安装实例在空的Valkey上启动也不会丢失任何东西。
- **搜索引擎的索引**（搜索在OpenSearch或Elasticsearch上运行时）是根据数据库构建的，恢复后会[重建](#5-重建搜索索引)。
- **其他密钥**每一个都可以替换。角色密码可以用`publiractl db roles`重新设置，而新的访问令牌签名密钥或Web应用会话密钥会让所有人登出一次。缓存重新验证令牌和Web服务令牌只需要在共享它们的进程之间保持一致。不过，把它们全部与加密密钥一起保存在您的密钥存储中，仍然可以省去这些工作。
- **进程的镜像**可以为您运行的版本重新拉取，如果您自己构建镜像则重新构建。请在每次备份时记下是哪个版本：数据库备份要恢复到进行备份时那个版本的数据库结构上。

## 进行备份

停止`publira worker`，先备份数据库，再备份存储桶，然后重新启动worker进程。密钥不会在两次备份之间发生变化：请在生成或轮换密钥时把它们复制到一个单独的安全位置。

### 1. 停止worker进程

在数据库备份开始之前停止每个`publira worker`副本，并让它们保持停止，直到存储桶复制完成。worker进程对未使用图片和读者已过期的数据下载的清除，是唯一会从存储桶中删除对象的操作；停止它们之后，在复制到达之前，就没有任何东西会删除数据库备份所指向的对象。备份期间也不要运行`publiractl job purge-orphan-images`或`publiractl job purge-data-exports`。

安装实例的其余部分会继续提供服务。worker进程在此期间本应完成的工作——邮件、推送通知、缓存重新验证，以及发布到达预定时间的章节——会在数据库中等待，并在worker进程重新启动后立即完成。

### 2. 备份数据库

```bash
pg_dump --format=custom --file=publira.dump --dbname="$PUBLIRA_DB_URL"
publiractl db version > publira.version
```

`PUBLIRA_DB_URL`是[管理登录](./2-installing.md#准备服务)的连接，`pg_dump`的主版本必须与您的PostgreSQL服务器相同或更新。它在一个快照中读取所有表，因此即使进程继续提供服务，备份也是一致的，并包含它开始时已经提交的内容。

`db version`会打印数据库的结构版本，也就是备份要恢复到的版本。请把`publira.version`和该版本的标签与备份一起保存。

托管PostgreSQL的快照也能起到同样的作用。它要按照其服务商所述的方式恢复，并且会连同角色一起恢复。

### 3. 备份存储桶

使用任何能复制整个存储桶的S3客户端（例如`aws s3 sync`或`rclone copy`），把存储桶中的每个对象复制到其他地方的存储中。请使用永远不会从目标位置删除内容的复制方式（这两者都不会删除），并且每次都复制到同一个目标位置，这样您保留的每一份数据库备份（而不只是最新的那一份）都能在那里找到它的对象。使用AWS CLI时，从存储桶`publira-images`复制到目录`publira-bucket`：

```bash
aws s3 sync s3://publira-images publira-bucket
```

正是这个顺序让两份备份相互吻合。上传时会先写入对象，再写入指向它们的数据行，而且对象永远不会被重写，因此数据库备份中的数据行所指向的每个对象，在该备份开始时就已经在存储桶中了。由于worker进程已停止，这些对象在复制到达之前都不会被删除，所以存储桶备份包含了它们中的每一个。

这也是worker进程必须保持停止直到复制结束的原因。在数据库备份开始之后被替换的图片，其旧对象仍然被该备份所指向，但运行中的数据库里已经没有任何数据行指向它们。孤立对象清除会删除没有任何数据行指向的对象，因此在复制期间运行的清除可能会在复制到达之前删除它们，而恢复后的数据行就会指向存储桶及其备份中都没有的对象。

存储桶备份最终保存的内容会多于数据库备份所指向的：复制期间上传的每张图片，以及自首次使用该目标位置以来被替换的每张图片。这只会占用空间，没有其他代价。恢复之后，孤立对象清除会删除没有任何恢复后的数据行指向的对象。

如果顺序反过来复制，存储桶备份会缺少两次备份之间上传的每张图片，而数据库备份为它们恢复的数据行会指向不存在的对象。这些图片在网站和控制台上会显示为损坏。

### 4. 启动worker进程

启动您停止的每个副本。它会发送停止期间等待的内容，并发布在此期间已过预定时间的每个章节。

## 恢复到空的安装实例

请使用进行备份时那个版本的`publiractl`镜像，恢复到该版本上。要运行更新的版本，请先恢复，再[升级](./8-upgrading.md)。

按照[安装](./2-installing.md#准备服务)中的说明准备服务：一个主版本相同或更新的PostgreSQL服务器，其中有一个空数据库，以及一个空的存储桶和一个空的Valkey。不要运行`db migrate`：备份会带上数据库结构。

### 1. 恢复数据库

```bash
pg_restore --list publira.dump | grep -v ' POLICY public [^ ]* publira_rls_bypass ' > publira.list
pg_restore --no-owner --no-acl --single-transaction --use-list=publira.list --dbname="$PUBLIRA_DB_URL" publira.dump
```

`--single-transaction`会要么恢复全部内容，要么什么都不恢复。中途停止的恢复会让数据库保持为空，而不是缺少失败之后的那些表，这一点在worker进程启动后很重要：它会从存储桶中删除没有任何数据行指向的每个对象。

`--no-owner`和`--no-acl`会省略对六个角色的授权以及`publira_outbox`对作业队列表的所有权，而列表会省略名为`publira_rls_bypass`的策略，这些策略让跨租户工作的角色可以读取每个租户的数据行。角色属于PostgreSQL服务器而不是数据库，因此新服务器上还没有它们，任何提到角色的语句都会失败。省略这些内容后，每个对象都归管理登录所有，下一步会把授权和策略恢复回来。

### 2. 创建角色

```bash
publiractl db roles \
  --public-password-file /run/secrets/publira-public-db-password \
  --admin-password-file /run/secrets/publira-admin-db-password \
  --platform-password-file /run/secrets/publira-platform-db-password \
  --outbox-password-file /run/secrets/publira-outbox-db-password \
  --ticker-password-file /run/secrets/publira-ticker-db-password \
  --content-stats-password-file /run/secrets/publira-content-stats-db-password
```

这是[创建角色](./2-installing.md#2-创建角色)在安装时运行的命令，它从容器挂载在`/run/secrets`的文件中读取每个密码，在这里所做的事也相同：创建六个角色并授予它们该版本所定义的权限，把作业队列的表交给`publira_outbox`并让其他所有角色无法访问它们，然后设置每个密码。如果使用安装实例原来的密码，进程的连接URL可以继续使用；如果使用新密码，请更新这些URL。

### 3. 恢复存储桶

把存储桶备份中的每个对象以相同的键复制到新的存储桶中。使用AWS CLI时，从备份复制到的目录进行复制：

```bash
aws s3 sync publira-bucket s3://publira-images
```

如果存储桶的名称、地址和凭据都与安装实例原来的相同，就不需要更改其他任何内容。否则，请像`setup`保存旧存储桶那样保存新的存储桶，并对其进行测试：

```bash
publiractl storage set --bucket <bucket> --region <region> --access-key-id <access key>
```

对于Amazon S3以外的存储，请加上`--endpoint`和`--force-path-style`；`storage set`的每个标志见[`publiractl`参考](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#storage)。

### 4. 启动进程

使用安装实例原来的加密密钥启动`publira server`、`publira worker`、`web-storefront`和`web-admin`，如果您运行`web-platform`和`email-renderer`，也一并启动。其他密钥可以是您保留的那些，也可以是按[生成密钥](./2-installing.md#生成密钥)所述设置的新密钥。

请在空的Valkey上启动它们。在恢复之前为安装实例提供服务的Valkey中保存着根据被恢复操作回退的数据所缓存的页面和图片，Web应用会继续提供它们，直到每个条目过期。如果它不为其他任何东西提供服务，请用`FLUSHALL`清空它。

### 5. 重建搜索索引

当搜索在OpenSearch或Elasticsearch上运行时，请根据恢复后的数据库重建索引：

```bash
publiractl search reindex
```

在恢复后仍然存在的索引仍会找到备份之后发布的内容，并链接到恢复后的数据库中已经没有的系列；而丢失的索引会让搜索结果为空。在默认搜索（即数据库本身）上，没有需要重建的内容。

### worker进程会补做的工作

`publira worker`会把恢复后的数据库视为自备份以来它一直没有处理的数据库，并在启动后立即补做：

- **邮件和通知**。备份时正在等待发送的所有内容都会被发送，包括推送通知和缓存重新验证。其中一部分在备份之后、安装实例丢失之前已经发出，因此有些读者和工作人员会再次收到同一封邮件。
- **定时工作**。自备份以来已过预定时间的每个章节都会被发布，缓存的页面会跟上每个已开启或已结束的免费阅读期，到期的置顶公告会被取消置顶。
- **每日重建**。阅读统计、排行榜和推荐会根据备份中保存的阅读活动，为自备份以来的每一天重建。
- **孤立对象清除**。第一次清除会删除没有任何恢复后的数据行指向、且已存在一天的对象：即备份之后上传的图片。

### 恢复无法找回的内容

备份之后写入的所有内容：读者创建的账户、评论、上传、设置和购买。支付服务商、App Store或Google Play已经为在此期间进行的购买扣款，而安装实例不再记录它，因此购买者无法再打开该章节。请在每个服务商的记录中查找从备份时间到安装实例丢失时间之间的这些购买。

## 验证恢复

- `db version`报告的版本与您随备份一起保存在`publira.version`中的版本相同，并且没有脏状态：

  ```bash
  publiractl db version
  ```

- 每个进程对`GET /readyz`都返回就绪。`publira server`和`publira worker`会为每个数据库登录各报告一项检查，因此密码与其连接URL不匹配的角色会在那里显示出来。
- `storage test`通过。它使用数据库中封装保存的私有密钥访问存储桶，因此也能证明加密密钥是正确的：

  ```bash
  publiractl storage test
  ```

- 可以登录租户控制台，并且租户的网站可以连同其图片一起打开：一个系列的封面，以及备份前不久上传的某个章节的页面。

从未恢复过的备份只是一种期望，而不是备份。请不时把备份恢复到备用服务上，并在其上逐项检查这份清单。

## 在Docker Compose安装实例上

[Docker Compose](./3-docker-compose.md)安装实例把数据库保存在`publira-deploy_postgres-data`卷中，把存储桶保存在`publira-deploy_rustfs-data`中，把加密密钥和其他所有密钥保存在`.env`中。请在安装实例运行所在的目录中运行每条命令：即其版本归档文件解压到的目录，或检出中的`infra/deploy/`。

### 进行备份

```bash
docker compose stop server
docker compose exec -T postgres pg_dump -U postgres --format=custom publira > publira.dump
docker compose run --rm -T publiractl db version > publira.version
docker compose stop rustfs
docker compose run --rm --no-deps -T --entrypoint tar rustfs -czf - -C /data . > publira-bucket.tar.gz
docker compose start rustfs server
```

停止worker进程的原因见[停止worker进程](#1-停止worker进程)。它在`server`中运行，因此API也会随之停止，在`server`重新启动之前，租户网站和控制台都不会响应。`-T`可以防止输出经过终端，否则输出会损坏。

存储桶以RustFS保存在其卷中的文件的形式备份，而不是逐个对象备份，因为RustFS镜像不带S3客户端。复制这些文件时必须停止RustFS，否则归档中可能包含它写入到一半的对象。Compose文件固定了RustFS镜像的版本，因此同一版本的Compose文件会用相同的RustFS恢复该归档。

请把`publira.dump`、`publira.version`和`publira-bucket.tar.gz`复制到主机之外，并把您在安装时制作的`.env`副本保存在与主机和这些文件都不同的地方。

### 恢复

在一台放有备份所对应版本的Compose文件的主机上（按[下载Compose文件](./3-docker-compose.md#下载compose文件)所述从该版本的归档文件中解压），把`.env`放回`compose.yaml`旁边，然后运行：

```bash
docker compose up -d --wait postgres
docker compose exec -T postgres sh -c 'cat > /tmp/publira.dump' < publira.dump
docker compose exec -T postgres sh -c "pg_restore --list /tmp/publira.dump | grep -v ' POLICY public [^ ]* publira_rls_bypass ' > /tmp/publira.list"
docker compose exec -T postgres pg_restore -U postgres -d publira --no-owner --no-acl --single-transaction --use-list=/tmp/publira.list /tmp/publira.dump
docker compose exec -T postgres rm /tmp/publira.dump /tmp/publira.list
docker compose run --rm publiractl db roles \
  --public-password-file /run/secrets/public-db-password \
  --admin-password-file /run/secrets/admin-db-password \
  --platform-password-file /run/secrets/platform-db-password \
  --outbox-password-file /run/secrets/outbox-db-password \
  --ticker-password-file /run/secrets/ticker-db-password \
  --content-stats-password-file /run/secrets/content-stats-db-password
docker compose run --rm --no-deps -T --entrypoint tar rustfs -xzf - -C /data < publira-bucket.tar.gz
docker compose up -d
```

PostgreSQL在首次启动时会创建空的`publira`数据库，由恢复操作把它填满。归档会被复制到容器中，以便`pg_restore`像[恢复数据库](#1-恢复数据库)中那样省略`publira_rls_bypass`策略，再由`db roles`把它们恢复回来。存储桶归档会在RustFS首次启动之前连同存储桶及其中的每个对象放入RustFS卷中。Valkey不保存任何东西，因此它以空的状态启动。

这些命令假定主机上还不存在安装实例的这两个卷。要在仍位于主机上的安装实例之上进行恢复，请先用`docker compose down -v`移除它及其卷。这会删除它保存的每一行数据和每张图片，所以只有在备份就在手边时才能运行。

然后按[验证恢复](#验证恢复)验证恢复结果，以`docker compose run --rm publiractl db version`和`docker compose run --rm publiractl storage test`运行`publiractl`，并把版本与`publira.version`进行比较。

## 后续步骤

`db roles`、`storage`和`search reindex`的作用以及它们接受的每个标志见[`publiractl`参考](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md)。恢复到较旧的版本后如何继续升级，见[升级](./8-upgrading.md)。
