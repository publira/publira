---
title: 升级
description: 把运行中的安装实例升级到新版本，从升级前的备份到新版本的进程开始提供服务。
published: 2026-11-03
source_updated: 2026-10-24
---

一个版本可能会改变其进程所期望的数据库结构，因此升级安装实例不只是用新镜像重启它。数据库要先行：由新版本的`publiractl`镜像把数据库结构和数据库角色向前推进，之后新版本的进程才在其上启动。本页按这个顺序逐步说明，并介绍如何检查每一步，以及迁移失败时该怎么做。

这些步骤是为您自己运行的安装实例（即[安装](./2-installing.md)所搭建的那种）编写的。通过仓库中的Compose文件安装的实例用它自己的命令执行相同的步骤，见[在Docker Compose安装实例上](#在docker-compose安装实例上)。

## 开始之前

### 阅读发布说明

每个版本都是仓库的一个标签，并连同其发布说明一起发布在仓库的[Releases](https://github.com/publira/publira/releases)页面上。请阅读从当前运行的版本之后到要升级到的版本（含）为止的每个版本的说明。就数据库结构而言，跳过版本没有问题，因为`db migrate`会在一次运行中应用中间每个版本的迁移，但说明中要求您做的事情，不会有任何东西替您完成。

一个版本的说明以**Upgrade notes**开头，它在引入每项变更的拉取请求下列出该版本中所有需要您采取行动的变更，没有时也会注明。它列出的是以下这些变更：

- **新增、重命名或不再读取的环境变量**。请在新版本的进程启动之前设置它。
- **新的数据库角色**。`db roles`需要为尚不存在的角色提供密码：像安装时那样生成一个，并通过该角色的标志传入。
- **对边缘职责的变更**，例如某个路径改为路由到另一个进程。请在您的边缘上做同样的变更，新版本对边缘的要求见[边缘](./4-edge/index.md#边缘必须做什么)。如果您的边缘是根据某个[示例配置](./4-edge/1-sample-configurations.md)改编的，`git diff <current tag> <new tag> -- infra/proxy/`会显示示例中的变更，供您移植到自己的副本中。
- **安装实例之前没有运行、现在必须运行的进程或服务**。
- **运行时间很长或会锁定繁忙表的迁移**，以便您选择何时运行它。

只有主版本才会列出这些变更，在`1.0.0`之前则是次版本。`1.0.0`之前的补丁版本仍然要执行本页的每一步：它可能带有迁移，而它的进程在`db migrate`尚未推进的数据库结构上会失败，所以要在替换其进程之前运行`db migrate`和`db roles`。[版本发布](./10-releases.md)说明了每种版本可以改变什么，以及哪些版本会收到修复。

### 获取新版本的镜像

在做任何更改之前，把新版本的每个镜像`ghcr.io/publira/<name>:<new version>`拉取到运行它们的主机上。这样从应用迁移到重启进程之间的时间就只是进程启动所需的时间。如果您的安装实例运行的是自己构建的镜像，请从新版本的标签构建新版本的镜像，把您的更改移植上去，并推送到主机拉取镜像的位置。

`publiractl`也要来自新版本：它带有该版本的迁移和角色定义，而一个版本的进程需要的是该版本的数据库结构，绝不是更早的版本。

本页的示例使用已发布的镜像名称，例如`ghcr.io/publira/publiractl:<new version>`，其中的版本是去掉`v`的版本Git标签：`v0.2.0`对应`0.2.0`。自行构建镜像的安装实例请改用自己的镜像名称。

### 决定是否先停止进程

一个版本的进程可以与紧随其后的版本的进程并存运行，因此升级到下一个版本时，在两个版本同时运行的两个时间段内，安装实例都可以继续提供服务：

- **在`db migrate`和重启之间**，当前运行版本的进程在新版本的数据库结构和角色上提供服务。一个版本会保留上一个版本读取的每个表、列和授权，把删除它们的工作留给之后的版本，因此这些进程所做的任何事都不会失败。
- **在替换进程期间**，两个版本的Web应用和`publira server`会相互调用，无论以何种顺序替换、是否一次一个副本地替换，也无论回滚其中哪一个。两个版本的worker进程共享发件箱：当前运行版本的worker进程会把只有新版本才会写入的那类条目留给新版本的worker进程发送。当前运行的版本已经能做的一切都会继续工作；新版本新增的功能在双方都运行新版本后才会生效。

这一保证只覆盖紧接在当前运行版本之后的那个版本。跳过版本时，您运行的进程可能会读取某个中间版本已经废弃的列或调用已经废弃的API，所以请先停止它们，或者一次升级一个版本。

保持运行的进程在您进行备份之后也会继续写入。如果之后迁移失败而您回到该备份，那么自备份以来写入的所有内容都会被丢弃：期间进行的每一次注册、购买、评论和编辑，包括支付服务商已经扣款的购买。

在备份之前停止进程可以避免这种情况：因为备份之后没有任何写入，所以备份包含了每一次写入。这样从备份开始到新版本的进程启动为止，安装实例都处于停止状态。只要无法接受丢失这些写入，就请先停止进程；对于销售章节的安装实例来说，每次都是如此。

## 升级

### 1. 备份数据库

如果您决定停止进程，请现在在备份之前停止它们。

`publiractl`只会向前推进数据库结构，迁移一旦应用就无法撤销。您现在进行的备份就是回到当前运行版本的途径。

```bash
pg_dump --format=custom --file=publira-before-upgrade.dump --dbname="$PUBLIRA_DB_URL"
```

`PUBLIRA_DB_URL`是`db migrate`所使用的[管理登录](./2-installing.md#准备服务)的连接，`pg_dump`的主版本必须与您的PostgreSQL服务器相同或更新。托管PostgreSQL的快照也能起到同样的作用。迁移不会改变对象存储、Valkey或您的密钥中的任何内容，因此在迁移之前需要备份的就是数据库。请保留这份备份，直到新版本已经运行一段时间。

### 2. 应用迁移

```bash
docker run --rm -e PUBLIRA_DB_URL ghcr.io/publira/publiractl:<new version> db migrate
```

它会记录开始时的版本，完成后记录结束时的版本：

```text
time=2026-11-20T09:41:02.118Z level=INFO msg=migrating from_version=20261006125036
time=2026-11-20T09:41:03.402Z level=INFO msg=migrated from_version=20261006125036 to_version=20261120093000
```

当版本不带任何迁移时，两个版本相同，命令照样以零退出。

迁移要在新进程启动之前运行，因为进程在启动时不会检查数据库结构。如果在旧的数据库结构上启动，它们会以健康状态启动，然后在每个访问该版本新增的表或列的请求上失败。

### 3. 更新角色

```bash
docker run --rm -e PUBLIRA_DB_URL ghcr.io/publira/publiractl:<new version> db roles
```

不带标志时，每个角色都保留其密码，命令只会把角色更新为新版本所定义的样子：对迁移刚刚创建的表的授权，以及该版本在角色可访问范围上所做的其他更改。它会为每个角色打印一行，例如`publira_public: kept its password`。如果跳过这一步，新进程会在该版本新增的每个表上因权限错误而失败。

如果该版本新增了角色，请像[创建角色](./2-installing.md#2-创建角色)中那样，通过该角色的`--<name>-password-file`标志传入其密码。没有传入时，命令会写明它需要的标志后退出，不创建任何内容。

### 4. 替换进程

用新版本的镜像替换每个进程，并设置发布说明要求设置的变量，顺序如下：

1. **`email-renderer`**（如果您运行它），以便任一版本的worker进程都能找到它所渲染的模板。
2. **`publira worker`、`publira server`、`web-storefront`和`web-admin`**，如果您运行`web-platform`则连同它一起，顺序不限，也可以一次一个副本地替换：在编排工具滚动更新它们期间，安装实例会继续提供服务。只有新版本才会发送的那类邮件或通知会在发件箱中等待，直到新worker进程的某个副本接手。当前运行版本的副本每次会把这样的条目搁置一分钟，因此在这些副本中的最后一个停止之后，该条目会在一分钟内可供新的worker进程接手，然后像其他条目一样发送。worker进程在启动时会应用它自己的作业队列的迁移，因此它的表不需要单独的步骤。

运行`publira server --with-worker`的安装实例也以同样的方式替换其副本，也可以一次一个。如果您在第1步中停止了进程，请把它们全部启动。

### 5. 检查安装实例

- 每个进程对`GET /readyz`都返回就绪。
- `db version`报告该版本最新的迁移，并且没有脏状态：

  ```bash
  docker run --rm -e PUBLIRA_DB_URL ghcr.io/publira/publiractl:<new version> db version
  ```

  ```text
  version 20261120093000
  dirty false
  ```

  这个版本是新标签下`db/migrations/`中最新文件开头的时间戳。

- 可以登录租户控制台，并且租户的网站可以打开。

## 迁移失败时

`db migrate`以非零状态退出，记录`failed to migrate`以及PostgreSQL返回的错误，并且`db version`报告脏状态：

```text
version 20261120093000
dirty true
```

此时数据库中的状态如下：

- 失败的迁移之前的每个迁移都已应用，并保持已应用状态。
- 如果是PostgreSQL拒绝了失败的迁移，该迁移会被回滚。一个迁移文件作为一个事务运行，因此它的语句都不会保留。例外是使用`CREATE INDEX CONCURRENTLY`构建索引的迁移，它在事务之外运行：失败时会留下一个同名的无效索引。
- 如果是连接中断，失败的迁移可能在应答丢失之前已经提交，而`db migrate`无法判断是哪种情况。
- 记录的版本是失败的迁移的版本，并被标记为脏，在清除该标记之前`db migrate`拒绝再次运行。

您原来运行的进程会继续在到目前为止已应用的迁移上运行，就像在任何一次`db migrate`和重启之间那样。不要在这样的数据库上启动新版本的进程。

### 排除原因后再次运行

日志可以区分这两种情况。当PostgreSQL拒绝了迁移时，`failed to migrate`这一行的末尾是它返回的错误及其SQLSTATE，例如`(details: ERROR: canceling statement due to statement timeout (SQLSTATE 57014))`。连接中断时则写的是网络错误，没有SQLSTATE。

当PostgreSQL因迁移之外的原因拒绝了迁移（磁盘已满、语句在等待繁忙的表时超时）时，请排除原因，把记录改回失败的迁移之前的那个迁移，然后再次运行`db migrate`：

1. 找到失败的迁移之前那个迁移的版本。在新版本检出的根目录下，下面的命令会把它打印在第一行：

   ```bash
   ls db/migrations | grep '\.up\.sql$' | grep -B1 '^20261120093000_'
   ```

   同样的列表也可以在GitHub上新标签的`db/migrations/`下找到。

2. 如果失败的迁移以`CONCURRENTLY`方式创建索引，请以管理登录删除它留下的无效索引：

   ```sql
   DROP INDEX CONCURRENTLY IF EXISTS <index name>;
   ```

3. 以管理登录把记录改回：

   ```sql
   UPDATE schema_migrations SET version = <previous version>, dirty = false;
   ```

4. 再次运行`db migrate`。它会从失败的那个迁移开始；成功后，从[第3步](#3-更新角色)继续。

如果是连接中断，请先阅读新标签下失败的迁移的`.up.sql`文件，在数据库中查找它所做的更改。由于一个迁移作为一个事务运行，这些更改要么全部存在，要么全都不存在：

- **全都不存在**：迁移已被回滚。按照上面的步骤操作。
- **全部存在**：迁移已经提交。请把记录设为失败的迁移本身，而不是它之前的那个，使用`UPDATE schema_migrations SET version = <failed version>, dirty = false;`，然后再次运行`db migrate`，继续执行它之后的迁移。
- **无法判断**，例如迁移只修改行而没有留下可以查找的东西：请按下文回到您原来运行的版本。再次运行这样的迁移可能会把同样的行修改两次。

### 回到原来运行的版本

当问题出在迁移本身，或者您找不到原因、无法判断迁移是否已应用时，请恢复备份并继续运行原来的版本。恢复会丢弃备份之后写入的所有内容，因此如果升级期间进程一直在运行，它们此后的写入都会丢失。请在[issue](https://github.com/publira/publira/issues)中报告这次失败，附上`db migrate`的日志和`db version`的输出。

1. 停止进程：进程持有到数据库的连接时，无法删除该数据库。
2. 删除数据库，然后以最初创建它时的所有者和设置重新创建一个空数据库。
3. 把备份恢复到其中：

   ```bash
   pg_restore --dbname="$PUBLIRA_DB_URL" publira-before-upgrade.dump
   ```

   角色属于PostgreSQL服务器而不是数据库，因此删除数据库后它们依然存在，而备份带有它们的授权。

4. 启动原来运行的版本的进程。

托管PostgreSQL的快照请按照其服务商所述的方式恢复，以代替上面的步骤。

## 在Docker Compose安装实例上

[Docker Compose](./3-docker-compose.md)安装实例用`docker compose`执行上面的每一步。新版本的Compose文件放在单独的目录中，与您当前运行安装实例的目录并列；第1步创建它之后，请在那里运行每条命令。项目名称是固定的，因此无论从哪个目录运行，`docker compose`访问的都是相同的容器和卷。

### 1. 下载新版本

在包含当前运行安装实例所用目录的那个目录中运行以下命令，其中`<current version>`和`<new version>`是两个版本的版本号，即去掉`v`的标签：

```bash
curl -fsSLO https://github.com/publira/publira/releases/download/v<new version>/publira-deploy-<new version>.tar.gz
tar -xzf publira-deploy-<new version>.tar.gz
diff publira-deploy-<current version>/.env.example publira-deploy-<new version>/.env.example
cp -p publira-deploy-<current version>/.env publira-deploy-<new version>/.env
cd publira-deploy-<new version>
```

diff会显示新版本在Compose文件中新增或不再读取的每个变量：请把新增的变量添加到`.env`中。留空的必填变量会使每条`docker compose`命令停止，并写明该变量。然后把`.env`中的`PUBLIRA_IMAGE_TAG`设为新版本号，diff中也会显示它。`cp -p`使`.env`仍然只有您能读取，而留在旧目录中的副本仍然指向您当前运行的版本，这是迁移失败时的回退途径。

当发布说明写明该版本从Compose文件中移除了某个服务时，请在旧目录中用`docker compose stop <service>`停止该服务，因为旧目录仍然包含它。新的Compose文件中没有它，所以在[第5步](#5-启动新版本)移除它之前，它会以您原来运行的版本继续针对新版本的数据库结构运行。

从仓库检出运行的安装实例则改为获取新标签并在`infra/deploy/`中检出它，并在检出之前用`git diff <current tag> <new tag> -- .env.example`代替`diff`。它的`.env`不受版本控制，因此保持原位，而版本移除的服务要在检出之前停止。要把这样的安装实例改为使用归档文件，请执行上面的步骤，并用它的`infra/deploy/`代替`publira-deploy-<current version>`。

### 2. 获取镜像

```bash
docker compose pull
docker compose pull publiractl
```

第一条命令拉取安装实例所运行的每个进程的镜像，版本为您刚刚设置的版本；第二条命令拉取`publiractl`，第一条命令不包括它，因为它从不保持运行。不会构建任何内容。

如果您的安装实例运行的是自己构建的镜像，请改为从新版本标签的检出构建新版本的镜像，把您的更改移植上去，并推送到`PUBLIRA_IMAGE_REGISTRY`所指的位置；在主机本身上用`task docker:verify:full`构建的镜像无需推送。

### 3. 备份数据库

如果您决定[停止进程](#决定是否先停止进程)，请先停止它们；如果您运行`web-platform`和`email-renderer`，也要一并写上：

```bash
docker compose stop server web-storefront web-admin
```

然后进行备份：

```bash
docker compose exec -T postgres pg_dump -U postgres --format=custom publira > publira-before-upgrade.dump
```

`-T`可以防止转储经过终端，否则转储会损坏。

### 4. 应用迁移并更新角色

```bash
docker compose run --rm publiractl db migrate
docker compose run --rm publiractl db roles
```

如果该版本新增了角色，请像安装时那样以`--<name>-password-file /run/secrets/<name>-db-password`传入其密码，并在`.env`中设置`.env.example`的diff所显示的变量。

### 5. 启动新版本

```bash
docker compose up -d --remove-orphans
docker compose ps
```

`up -d`会重新创建镜像或设置发生变化的每个容器，其中包括代理，因为它现在挂载的是新目录中的`Caddyfile`；`--remove-orphans`会移除新版本的Compose文件中已经没有的服务的容器。代理获取的证书保留在`caddy-data`卷中。

从仓库检出运行的安装实例还要在`up -d`之后运行`docker compose restart proxy`：代理以单个文件的方式挂载`Caddyfile`，而`git checkout`会在同一路径上用一个新文件替换该文件，所以保持运行的代理会继续读取您原来运行的版本的路由。

然后按[第5步](#5-检查安装实例)检查安装实例，并以`docker compose run --rm publiractl db version`运行`db version`。检查通过后，就不再需要旧目录了。它的`.env`包含安装实例的所有密钥，所以请删除该目录或其中的`.env`，而不要在主机上留下第二份副本。

### 在Compose上迁移失败时

以超级用户身份通过`postgres`容器中的`psql`运行[排除原因后再次运行](#排除原因后再次运行)中的SQL，一次一条语句：

```bash
docker compose exec postgres psql -U postgres -d publira -c "UPDATE schema_migrations SET version = <previous version>, dirty = false"
```

如果要改为回到原来运行的版本：

```bash
docker compose stop server web-storefront web-admin
docker compose exec postgres psql -U postgres -d postgres -c 'DROP DATABASE publira' -c 'CREATE DATABASE publira'
docker compose exec -T postgres pg_restore -U postgres -d publira < publira-before-upgrade.dump
cd ../publira-deploy-<current version>
docker compose up -d --remove-orphans
```

旧目录的`.env`仍然指向您原来运行的版本，因此`up -d`会再次启动它，代理也使用旧的`Caddyfile`。从仓库检出运行的安装实例则用`git checkout <current tag>`代替`cd`，把`PUBLIRA_IMAGE_TAG`改回原来运行的版本，并在`up -d`之后运行`docker compose restart proxy`。

## 后续步骤

每条`db`命令的作用以及`db roles`的每个标志见[`publiractl`参考](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#db)；如果发布说明提到了某个变量，各进程读取的变量见[部署参考](https://github.com/publira/publira/blob/main/infra/deploy/README.md#environment-variables)。
