---
title: 在ECS上运维
description: 为在Fargate上的Amazon ECS中运行的安装实例添加租户、让控制台的凭据远离租户的域名、分开提供图片和公开API，以及升级。
published: 2026-11-03
source_updated: 2026-10-26
---

本页介绍[Fargate上的Amazon ECS](./index.md)和[ECS前方的CloudFront](./1-cloudfront.md)让安装实例投入使用之后，对它所做的各项更改。其中的命令会用到那些页面定义的shell变量和函数。如果不在构建安装实例时所用的那个shell中运行，请重新定义命令中用到的变量和函数：[开始之前](./index.md#开始之前)中的变量，[应用迁移并创建数据库角色](./index.md#4-应用迁移并创建数据库角色)中的`run_publiractl`函数，[开通网络路径](./index.md#3-开通网络路径)中的`SERVER_SG`、`NAMESPACE`和`registry`函数，[创建负载均衡器](./index.md#5-创建负载均衡器)中的`target_group`函数，[启动服务](./index.md#6-启动服务)中的`service`函数，以及`LISTENER`（可用`aws elbv2 describe-listeners --load-balancer-arn <the load balancer ARN> --query 'Listeners[0].ListenerArn' --output text`打印）。

## 添加租户

使用`publiractl tenant create`或在平台控制台中创建的租户，需要在边缘上配置它的两个主机名，如[添加租户](../4-edge/index.md#添加租户)所述。在ECS上，需要在该租户的工作人员打开控制台之前完成以下操作：

1. **证书**。按照[创建负载均衡器](./index.md#5-创建负载均衡器)中的做法，在负载均衡器所在区域和`us-east-1`中各申请一个包含其域名和控制台主机名的证书，并对两者进行验证。
2. **负载均衡器**。用`aws elbv2 add-listener-certificates --listener-arn "$LISTENER" --certificates CertificateArn=<its ARN>`把第一个证书添加到监听器，并添加两条规则：其域名和控制台主机名各一条，都在`2000`段中，如该页的表格所示。除非提高配额，否则一个负载均衡器除监听器的默认证书外最多容纳25个证书，最多100条规则；一条规则的主机名条件最多取三个名称，所以每条规则最多可由三个租户共用。
3. **CloudFront**。根据[分配](./1-cloudfront.md#分配)中的`distribution.json`为它创建单独的分配，在`Aliases`中填入其两个名称，在`ViewerCertificate`中填入其`us-east-1`证书，并使用单独的`CallerReference`。VPC源站、函数和缓存策略与第一个分配所用的相同。
4. **DNS**。把两个名称都指向新建分配的域名。

其他都不需要更改：服务、参数和安全组对所有租户一视同仁。

## 让控制台的凭据远离租户的域名

负载均衡器已经让控制台的API无法从互联网访问，但它把租户域名转发到的`publira-server`仍然提供这些API，并为此持有它们的数据库登录和Web服务令牌。要把这三者都从读者能够访问的进程中移出（这是独立于边缘规则的另一层防护，如[只有公开API经过边缘](../4-edge/index.md#只有公开api经过边缘)所述），请运行第二个使用`--role storefront`的服务，并把租户的域名和`web-storefront`路由到它。拆分后，读者流量也可以独立于控制台进行扩缩，因为每个服务都运行自己的任务，如[按角色拆分服务器](../7-scaling-out.md#按角色拆分服务器)所述。

它的任务定义就是[启动服务](./index.md#6-启动服务)中的`publira-server.json`，只是把family和容器命名为`publira-storefront`，命令为`["server", "--role", "storefront"]`，并且只包含该角色读取的密钥：加密密钥、`PUBLIRA_AUTH_JWT_SECRET`、`PUBLIRA_REVALIDATE_TOKEN`、`PUBLIRA_REDIS_URL`和`PUBLIRA_PUBLIC_DB_URL`。注册它，并为它提供单独的目标组和一个Cloud Map名称，因为除了负载均衡器，`web-storefront`也会调用它：

```bash
aws ecs register-task-definition --cli-input-json file://publira-storefront.json > /dev/null
STOREFRONT_SERVER_TG=$(target_group publira-storefront 8000)
aws servicediscovery create-service --name publira-storefront --namespace-id "$NAMESPACE" \
  --dns-config 'RoutingPolicy=MULTIVALUE,DnsRecords=[{Type=A,TTL=10}]' \
  --health-check-custom-config FailureThreshold=1 > /dev/null
```

然后在服务器的规则之前添加规则，把租户的域名发送到它：

| 优先级 | 主机名 | 路径 | 转发到 |
| --- | --- | --- | --- |
| `900`至`999` | 租户的域名 | `/images*`、`/rpc/publira.v1.*` | `publira-storefront` |

在一条规则可取的五个值中，两个路径占去两个，只剩下三个主机名的位置，所以该段中的一条规则最多服务三个租户的域名：请把新租户的域名添加到已指定域名的某条规则中，或者在该段中下一个空闲的优先级上为它单独添加一条规则。

目标组是通过规则挂接到负载均衡器上的，而ECS拒绝创建其目标组没有挂接的服务，所以要先创建规则，再创建服务。不过，在服务的任务启动之前，新的目标组无法应答，所以创建每条规则时仍让它转发到`publira-server`，同时以权重`0`并列`publira-storefront`。然后使用已经放行Web应用的`publira-server`安全组创建服务，等其任务健康后，再让规则只转发到它：

```bash
RULE_900=$(aws elbv2 create-rule --listener-arn "$LISTENER" --priority 900 \
  --conditions "[$(host_is comics.example.com),$(path_is '["/images*","/rpc/publira.v1.*"]')]" \
  --actions "Type=forward,ForwardConfig={TargetGroups=[{TargetGroupArn=$SERVER_TG,Weight=1},{TargetGroupArn=$STOREFRONT_SERVER_TG,Weight=0}]}" \
  --query 'Rules[0].RuleArn' --output text)
service publira-storefront "$SERVER_SG" 8000 "$STOREFRONT_SERVER_TG"
aws ecs wait services-stable --cluster publira --services publira-storefront
aws elbv2 modify-rule --rule-arn "$RULE_900" \
  --actions "Type=forward,TargetGroupArn=$STOREFRONT_SERVER_TG" > /dev/null
```

`host_is`和`path_is`是[创建负载均衡器](./index.md#5-创建负载均衡器)中的函数，`SERVER_TG`是在那里创建的目标组；在其他shell中，可用`aws elbv2 describe-target-groups --names publira-server --query 'TargetGroups[0].TargetGroupArn' --output text`打印它。服务运行之后再添加到该段的规则，用该页的`rule`函数创建，只转发到`publira-storefront`。

让`web-storefront`也指向新服务，因为它只调用公开API：在`web-storefront.json`中把`PUBLIRA_GRPC_URL`设置为`http://publira-storefront.publira.internal:8000/rpc`，注册它，并把`web-storefront`服务更新到新的修订版。控制台主机名、`web-admin`和`web-platform`继续访问提供所有角色的`publira-server`，直到[让控制台的服务器不提供公开API](#让控制台的服务器不提供公开api)把公开API从它上面移除。

无论哪种情况，负载均衡器在每个主机名上都会对控制台API返回`404`，所以改为检查租户的域名是否到达了新服务：`aws elbv2 describe-target-health --target-group-arn "$STOREFRONT_SERVER_TG"`会把它的任务列为`healthy`，而[检查边缘](./1-cloudfront.md#检查边缘)中的公开API调用在租户域名上仍然返回`invalid_argument`，只是现在来自`publira-storefront`。

### 让控制台的服务器不提供公开API

`publira-server`仍然提供公开API并持有`publira_public`，因为`web-admin`会调用公开API获取租户的主题和标签，而优先级`1000`的规则会把控制台主机名的公开API转发到那里。把两者都发送到`publira-storefront`后，`publira-server`就可以以`--role admin,platform`运行，如[按角色拆分服务器](../7-scaling-out.md#按角色拆分服务器)的第4步所述。请按以下顺序进行更改，以确保`publira-server`停止提供公开API时，已经没有任何组件再向它发送公开API请求。

首先，让`web-admin`的公开API调用指向storefront服务。在`web-admin.json`的`environment`中添加该变量（与继续指向`publira-server`的`PUBLIRA_GRPC_URL`并列）：

```json
{
  "name": "PUBLIRA_PUBLIC_GRPC_URL",
  "value": "http://publira-storefront.publira.internal:8000/rpc"
}
```

然后部署它：

```bash
aws ecs register-task-definition --cli-input-json file://web-admin.json > /dev/null
aws ecs update-service --cluster publira --service web-admin --task-definition web-admin > /dev/null
```

此后它的`/readyz`也会以`public-api`的名义检查该服务。

然后把每个主机名的公开API都路由到`publira-storefront`（它在任何主机名上都会应答），而控制台主机名的`/images`保留在`publira-server`上，因为控制台页面显示的图片属于`admin`角色。在优先级`1000`的规则之后为公开API添加一条规则，然后从`1000`的规则中去掉公开API，使其不再到达`publira-server`：

| 优先级 | 主机名 | 路径                | 转发到               |
| ------ | ------ | ------------------- | -------------------- |
| `1000` | 任意   | `/images*`          | `publira-server`     |
| `1050` | 任意   | `/rpc/publira.v1.*` | `publira-storefront` |

```bash
rule 1050 "[$(path_is '["/rpc/publira.v1.*"]')]" "$STOREFRONT_SERVER_TG"
RULE_1000=$(aws elbv2 describe-rules --listener-arn "$LISTENER" \
  --query "Rules[?Priority=='1000'].RuleArn" --output text)
aws elbv2 modify-rule --rule-arn "$RULE_1000" \
  --conditions "[$(path_is '["/images*"]')]" > /dev/null
```

`rule`和`path_is`是[创建负载均衡器](./index.md#5-创建负载均衡器)中的函数，`STOREFRONT_SERVER_TG`是上面创建的目标组；在其他shell中，可用`aws elbv2 describe-target-groups --names publira-storefront --query 'TargetGroups[0].TargetGroupArn' --output text`打印它。`900`段中的规则继续把租户的域名（包括公开API）转发到`publira-storefront`。

最后，在`publira-server.json`中把容器的`command`设置为`["server", "--role", "admin,platform"]`，从其`secrets`中删除`PUBLIRA_PUBLIC_DB_URL`（该进程不再读取它），然后部署：

```bash
aws ecs register-task-definition --cli-input-json file://publira-server.json > /dev/null
aws ecs update-service --cluster publira --service publira-server --task-definition publira-server > /dev/null
```

登录租户控制台：它会像之前一样显示租户的主题并列出标签，只是现在从`publira-storefront`读取。把[检查边缘](./1-cloudfront.md#检查边缘)中的公开API调用发送到控制台主机名`https://admin.comics.example.com/rpc/publira.v1.TenantService/GetTenant`，仍然会返回`invalid_argument`；如果在那里得到`404`，说明控制台主机名的公开API仍在到达`publira-server`。

## 分开提供图片和公开API

租户的图片和公开API可以使用各自的主机名访问，各自经过单独的负载均衡器，如[分开提供图片和公开API](../7-scaling-out.md#分开提供图片和公开api)所述。在ECS上，图片使用第二个内部负载均衡器和一个CloudFront分配，位于图片专用的服务前方；公开API则在现有的负载均衡器上使用一个主机名，位于`publira-storefront`前方。本节建立在创建了`publira-storefront`的[让控制台的凭据远离租户的域名](#让控制台的凭据远离租户的域名)之上。下面的名称只是示例：`images.comics.example.com`是租户的图片主机，`api.example.com`是公开API的主机名。

### 图片

让图片在单独的服务上运行，使其流量可以独立于API进行扩缩。它的任务定义就是`publira-storefront.json`，只是把family和容器命名为`publira-images`，保存为`publira-images.json`：两者提供相同的角色，读取相同的密钥。注册它，并为它提供一个目标组和一个Cloud Map名称，`service`函数会把它注册到该名称下：

```bash
aws ecs register-task-definition --cli-input-json file://publira-images.json > /dev/null
IMAGES_TG=$(target_group publira-images 8000)
aws servicediscovery create-service --name publira-images --namespace-id "$NAMESPACE" \
  --dns-config 'RoutingPolicy=MULTIVALUE,DnsRecords=[{Type=A,TTL=10}]' \
  --health-check-custom-config FailureThreshold=1 > /dev/null
```

按照[创建负载均衡器](./index.md#5-创建负载均衡器)中的做法，在负载均衡器所在区域和`us-east-1`中申请包含图片主机的证书，并进行验证。然后使用第一个负载均衡器的安全组（CloudFront的VPC源站和`publira-server`安全组都已被它放行）创建第二个内部负载均衡器，再创建一个HTTPS监听器，其唯一的规则把`/images`转发到新服务，其他所有请求都返回`404`：

```bash
IMAGES_ALB=$(aws elbv2 create-load-balancer --name publira-images --type application --scheme internal \
  --subnets ${SUBNETS//,/ } --security-groups "$ALB_SG" \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text)
IMAGES_LISTENER=$(aws elbv2 create-listener --load-balancer-arn "$IMAGES_ALB" --protocol HTTPS --port 443 \
  --ssl-policy ELBSecurityPolicy-TLS13-1-2-2021-06 \
  --certificates CertificateArn=<the image hosts' certificate ARN in the load balancer's Region> \
  --default-actions 'Type=fixed-response,FixedResponseConfig={StatusCode=404,ContentType=text/plain}' \
  --query 'Listeners[0].ListenerArn' --output text)
aws elbv2 create-rule --listener-arn "$IMAGES_LISTENER" --priority 1000 \
  --conditions "[$(path_is '["/images*"]')]" \
  --actions "Type=forward,TargetGroupArn=$IMAGES_TG" > /dev/null
```

目标组是通过规则挂接到负载均衡器上的，而ECS拒绝其目标组没有挂接的服务，所以到这时才创建服务：

```bash
service publira-images "$SERVER_SG" 8000 "$IMAGES_TG"
```

按照[ECS前方的CloudFront](./1-cloudfront.md)在第一个负载均衡器前方部署CloudFront的方式，在它前方部署CloudFront：按照[VPC源站](./1-cloudfront.md#vpc源站)为`$IMAGES_ALB`创建一个VPC源站，再根据[分配](./1-cloudfront.md#分配)中的`distribution.json`创建一个分配，在`Aliases`中填入图片主机，在`ViewerCertificate`中填入它们的`us-east-1`证书，在`Origins`中填入新负载均衡器的DNS名称和新VPC源站的ID，并使用单独的`CallerReference`。函数和`publira-images`缓存策略与第一个分配所用的相同，其`/images*`行为也像在那里一样缓存图片。`publira-images.json`带有[客户端地址](./1-cloudfront.md#客户端地址)中的`PUBLIRA_TRUSTED_PROXIES`，该值同样覆盖这个分配和这个负载均衡器。

分配部署完成后，把每个图片主机指向它的域名，然后在平台控制台的**图片主机**中或通过`publiractl tenant update --image-domain`把图片主机交给租户，如[图片主机](../../3-operations/2-tenants.md#图片主机)所述。之后添加的租户，需要把其图片主机加入新监听器上的某个证书（用`aws elbv2 add-listener-certificates`添加），并加入新分配或它自己的分配的`Aliases`。

### 公开API

在现有的负载均衡器上为公开API提供单独的主机名。在两个区域中为`api.example.com`申请证书，把负载均衡器所在区域的那个添加到其监听器，并在`900`段中添加一条规则，把该主机名上的公开API转发到`publira-storefront`：

```bash
aws elbv2 add-listener-certificates --listener-arn "$LISTENER" \
  --certificates CertificateArn=<the API host's certificate ARN in the load balancer's Region>
rule 950 "[$(host_is api.example.com),$(path_is '["/rpc/publira.v1.*"]')]" "$STOREFRONT_SERVER_TG"
```

请使用该段中尚未被任何规则占用的优先级。该主机名上的其他所有路径都会得到监听器的`404`，`/images`除外：优先级`1000`的规则会在每个主机名上把它发送到`publira-server`，而由于该主机名不属于任何租户，那里同样会返回`404`。然后根据`distribution.json`为它创建一个分配，在`Aliases`中填入`api.example.com`，在`ViewerCertificate`中填入其`us-east-1`证书，并使用单独的`CallerReference`，再把`api.example.com`指向该分配的域名。

Web应用已经通过VPC调用`publira-storefront`，不经过任何一个负载均衡器：`web-storefront`通过`PUBLIRA_GRPC_URL`调用，`web-admin`在完成[让控制台的服务器不提供公开API](#让控制台的服务器不提供公开api)后通过`PUBLIRA_PUBLIC_GRPC_URL`调用；在VPC外运行的Web应用则改为指定`https://api.example.com/rpc`。租户拥有图片主机后，用`PUBLIRA_BASE_URL=https://api.example.com`构建该租户的移动应用，如[应用连接的地址](../../5-mobile-app/2-building.md#应用连接的地址)所述。租户域名的规则保持不变，所以针对租户域名构建的应用仍可继续使用。

### 检查拆分结果

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://images.comics.example.com/
curl -s -X POST -H 'Content-Type: application/json' -d '{}' \
  https://api.example.com/rpc/publira.v1.TenantService/GetTenant
curl -s -o /dev/null -w '%{http_code}\n' https://api.example.com/images/
```

第一条返回`404`：图片主机只提供图片。第二条到达`publira-storefront`，后者以`invalid_argument`拒绝这个空请求。第三条也返回`404`：API的主机名不提供图片。然后打开租户的网站：其图片从`https://images.comics.example.com/images/…`加载。

## 升级

[升级](../8-upgrading.md)把安装实例升级到新版本：先备份，再用新版本的`publiractl`执行迁移和创建角色，然后是各进程。请先阅读该页及发布说明。在ECS上，其步骤如下：

下面的每个步骤都作用于安装实例运行的每个服务。先把它们列出一次；如果运行了`web-platform`、`email-renderer`、`publira-storefront`和`publira-images`，也一并加入：

```bash
SERVICES="publira-server publira-worker web-storefront web-admin"
```

1. **停止服务**：如果您决定先停止服务（权衡见[决定是否先停止进程](../8-upgrading.md#决定是否先停止进程)），先记下每个服务运行的任务数，再把每个服务的任务数设为零：

   ```bash
   declare -A COUNT
   for name in $SERVICES; do
     COUNT[$name]=$(aws ecs describe-services --cluster publira --services "$name" \
       --query 'services[0].desiredCount' --output text)
     aws ecs update-service --cluster publira --service "$name" --desired-count 0 > /dev/null
   done
   aws ecs wait services-stable --cluster publira --services $SERVICES
   ```

2. **备份数据库**：对RDS实例或Aurora集群做快照，或者从能访问数据库的主机上使用`pg_dump`，如[备份数据库](../8-upgrading.md#1-备份数据库)所述。
3. **应用迁移并创建角色**：把`publiractl-db-migrate.json`和`publiractl-db-roles.json`中的`<tag>`改为新版本，注册两者，然后用`run_publiractl`按此顺序运行，每个成功后才继续。角色任务会为每个角色设置其参数中保存的密码，也就是该角色现有的密码，所以它可以原样运行。如果新版本添加了角色，则需要为该角色的密码添加一个参数、添加一个把它设置为变量的`secrets`条目，以及指定该变量的标志。
4. **启动新版本**：修改每个服务的任务定义中的`<tag>`，添加发布说明中列出的变量，注册它们，并把每个服务更新到新的修订版；如果在第1步中停止了服务，还要恢复到之前运行的任务数，即该步骤记录在`COUNT`中的值：

   ```bash
   for name in $SERVICES; do
     aws ecs register-task-definition --cli-input-json "file://$name.json" > /dev/null
     aws ecs update-service --cluster publira --service "$name" --task-definition "$name" \
       ${COUNT[$name]:+--desired-count ${COUNT[$name]}} > /dev/null
   done
   aws ecs wait services-stable --cluster publira --services $SERVICES
   ```

5. **检查安装实例**，如[检查安装实例](../8-upgrading.md#5-检查安装实例)所述。

如果改为在升级期间让服务保持运行，第4步按照[替换进程](../8-upgrading.md#4-替换进程)给出的顺序替换它们。如果运行了`email-renderer`，请先更新它，然后让`SERVICES`列出其他服务，再运行第4步的循环；ECS会每次替换几个任务，期间安装实例持续提供服务。
