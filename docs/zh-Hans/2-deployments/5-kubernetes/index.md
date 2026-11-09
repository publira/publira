---
title: Kubernetes
description: 在Kubernetes集群上运行安装实例，从Secret、Deployment以及位于其前方的Gateway或Ingress，一直到首次登录租户控制台。
published: 2026-11-03
updated: 2026-11-09
source_updated: 2026-11-09
---

本页将安装实例从Kubernetes集群上的一个空命名空间，一直带到首次登录租户控制台。它执行的步骤与[安装](../2-installing.md)相同，那一页解释了每个步骤存在的原因、每个密钥保护什么，以及每个数据库角色能访问什么；本页还按照[边缘](../4-edge/index.md#边缘必须做什么)的要求在前方部署边缘。本页只讲集群特有的部分：每个部分对应哪些资源，以及如何用这些资源满足上述两页的每项要求。

下面的清单是需要按自己环境调整的示例，而不是维护中的一套配置：仓库不提供Helm chart、Kustomize base或Operator。清单中使用已发布的镜像`ghcr.io/publira/<name>:<tag>`；请按照[开始之前](../2-installing.md#开始之前)的说明，把`<tag>`替换为您要安装的版本号。

## 集群中运行的内容

每个长期运行的进程都是一个Deployment，凡是会被其他组件调用的进程，都通过同名的Service访问：

| Deployment | 镜像和参数 | 端口 | Service | 副本数 |
| --- | --- | --- | --- | --- |
| `publira-server` | `ghcr.io/publira/publira:<tag>` | `8000` | 需要：边缘和Web应用会调用它 | 任意数量 |
| `publira-worker` | `ghcr.io/publira/publira:<tag>`，参数为`worker` | `8003`，仅用于探针 | 不需要：没有任何组件调用它 | 任意数量 |
| `web-storefront` | `ghcr.io/publira/web-storefront:<tag>` | `3000` | 需要：边缘，以及服务器和worker进程发起的缓存重新验证 | 任意数量 |
| `web-admin` | `ghcr.io/publira/web-admin:<tag>` | `4000` | 需要，与`web-storefront`相同 | 任意数量 |
| `web-platform`（如果运行） | `ghcr.io/publira/web-platform:<tag>` | `4100` | 需要，与`web-storefront`相同 | 任意数量 |
| `email-renderer`（如果运行） | `ghcr.io/publira/email-renderer:<tag>` | `8080` | 需要：worker进程会调用它 | 任意数量 |

worker进程可以运行多个副本，因为每个定时任务在一次运行进行期间都是唯一的，所以两个副本绝不会同时运行同一个任务。所有周期性任务也都由它自己调度，因此安装实例不需要CronJob。服务器或worker进程的每个副本都会为每个数据库登录各开一个连接池，所以副本越多，数据库就需要接受越多的连接，具体计算见[Connection pools](https://github.com/publira/publira/blob/main/server/README.md#connection-pools)。

请将`publira server`和`publira worker`作为上面的两个Deployment运行，而不是合并为一个`publira server --with-worker`。该标志是为单台主机上的安装实例准备的：在集群中，它会放弃分别扩缩两者的能力，并像[概览](../1-overview.md#安装实例运行什么)所说的那样，把worker进程的数据库登录放进边缘转发请求的那个进程里，却换不来集群需要的任何好处。

`publiractl`不需要常驻运行。它以Job的形式运行，或者以您附加（attach）到的Pod的形式运行，使用您所安装版本的镜像。

## 开始之前

您需要：

- **一个集群**，其节点为`linux/amd64`或`linux/arm64`（镜像发布所针对的两个平台），并且`kubectl`已登录到该集群。在`publira`命名空间中，各步骤会创建、修改和删除Secret、Deployment、Service、Job和Pod，读取Pod日志，附加到Pod，并管理边缘的资源：Gateway、HTTPRoute和一个Envoy Gateway HTTPRouteFilter，或者Ingress和两个Traefik Middleware。创建命名空间和不属于任何命名空间的`ClusterIssuer`，以及安装cert-manager和边缘的控制器，需要集群管理员来完成。在该命名空间中绑定内置的`admin`角色即可覆盖其余操作，自定义资源除外：只有当某个自定义资源在安装时把自己加入该角色，它才会被覆盖，而Envoy Gateway的安装不会为Gateway、HTTPRoute和它自己的HTTPRouteFilter这样做。
- **一个Gateway API实现或Ingress控制器**作为边缘，以及用于签发证书的**cert-manager**，如[Kubernetes上的边缘](./1-edge.md)所述。边缘的Service必须能从互联网访问，通常是`LoadBalancer`类型的Service。
- **安装实例依赖的服务**，按照[准备服务](../2-installing.md#准备服务)所列准备好，无论它们是集群外的托管服务还是在集群内运行：一个PostgreSQL数据库及拥有它并可创建角色的管理登录、一个Valkey实例、一个空的存储桶及其凭据，以及一个SMTP服务器。安装实例的每个Pod都必须能访问它们。
- **DNS**：租户的域名及其控制台主机名（`admin.<domain>`，或您将通过`--admin-domain`指定的主机名）都要在边缘的Service获得地址后指向该地址。

下面的每条命令都在`publira`命名空间中运行：

```bash
kubectl create namespace publira
kubectl config set-context --current --namespace=publira
```

## 1. 创建Secret

[生成密钥](../2-installing.md#生成密钥)列出了安装实例需要的每个密钥及其保护的内容。用同样的方法一次性生成它们：

```bash
ENCRYPTION_KEYS="k1:$(openssl rand -base64 32)"
AUTH_JWT_SECRET="$(openssl rand -base64 32)"
STOREFRONT_AUTH_SECRET="$(openssl rand -base64 32)"
ADMIN_AUTH_SECRET="$(openssl rand -base64 32)"
REVALIDATE_TOKEN="$(openssl rand -hex 32)"
WEB_SERVICE_TOKEN="$(openssl rand -base64 32)"
PUBLIC_DB_PASSWORD="$(openssl rand -hex 32)"
ADMIN_DB_PASSWORD="$(openssl rand -hex 32)"
PLATFORM_DB_PASSWORD="$(openssl rand -hex 32)"
OUTBOX_DB_PASSWORD="$(openssl rand -hex 32)"
TICKER_DB_PASSWORD="$(openssl rand -hex 32)"
CONTENT_STATS_DB_PASSWORD="$(openssl rand -hex 32)"
```

然后只把每个进程读取的内容放进它自己的Secret中交给它。连接URL中带有角色密码，所以它们也是密钥；Redis URL一旦带有密码，同样如此。请把下面的数据库主机和Valkey URL替换为您自己的：

```bash
DB="db.internal:5432/publira?sslmode=require"
REDIS_URL="rediss://:<valkey password>@valkey.internal:6379"

kubectl create secret generic publira-encryption \
  --from-literal=PUBLIRA_SECRET_ENCRYPTION_KEYS="$ENCRYPTION_KEYS" \
  --from-literal=PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID=k1

kubectl create secret generic publira-server \
  --from-literal=PUBLIRA_AUTH_JWT_SECRET="$AUTH_JWT_SECRET" \
  --from-literal=PUBLIRA_WEB_SERVICE_TOKEN="$WEB_SERVICE_TOKEN" \
  --from-literal=PUBLIRA_REVALIDATE_TOKEN="$REVALIDATE_TOKEN" \
  --from-literal=PUBLIRA_REDIS_URL="$REDIS_URL" \
  --from-literal=PUBLIRA_PUBLIC_DB_URL="postgres://publira_public:$PUBLIC_DB_PASSWORD@$DB" \
  --from-literal=PUBLIRA_ADMIN_DB_URL="postgres://publira_admin:$ADMIN_DB_PASSWORD@$DB" \
  --from-literal=PUBLIRA_PLATFORM_DB_URL="postgres://publira_platform:$PLATFORM_DB_PASSWORD@$DB"

kubectl create secret generic publira-worker \
  --from-literal=PUBLIRA_REVALIDATE_TOKEN="$REVALIDATE_TOKEN" \
  --from-literal=PUBLIRA_REDIS_URL="$REDIS_URL" \
  --from-literal=PUBLIRA_WORKER_DB_URL="postgres://publira_outbox:$OUTBOX_DB_PASSWORD@$DB" \
  --from-literal=PUBLIRA_TICKER_DB_URL="postgres://publira_ticker:$TICKER_DB_PASSWORD@$DB" \
  --from-literal=PUBLIRA_CONTENT_STATS_DB_URL="postgres://publira_content_stats:$CONTENT_STATS_DB_PASSWORD@$DB"

kubectl create secret generic web-storefront \
  --from-literal=PUBLIRA_AUTH_SECRET="$STOREFRONT_AUTH_SECRET" \
  --from-literal=PUBLIRA_REVALIDATE_TOKEN="$REVALIDATE_TOKEN" \
  --from-literal=PNCH_REDIS_URL="$REDIS_URL" \
  --from-literal=PUBLIRA_REDIS_URL="$REDIS_URL"

kubectl create secret generic web-admin \
  --from-literal=PUBLIRA_AUTH_SECRET="$ADMIN_AUTH_SECRET" \
  --from-literal=PUBLIRA_REVALIDATE_TOKEN="$REVALIDATE_TOKEN" \
  --from-literal=PNCH_REDIS_URL="$REDIS_URL" \
  --from-literal=PUBLIRA_WEB_SERVICE_TOKEN="$WEB_SERVICE_TOKEN"

kubectl create secret generic publiractl \
  --from-literal=PUBLIRA_DB_URL="postgres://postgres:<administrative login password>@$DB"

kubectl create secret generic publira-db-roles \
  --from-literal=public="$PUBLIC_DB_PASSWORD" \
  --from-literal=admin="$ADMIN_DB_PASSWORD" \
  --from-literal=platform="$PLATFORM_DB_PASSWORD" \
  --from-literal=outbox="$OUTBOX_DB_PASSWORD" \
  --from-literal=ticker="$TICKER_DB_PASSWORD" \
  --from-literal=content-stats="$CONTENT_STATS_DB_PASSWORD"
```

| Secret | 读取方 | 方式 |
| --- | --- | --- |
| `publira-encryption` | `publira-server`、`publira-worker`，以及每次运行的`publiractl` | 作为环境变量 |
| `publira-server` | `publira-server`和`publiractl setup` | 作为环境变量。`setup`只通过`secretKeyRef`从中读取`PUBLIRA_PLATFORM_DB_URL` |
| `publira-worker` | `publira-worker` | 作为环境变量 |
| `web-storefront`、`web-admin` | 同名的Web应用 | 作为环境变量 |
| `publiractl` | `db`的Job | 作为环境变量。它只保存`PUBLIRA_DB_URL`，即[管理登录](../2-installing.md#准备服务)的连接：只有`db`命令会读取它，所以不会交给其他任何`publiractl`命令，也不会交给任何常驻进程 |
| `publira-db-roles` | `db roles`的Job | 作为文件，每个角色一个文件，`db roles`通过其`--<role>-password-file`标志读取 |

集群中的Secret并不是备份。请同时把加密密钥保存在您自己的密钥存储中：一旦丢失，安装实例保存的所有凭据都必须重新输入，如[生成密钥](../2-installing.md#生成密钥)所述。如果您把密钥保存在集群会从中同步的存储里，例如使用一个从该存储写出Secret的Operator，请让它以相同的键写出相同的Secret。

## 2. 应用迁移

`db migrate`以Job的形式运行，使用该版本的`publiractl`镜像，并通过管理登录的连接执行：

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: publira-db-migrate
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 86400
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: publiractl
          image: ghcr.io/publira/publiractl:<tag>
          args: ["db", "migrate"]
          envFrom:
            - secretRef:
                name: publiractl
```

```bash
kubectl apply -f publira-db-migrate.yaml
kubectl wait --for=condition=Complete --timeout=10m job/publira-db-migrate
kubectl logs job/publira-db-migrate
```

`backoffLimit: 0`让Kubernetes不会自行重新运行失败的迁移：失败的运行会把数据库标记为dirty，需要按照[迁移失败时](../8-upgrading.md#迁移失败时)的说明手动解决。无论Job是失败了还是仍在运行，`kubectl wait`都会在十分钟后放弃等待，所以无论哪种情况都要读取它的日志。

Job一旦创建就不能修改；已经结束的Job，无论是完成还是失败，再次应用其清单时都不会重新运行。这个Job会在结束一天后被删除。在此之前要再次运行它（就像该恢复过程的最后一步那样），需要先删除它：

```bash
kubectl delete job publira-db-migrate --ignore-not-found
kubectl apply -f publira-db-migrate.yaml
```

下面的`db roles`和`setup`的Job也以同样的方式再次运行。

## 3. 创建角色

`db roles`在迁移之后以同样的方式运行。它从以文件形式挂载的`publira-db-roles` Secret中读取角色密码：

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: publira-db-roles
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 86400
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: publiractl
          image: ghcr.io/publira/publiractl:<tag>
          args:
            - db
            - roles
            - --public-password-file=/run/secrets/publira/public
            - --admin-password-file=/run/secrets/publira/admin
            - --platform-password-file=/run/secrets/publira/platform
            - --outbox-password-file=/run/secrets/publira/outbox
            - --ticker-password-file=/run/secrets/publira/ticker
            - --content-stats-password-file=/run/secrets/publira/content-stats
          envFrom:
            - secretRef:
                name: publiractl
          volumeMounts:
            - name: db-roles
              mountPath: /run/secrets/publira
              readOnly: true
      volumes:
        - name: db-roles
          secret:
            secretName: publira-db-roles
```

```bash
kubectl apply -f publira-db-roles.yaml
kubectl wait --for=condition=Complete --timeout=5m job/publira-db-roles
kubectl logs job/publira-db-roles
```

日志中每个角色占一行。以后轮换角色密码也使用同一个Job：在`publira-db-roles`以及带有该密码的连接URL中修改它，再次运行该Job，然后重启以该角色连接的Deployment。与迁移一样，再次应用前要先删除已结束的Job。以URL由`publira-server`持有的`publira_admin`为例：

```bash
kubectl delete job publira-db-roles --ignore-not-found
kubectl apply -f publira-db-roles.yaml
kubectl wait --for=condition=Complete --timeout=5m job/publira-db-roles
kubectl rollout restart deployment/publira-server
```

## 4. 启动进程

每个进程以环境变量的形式获得自己的Secret，[部署参考](https://github.com/publira/publira/blob/main/infra/deploy/README.md#environment-variables)列出的其余变量则写在它的Deployment中。它的存活探针是`/livez`，就绪探针是`/readyz`，超时时间按照[从编排系统探测](../../3-operations/11-monitoring.md#从编排系统探测)给出的值设置：服务器和worker进程的检查是依次执行的，所以要长于六秒；Web应用则要长于两秒。

`publira server`和`publira worker`在收到停止指示后30秒内停止，所以它们的Deployment在Kubernetes强制终止之前给它们45秒，而默认值是30秒；`publira-server`还会先在`preStop`钩子中等待五秒，让边缘在它停止接受请求之前停止向它发送请求。[停止副本](../7-scaling-out.md#停止副本)说明了两者都需要的原因。该钩子使用`sleep`动作，它不需要镜像中有shell，Kubernetes从1.30版起支持。

`publira-server.yaml`：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: publira-server
spec:
  replicas: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: publira-server
  template:
    metadata:
      labels:
        app.kubernetes.io/name: publira-server
    spec:
      terminationGracePeriodSeconds: 45
      containers:
        - name: publira-server
          image: ghcr.io/publira/publira:<tag>
          lifecycle:
            preStop:
              sleep:
                seconds: 5
          ports:
            - name: http
              containerPort: 8000
          envFrom:
            - secretRef:
                name: publira-encryption
            - secretRef:
                name: publira-server
          env:
            - name: PUBLIRA_WEB_STOREFRONT_INTERNAL_URL
              value: http://web-storefront:3000
            - name: PUBLIRA_WEB_ADMIN_INTERNAL_URL
              value: http://web-admin:4000
            - name: PUBLIRA_TRUSTED_PROXIES
              value: 10.244.0.0/16
          livenessProbe:
            httpGet:
              path: /livez
              port: http
          readinessProbe:
            httpGet:
              path: /readyz
              port: http
            timeoutSeconds: 8
---
apiVersion: v1
kind: Service
metadata:
  name: publira-server
spec:
  selector:
    app.kubernetes.io/name: publira-server
  ports:
    - name: http
      port: 8000
      targetPort: http
```

`PUBLIRA_TRUSTED_PROXIES`是集群为Pod分配地址的范围，云服务商会把它显示为集群的Pod地址范围；设置它的原因见[客户端地址](./1-edge.md#客户端地址)。

`publira-worker.yaml`，它不需要Service：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: publira-worker
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: publira-worker
  template:
    metadata:
      labels:
        app.kubernetes.io/name: publira-worker
    spec:
      terminationGracePeriodSeconds: 45
      containers:
        - name: publira-worker
          image: ghcr.io/publira/publira:<tag>
          args: ["worker"]
          ports:
            - name: health
              containerPort: 8003
          envFrom:
            - secretRef:
                name: publira-encryption
            - secretRef:
                name: publira-worker
          env:
            - name: PUBLIRA_WEB_STOREFRONT_INTERNAL_URL
              value: http://web-storefront:3000
            - name: PUBLIRA_WEB_ADMIN_INTERNAL_URL
              value: http://web-admin:4000
          livenessProbe:
            httpGet:
              path: /livez
              port: health
          readinessProbe:
            httpGet:
              path: /readyz
              port: health
            timeoutSeconds: 8
```

两个Web应用的结构相同，都通过`publira server`的Service调用它。`web-storefront.yaml`：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-storefront
spec:
  replicas: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: web-storefront
  template:
    metadata:
      labels:
        app.kubernetes.io/name: web-storefront
    spec:
      containers:
        - name: web-storefront
          image: ghcr.io/publira/web-storefront:<tag>
          ports:
            - name: http
              containerPort: 3000
          envFrom:
            - secretRef:
                name: web-storefront
          env:
            - name: PUBLIRA_GRPC_URL
              value: http://publira-server:8000/rpc
            - name: PUBLIRA_TRUSTED_PROXIES
              value: 10.244.0.0/16
          livenessProbe:
            httpGet:
              path: /livez
              port: http
          readinessProbe:
            httpGet:
              path: /readyz
              port: http
            timeoutSeconds: 3
---
apiVersion: v1
kind: Service
metadata:
  name: web-storefront
spec:
  selector:
    app.kubernetes.io/name: web-storefront
  ports:
    - name: http
      port: 3000
      targetPort: http
```

`web-storefront`使用与`publira server`相同的`PUBLIRA_TRUSTED_PROXIES`，以找出它传给租户的Google tag gateway的读者地址。`web-admin.yaml`与之相同，只是把所有出现`web-storefront`的地方（包括Secret的名称）都换成`web-admin`，端口用`4000`代替`3000`，并且没有`PUBLIRA_TRUSTED_PROXIES`，因为`web-admin`不读取它。

应用全部清单，并等待每个Deployment就绪：

```bash
kubectl apply -f publira-server.yaml -f publira-worker.yaml -f web-storefront.yaml -f web-admin.yaml
kubectl rollout status deployment/publira-server deployment/publira-worker deployment/web-storefront deployment/web-admin
```

`publira-worker`在启动时会创建其任务队列的表，所以不需要单独的Job。没有就绪的Deployment会在其Pod的`/readyz`中，以及在Pod日志的`readiness check failed`行中给出原因：如果某个角色的密码与其连接URL不一致，那里会以`db.public`或其他登录的名称指出它。

## 5. 设置安装实例

`publiractl setup`只运行一次，可以在附加的终端中运行，由它逐项询问每个值；也可以作为Job运行，用标志给出每个值。两种方式都通过`publira-server` Secret中的`PUBLIRA_PLATFORM_DB_URL`以`publira_platform`身份连接，并用加密密钥封存所保存的内容，所以两者都读取进程所读取的`publira-encryption` Secret。两者都不会得到`publiractl` Secret：`setup`从不以管理登录连接。

无论哪种方式，它打印的内容都会进入容器日志，而集群的日志收集可能会保留这些日志，所以请为管理员指定密码，而不是让它生成：生成的密码会打印在摘要中。在提示符下输入的密码不会回显，以文件形式给出的密码也不会被打印。

在终端中运行时，在一个您附加到的Pod中运行它，该Pod会在退出时被删除：

```bash
kubectl run publiractl-setup --rm -it --restart=Never \
  --image=ghcr.io/publira/publiractl:<tag> \
  --overrides='{
    "apiVersion": "v1",
    "spec": {
      "containers": [{
        "name": "publiractl-setup",
        "image": "ghcr.io/publira/publiractl:<tag>",
        "args": ["setup"],
        "stdin": true,
        "tty": true,
        "envFrom": [{"secretRef": {"name": "publira-encryption"}}],
        "env": [{
          "name": "PUBLIRA_PLATFORM_DB_URL",
          "valueFrom": {"secretKeyRef": {"name": "publira-server", "key": "PUBLIRA_PLATFORM_DB_URL"}}
        }]
      }]
    }
  }'
```

无人值守运行时，用标志给出每个值，而它要保存的密钥（包括管理员的密码）则以文件形式从单独的Secret中给出：

```bash
kubectl create secret generic publiractl-setup \
  --from-literal=secret-access-key='<the object store secret key>' \
  --from-literal=smtp-password='<the SMTP password>' \
  --from-literal=admin-password="$(openssl rand -base64 18)"
```

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: publiractl-setup
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 86400
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: publiractl
          image: ghcr.io/publira/publiractl:<tag>
          args:
            - setup
            - --non-interactive
            - --default-locale=en
            - --bucket=publira-images
            - --region=us-east-1
            - --access-key-id=<the object store access key>
            - --secret-access-key-file=/run/secrets/setup/secret-access-key
            - --host=smtp.example.com
            - --port=587
            - --encryption=starttls
            - --username=mailer
            - --smtp-password-file=/run/secrets/setup/smtp-password
            - --from-address=no-reply@example.com
            - --tenant-name=Example Comics
            - --domain=comics.example.com
            - --admin-email=owner@comics.example.com
            - --admin-name=Owner
            - --admin-password-file=/run/secrets/setup/admin-password
          envFrom:
            - secretRef:
                name: publira-encryption
          env:
            - name: PUBLIRA_PLATFORM_DB_URL
              valueFrom:
                secretKeyRef:
                  name: publira-server
                  key: PUBLIRA_PLATFORM_DB_URL
          volumeMounts:
            - name: setup
              mountPath: /run/secrets/setup
              readOnly: true
      volumes:
        - name: setup
          secret:
            secretName: publiractl-setup
```

```bash
kubectl apply -f publiractl-setup.yaml
kubectl wait --for=condition=Complete --timeout=5m job/publiractl-setup
kubectl logs job/publiractl-setup
```

如果使用Amazon S3以外的存储，请用`--endpoint`添加其URL；如果它按路径寻址存储桶，再加上`--force-path-style`。[`publiractl`参考](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#setup)列出了每个标志以及可选的步骤。

如果运行中途停止（例如对象存储拒绝了连接测试），已保存的内容会保留，排除原因后再次运行即可完成。与迁移一样，删除失败的Job后再次应用它。

管理员的密码就是`publiractl-setup` Secret中的`admin-password`键。管理员登录并修改密码后，请删除该Secret：之后不再有任何组件读取它。

## 6. 在前方部署边缘

边缘把每个主机名和路径路由到正确的Service，终止TLS，并移除调用方不得自行指定的请求头。[Kubernetes上的边缘](./1-edge.md)以Gateway或Ingress的形式在前方部署边缘，由cert-manager签发其证书，并从集群外部进行检查。这些检查通过后，回到这里登录。

## 7. 登录

打开租户控制台`https://admin.comics.example.com`（或您通过`--admin-domain`指定的控制台主机名），用管理员的电子邮件地址和密码登录。此后的安装实例与[登录](../2-installing.md#6-登录)所述的相同。

## 本节内容

- [Kubernetes上的边缘](./1-edge.md)：证书、位于Service前方的Gateway或Ingress、客户端地址，以及从集群外部检查边缘。
- [在Kubernetes上运维](./2-operating.md)：添加租户、让控制台的凭据远离租户的域名、指标，以及升级。

## 后续步骤

[边缘](../4-edge/index.md)完整说明了Gateway或Ingress必须做的事情，[监控](../../3-operations/11-monitoring.md)说明了安装实例开始提供服务后要关注什么。每个进程读取的变量见[部署参考](https://github.com/publira/publira/blob/main/infra/deploy/README.md)；可选进程按照[启用可选进程](../2-installing.md#启用可选进程)的说明开启，每个都像上面那样作为一个Deployment和一个Service运行。
