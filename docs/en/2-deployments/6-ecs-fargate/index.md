---
title: Amazon ECS on Fargate
description: Run an install as Amazon ECS services on AWS Fargate behind CloudFront and an Application Load Balancer, from its parameters and task definitions to the first sign-in to the tenant console.
published: 2026-10-15
updated: 2026-10-22
---

This page takes an install from a VPC with the managed services provisioned to the first sign-in to the tenant console, with every process an Amazon ECS service on AWS Fargate and CloudFront in front of an Application Load Balancer as the edge. It runs the same steps as [Installing](../2-installing.md), which explains why each step exists, what every secret protects, and what each database role can reach, and it puts the edge in front the way [Edge](../4-edge/index.md#what-the-edge-has-to-do) requires. This page covers what is particular to ECS and Fargate: which resources each part becomes, and how each requirement of those two pages is met with them.

The commands and JSON below are illustrations to adapt, not a maintained set: the repository ships no CloudFormation template, CDK app, or Terraform module. They are written for the AWS CLI version 2 and name the published images, `ghcr.io/publira/<name>:<tag>`; write the version of the release you install in place of `<tag>`, as [Before you start](../2-installing.md#before-you-start) describes, and your account ID and Region in place of `<account>` and `<region>`.

## What runs on ECS

Every long-lived process is an ECS service of its own, on the Fargate launch type, and every one that something calls is registered in AWS Cloud Map under the same name:

| ECS service | Image and command | Port | Reached by | Tasks |
| --- | --- | --- | --- | --- |
| `publira-server` | `ghcr.io/publira/publira:<tag>` | `8000` | The load balancer, and the web apps through Cloud Map | Any number |
| `publira-worker` | `ghcr.io/publira/publira:<tag>`, with `worker` as its command | `8003`, for its health check alone | Nothing | Any number |
| `web-storefront` | `ghcr.io/publira/web-storefront:<tag>` | `3000` | The load balancer, and the cache revalidation from the server and the worker through Cloud Map | Any number |
| `web-admin` | `ghcr.io/publira/web-admin:<tag>` | `4000` | As `web-storefront` | Any number |
| `web-platform`, when you run it | `ghcr.io/publira/web-platform:<tag>` | `4100` | As `web-storefront` | Any number |
| `email-renderer`, when you run it | `ghcr.io/publira/email-renderer:<tag>` | `8080` | The worker, through Cloud Map | Any number |

The worker may run several tasks because every scheduled job is unique while a run of it is in flight, so two tasks never run the same job at once. It also schedules every recurring job itself, so the install needs no EventBridge schedule or scheduled task. Each task of the server or the worker opens a pool per database login, so more tasks need a database that accepts more connections, as [Connection pools](https://github.com/publira/publira/blob/main/server/README.md#connection-pools) works out.

Run `publira server` and `publira worker` as the two services above rather than as one `publira server --with-worker`. That flag is for an install on one host: on ECS it gives up scaling the two apart and puts the worker's database logins in the process the load balancer forwards to, as the [Overview](../1-overview.md#what-an-install-runs) describes, and buys nothing ECS needs.

The processes call one another by the names Cloud Map service discovery gives them, such as `publira-server.publira.internal`, which resolve to the address of each running task. A call therefore reaches the task directly, from the caller's own address. ECS Service Connect would instead pass each call through a proxy in the receiving task, which hands it on from `127.0.0.1`, and `publira server` would record every request a web app makes for a reader with that address.

`publiractl` is not kept running. It runs as a task you start with `aws ecs run-task`, from the image of the release you install, and stops when the command finishes.

## Before you start

You need:

- **The AWS CLI version 2**, signed in to the account with permission to manage ECS, Cloud Map, Elastic Load Balancing, CloudFront, ACM, IAM roles, Systems Manager parameters, EC2 security groups, and CloudWatch Logs.
- **A VPC** with private subnets in at least two Availability Zones for the tasks and the load balancer, with at least one free address in each for the network interface CloudFront creates there, and an internet gateway attached, which CloudFront requires of a VPC whose load balancer it reaches as a VPC origin, even though nothing is routed through it. The tasks have to reach the GitHub Container Registry to pull the images, the Systems Manager and CloudWatch Logs APIs, Amazon S3, and your SMTP server: give the private subnets a NAT gateway, or VPC endpoints for the AWS services and a pull-through cache for the images.
- **The services the install depends on**, provisioned as [Provision the services](../2-installing.md#provision-the-services) lists:
  - **Amazon RDS for PostgreSQL or Aurora PostgreSQL**, with the database created as its initial database. The master user is the administrative login: it is not a superuser, but it owns that database and may create roles, which is all `publiractl db` needs.
  - **Amazon ElastiCache for Valkey or Redis OSS**, as a node-based cluster with cluster mode disabled, encryption in transit turned on, and an AUTH token. Publira connects to its primary endpoint as to a single server, so ElastiCache Serverless, which accepts only clients that speak cluster mode, does not work.
  - **An Amazon S3 bucket**, empty. The processes reach it with the task role below, so no access key is created or stored.
  - **Amazon SES**, or another SMTP server, with SMTP credentials and a verified address to send from.
- **DNS** for the tenant's domain and for its console host, `admin.<domain>` or the one you will give it with `--admin-domain`, which you point at CloudFront once its distribution exists, and the ability to add the CNAME records ACM asks for to validate a certificate.

The commands below use these shell variables; set them to your own:

```bash
REGION=ap-northeast-1
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
VPC=vpc-0123456789abcdef0
VPC_CIDR=10.0.0.0/16
SUBNETS=subnet-0123456789abcdef0,subnet-0fedcba9876543210
DB_SG=sg-0123456789abcdef0       # the RDS instance's or cluster's security group
VALKEY_SG=sg-0fedcba9876543210   # the ElastiCache cluster's security group

export AWS_REGION=$REGION
aws ecs create-cluster --cluster-name publira
aws logs create-log-group --log-group-name /publira
```

Run the steps below in that one shell: each step uses the variables and the functions the steps before it define. Every task definition below sends its containers' output to the `/publira` log group, one stream per container.

## 1. Store the secrets

[Generate the secrets](../2-installing.md#generate-the-secrets) lists every secret an install needs and what each one protects. Store each one as a `SecureString` parameter in Systems Manager Parameter Store, under `/publira/`: a task definition names a parameter in its `secrets`, and ECS sets the value as an environment variable when the container starts, so a value shared by several processes, such as the revalidation token, is stored once and named by each of them. The connection URLs carry the role passwords, so they are parameters too, and so is the Valkey URL, which carries the AUTH token:

```bash
put() { aws ssm put-parameter --type SecureString --name "/publira/$1" --value "$2" > /dev/null; }

put secret-encryption-keys "k1:$(openssl rand -base64 32)"
put auth-jwt-secret "$(openssl rand -base64 32)"
put storefront-auth-secret "$(openssl rand -base64 32)"
put admin-auth-secret "$(openssl rand -base64 32)"
put revalidate-token "$(openssl rand -hex 32)"
put web-service-token "$(openssl rand -base64 32)"
put redis-url "rediss://:<AUTH token>@master.publira.abc123.apne1.cache.amazonaws.com:6379"

DB="publira.cluster-abc123.ap-northeast-1.rds.amazonaws.com:5432/publira?sslmode=require"
put db-url/master "postgres://<master user>:<master password>@$DB"
for role in public admin platform outbox ticker content-stats; do
  password="$(openssl rand -hex 32)"
  put "db-password/$role" "$password"
  put "db-url/$role" "postgres://publira_${role//-/_}:$password@$DB"
done
```

Write your ElastiCache primary endpoint and your RDS endpoint in place of the ones above. `rediss://` is not optional: an ElastiCache cluster takes an AUTH token only with encryption in transit, and `publira server` refuses to start on a `redis://` URL that carries a password. A connection URL carries its password unescaped, so give the AUTH token and the master password URL-safe characters, as the hex output above is, or percent-encode the others. `sslmode=require` encrypts the connection without checking the certificate, which is signed by the RDS certificate authority rather than one the images trust.

| Parameter | Read by | As |
| --- | --- | --- |
| `secret-encryption-keys` | `publira-server`, `publira-worker`, and `publiractl setup` | `PUBLIRA_SECRET_ENCRYPTION_KEYS` |
| `auth-jwt-secret` | `publira-server` | `PUBLIRA_AUTH_JWT_SECRET` |
| `storefront-auth-secret`, `admin-auth-secret` | `web-storefront` and `web-admin`, one each | `PUBLIRA_AUTH_SECRET` |
| `revalidate-token` | `publira-server` and `publira-worker`; `web-storefront` and `web-admin` | `PUBLIRA_REVALIDATE_TOKEN`; `PNCH_REVALIDATE_TOKEN` |
| `web-service-token` | `publira-server` and `web-admin` | `PUBLIRA_WEB_SERVICE_TOKEN` |
| `redis-url` | `publira-server`; `web-storefront` and `web-admin` | `PUBLIRA_REDIS_URL`; `PNCH_REDIS_URL` |
| `db-url/public`, `db-url/admin`, `db-url/platform` | `publira-server`, and `publiractl setup` for `db-url/platform` | `PUBLIRA_PUBLIC_DB_URL`, `PUBLIRA_ADMIN_DB_URL`, `PUBLIRA_PLATFORM_DB_URL` |
| `db-url/outbox`, `db-url/ticker`, `db-url/content-stats` | `publira-worker` | `PUBLIRA_WORKER_DB_URL`, `PUBLIRA_TICKER_DB_URL`, `PUBLIRA_CONTENT_STATS_DB_URL` |
| `db-url/master` | The `db` tasks alone: the `db` commands are the only ones that read the [administrative login](../2-installing.md#provision-the-services)'s connection, so nothing kept running is given it | `PUBLIRA_DB_URL` |
| `db-password/*` | The `db roles` task | Files, as [Create the database roles](#create-the-database-roles) describes |

The parameters are not a backup. Keep the encryption keys in your own secret store as well: lose them and every credential the install stored has to be entered again, as [Generate the secrets](../2-installing.md#generate-the-secrets) says. ECS reads a value when a container starts, so a changed parameter reaches a service only with its next deployment. If you keep the values in AWS Secrets Manager instead, name each secret, or a JSON key of one, in `valueFrom` in place of the parameter name, and grant the task execution role `secretsmanager:GetSecretValue` on those secrets in place of the `ssm:GetParameters` statement below.

## 2. Create the IAM roles

Two roles serve every task. The task execution role is the one ECS uses to pull the images, write the logs, and read the parameters; the containers never hold it. The task role is the one the processes sign their requests to S3 with:

```bash
cat > ecs-tasks-trust.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "ecs-tasks.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

aws iam create-role --role-name publira-task-execution \
  --assume-role-policy-document file://ecs-tasks-trust.json
aws iam attach-role-policy --role-name publira-task-execution \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
aws iam put-role-policy --role-name publira-task-execution --policy-name publira-parameters \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Effect\": \"Allow\",
      \"Action\": \"ssm:GetParameters\",
      \"Resource\": \"arn:aws:ssm:$REGION:$ACCOUNT:parameter/publira/*\"
    }]
  }"

aws iam create-role --role-name publira-storage \
  --assume-role-policy-document file://ecs-tasks-trust.json
aws iam put-role-policy --role-name publira-storage --policy-name publira-images \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
        "Resource": "arn:aws:s3:::publira-images/*"
      },
      {
        "Effect": "Allow",
        "Action": "s3:ListBucket",
        "Resource": "arn:aws:s3:::publira-images"
      }
    ]
  }'
```

Write your bucket's name in place of `publira-images`. The parameters are encrypted with the AWS managed key of Systems Manager, which needs no grant; a parameter encrypted with a key of your own also needs `kms:Decrypt` on that key.

`publira-storage` is the task role of `publira-server`, `publira-worker`, and the `publiractl setup` task: the server uploads and reads images, the worker deletes the ones nothing uses any more, and `setup` signs its connection test with it. The AWS SDK in each of them finds the role's credentials on its own, from the variables ECS sets in every task that has a task role, so [Set the install up](#7-set-the-install-up) saves the bucket without an access key, as [Object storage](../../3-operations/5-object-storage.md) describes. The web apps and the `db` tasks need no task role.

## 3. Open the network paths

Each part of the install gets a security group that admits only what calls it. ECS replaces a task's address whenever it replaces the task, so every rule names the caller's security group rather than an address:

```bash
sg() { aws ec2 create-security-group --vpc-id "$VPC" --group-name "$1" --description "$1" --query GroupId --output text; }
allow() { aws ec2 authorize-security-group-ingress --group-id "$1" --protocol tcp --port "$2" --source-group "$3" > /dev/null; }

ALB_SG=$(sg publira-alb)
SERVER_SG=$(sg publira-server)
WORKER_SG=$(sg publira-worker)
WEB_SG=$(sg publira-web)
PUBLIRACTL_SG=$(sg publiractl)

allow "$SERVER_SG" 8000 "$ALB_SG"
allow "$SERVER_SG" 8000 "$WEB_SG"
for port in 3000 4000; do
  allow "$WEB_SG" "$port" "$ALB_SG"
  allow "$WEB_SG" "$port" "$SERVER_SG"
  allow "$WEB_SG" "$port" "$WORKER_SG"
done
for caller in "$SERVER_SG" "$WORKER_SG" "$PUBLIRACTL_SG"; do
  allow "$DB_SG" 5432 "$caller"
done
for caller in "$SERVER_SG" "$WEB_SG"; do
  allow "$VALKEY_SG" 6379 "$caller"
done
```

| Security group | Admits | From |
| --- | --- | --- |
| `publira-alb` | `443` | CloudFront alone, once [The VPC origin](./1-cloudfront.md#the-vpc-origin) adds it |
| `publira-server` | `8000` | The load balancer, and the web apps calling the API |
| `publira-web` | `3000`, `4000` | The load balancer, and the server and the worker sending cache revalidations |
| `publira-worker`, `publiractl` | Nothing | Nothing calls them |
| The database's | `5432` | The server, the worker, and `publiractl` |
| The Valkey cluster's | `6379` | The server and the web apps |

The worker and `publiractl` reach nothing in Valkey, and the web apps nothing in the database, so neither path is opened. Every group keeps the default rule that lets it connect out, which the tasks need for the images, the AWS APIs, S3, and SMTP.

Cloud Map gives each service that something calls a name under a private DNS namespace of the VPC:

```bash
aws servicediscovery create-private-dns-namespace --name publira.internal --vpc "$VPC"
NAMESPACE=$(aws servicediscovery list-namespaces \
  --query "Namespaces[?Name=='publira.internal'].Id" --output text)
for name in publira-server web-storefront web-admin; do
  aws servicediscovery create-service --name "$name" --namespace-id "$NAMESPACE" \
    --dns-config 'RoutingPolicy=MULTIVALUE,DnsRecords=[{Type=A,TTL=10}]' \
    --health-check-custom-config FailureThreshold=1 > /dev/null
done
registry() { aws servicediscovery list-services \
  --filters "Name=NAMESPACE_ID,Values=$NAMESPACE,Condition=EQ" \
  --query "Services[?Name=='$1'].Arn" --output text; }
```

The namespace takes a moment to be created; run `list-namespaces` again until it answers with an ID. ECS registers each task's address under its service's name when the task starts and removes it when the task stops.

## 4. Apply the migrations and create the database roles

The `db` commands run as one-off tasks from the `publiractl` image of the release, on the administrative login's connection. Every one of them is started and waited on the same way, so define that once:

```bash
run_publiractl() {
  local task code
  task=$(aws ecs run-task --cluster publira --launch-type FARGATE --task-definition "$1" \
    --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$PUBLIRACTL_SG],assignPublicIp=DISABLED}" \
    --query 'tasks[0].taskArn' --output text) || return
  echo "$task"
  aws ecs wait tasks-stopped --cluster publira --tasks "$task" || return
  aws logs tail /publira --log-stream-name-prefix "$1/publiractl/${task##*/}"
  code=$(aws ecs describe-tasks --cluster publira --tasks "$task" \
    --query "tasks[0].containers[?name=='publiractl'].exitCode | [0]" --output text)
  echo "exit code: $code"
  [ "$code" = 0 ]
}
```

It prints the task's ARN, the command's log, and its exit code, and fails unless that code is `0`, so a script that runs it can stop there. `aws ecs wait tasks-stopped` gives up after ten minutes whether the task has stopped or not, and the function fails with it; wait again with the ARN it printed before reading the log. A task that never started, such as one whose image could not be pulled, has no exit code, which the function prints as `None`, and `aws ecs describe-tasks --cluster publira --tasks <its ARN> --query 'tasks[0].stoppedReason'` names why.

### Apply the migrations

`publiractl-db-migrate.json`:

```json
{
  "family": "publiractl-db-migrate",
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::<account>:role/publira-task-execution",
  "containerDefinitions": [
    {
      "name": "publiractl",
      "image": "ghcr.io/publira/publiractl:<tag>",
      "command": ["db", "migrate"],
      "secrets": [
        { "name": "PUBLIRA_DB_URL", "valueFrom": "/publira/db-url/master" }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/publira",
          "awslogs-region": "<region>",
          "awslogs-stream-prefix": "publiractl-db-migrate"
        }
      }
    }
  ]
}
```

```bash
aws ecs register-task-definition --cli-input-json file://publiractl-db-migrate.json
run_publiractl publiractl-db-migrate
```

A task started with `run-task` runs once, and ECS does not start it again when it fails, which is what a failed migration needs: it leaves the database marked dirty, which [When a migration fails](../8-upgrading.md#when-a-migration-fails) resolves by hand. Running it again, as the last step of that recovery does, is the same `run_publiractl`.

### Create the database roles

A Fargate task offers `db roles` neither a stdin nor a terminal to read a password from, and ECS hands a container its secrets as environment variables rather than as files. So the task's `secrets` set one variable per role password, and `db roles` reads each with its `--<role>-password-env` flag. Only the variables' names are in the command, so no password appears in the task definition or in the process list.

`publiractl-db-roles.json`:

```json
{
  "family": "publiractl-db-roles",
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::<account>:role/publira-task-execution",
  "containerDefinitions": [
    {
      "name": "publiractl",
      "image": "ghcr.io/publira/publiractl:<tag>",
      "command": [
        "db",
        "roles",
        "--public-password-env",
        "PUBLIRA_PUBLIC_DB_PASSWORD",
        "--admin-password-env",
        "PUBLIRA_ADMIN_DB_PASSWORD",
        "--platform-password-env",
        "PUBLIRA_PLATFORM_DB_PASSWORD",
        "--outbox-password-env",
        "PUBLIRA_OUTBOX_DB_PASSWORD",
        "--ticker-password-env",
        "PUBLIRA_TICKER_DB_PASSWORD",
        "--content-stats-password-env",
        "PUBLIRA_CONTENT_STATS_DB_PASSWORD"
      ],
      "secrets": [
        { "name": "PUBLIRA_DB_URL", "valueFrom": "/publira/db-url/master" },
        {
          "name": "PUBLIRA_PUBLIC_DB_PASSWORD",
          "valueFrom": "/publira/db-password/public"
        },
        {
          "name": "PUBLIRA_ADMIN_DB_PASSWORD",
          "valueFrom": "/publira/db-password/admin"
        },
        {
          "name": "PUBLIRA_PLATFORM_DB_PASSWORD",
          "valueFrom": "/publira/db-password/platform"
        },
        {
          "name": "PUBLIRA_OUTBOX_DB_PASSWORD",
          "valueFrom": "/publira/db-password/outbox"
        },
        {
          "name": "PUBLIRA_TICKER_DB_PASSWORD",
          "valueFrom": "/publira/db-password/ticker"
        },
        {
          "name": "PUBLIRA_CONTENT_STATS_DB_PASSWORD",
          "valueFrom": "/publira/db-password/content-stats"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/publira",
          "awslogs-region": "<region>",
          "awslogs-stream-prefix": "publiractl-db-roles"
        }
      }
    }
  ]
}
```

```bash
aws ecs register-task-definition --cli-input-json file://publiractl-db-roles.json
run_publiractl publiractl-db-roles
```

The log has one line per role. The same task is how a role's password is rotated later: put the new password in its `db-password/` parameter and in the `db-url/` parameter that carries it, with `aws ssm put-parameter --overwrite`, which `put` above leaves out so that it never replaces a value by accident, run the task again, and deploy the service that connects as that role again, so its tasks start with the new URL. For `publira_admin`, whose URL `publira-server` carries:

```bash
run_publiractl publiractl-db-roles
aws ecs update-service --cluster publira --service publira-server --force-new-deployment
```

## 5. Create the load balancer

The load balancer routes each host and path to the right service. It is internal, with no address on the internet: CloudFront reaches it as a VPC origin, as [The VPC origin](./1-cloudfront.md#the-vpc-origin) sets up. It still terminates TLS with a certificate for every host it serves, because CloudFront forwards the `Host` the browser sent and then accepts only a certificate for that name from the load balancer, and because the load balancer tells the web apps the request arrived over HTTPS only when it arrived at an HTTPS listener.

Request one certificate in ACM per tenant, naming its domain and its console host, and validate it with the CNAME records ACM gives you. CloudFront takes certificates from `us-east-1` alone, so request it there too unless the load balancer is in `us-east-1`, where one certificate serves both:

```bash
for region in "$REGION" us-east-1; do
  aws acm request-certificate --region "$region" \
    --domain-name comics.example.com --subject-alternative-names admin.comics.example.com \
    --validation-method DNS --query CertificateArn --output text
done
```

```bash
aws acm describe-certificate --region "$REGION" --certificate-arn <the certificate ARN> \
  --query 'Certificate.DomainValidationOptions[].ResourceRecord'
aws acm wait certificate-validated --region "$REGION" --certificate-arn <the certificate ARN>
```

Add the records the first command prints to the zone of each name, and do the same for the certificate in `us-east-1`. Then create the load balancer, a target group per service it forwards to, and an HTTPS listener that answers a request no rule matches with a `404`:

```bash
ALB=$(aws elbv2 create-load-balancer --name publira --type application --scheme internal \
  --subnets ${SUBNETS//,/ } --security-groups "$ALB_SG" \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text)

target_group() { aws elbv2 create-target-group --name "$1" --protocol HTTP --port "$2" \
  --target-type ip --vpc-id "$VPC" --health-check-path /livez \
  --query 'TargetGroups[0].TargetGroupArn' --output text; }
SERVER_TG=$(target_group publira-server 8000)
STOREFRONT_TG=$(target_group web-storefront 3000)
ADMIN_TG=$(target_group web-admin 4000)

LISTENER=$(aws elbv2 create-listener --load-balancer-arn "$ALB" --protocol HTTPS --port 443 \
  --ssl-policy ELBSecurityPolicy-TLS13-1-2-2021-06 \
  --certificates CertificateArn=<the certificate ARN in the load balancer's Region> \
  --default-actions 'Type=fixed-response,FixedResponseConfig={StatusCode=404,ContentType=text/plain}' \
  --query 'Listeners[0].ListenerArn' --output text)
aws elbv2 modify-load-balancer-attributes --load-balancer-arn "$ALB" \
  --attributes Key=idle_timeout.timeout_seconds,Value=120 > /dev/null
```

The listener's rules follow [Routing](../4-edge/index.md#routing). A rule takes up to three values per condition and five across its conditions, and the load balancer tries its rules in the order of their priorities, lowest first:

| Priority | Host | Path | Forwards to |
| --- | --- | --- | --- |
| `1000` | Any | `/images*`, `/rpc/publira.v1.*` | `publira-server` |
| `1100` | Any | `/rpc`, `/rpc/*` | None: a fixed `404` |
| `2000` to `2999` | A tenant's domain | Any | `web-storefront` |
| `2000` to `2999` | A tenant's console host | Any | `web-admin` |

```bash
rule() { aws elbv2 create-rule --listener-arn "$LISTENER" --priority "$1" \
  --conditions "$2" --actions "Type=forward,TargetGroupArn=$3" > /dev/null; }
not_found() { aws elbv2 create-rule --listener-arn "$LISTENER" --priority "$1" \
  --conditions "$2" \
  --actions 'Type=fixed-response,FixedResponseConfig={StatusCode=404,ContentType=text/plain}' > /dev/null; }
host_is() { printf '{"Field":"host-header","HostHeaderConfig":{"Values":["%s"]}}' "$1"; }
path_is() { printf '{"Field":"path-pattern","PathPatternConfig":{"Values":%s}}' "$1"; }

rule 1000 "[$(path_is '["/images*","/rpc/publira.v1.*"]')]" "$SERVER_TG"
not_found 1100 "[$(path_is '["/rpc","/rpc/*"]')]"
rule 2001 "[$(host_is comics.example.com)]" "$STOREFRONT_TG"
rule 2002 "[$(host_is admin.comics.example.com)]" "$ADMIN_TG"
```

Under `/rpc`, only the public API, `publira.v1`, is forwarded: the consoles call their own APIs over the VPC, so the load balancer answers the rest with a `404` of its own, as [Only the public API goes through the edge](../4-edge/index.md#only-the-public-api-goes-through-the-edge) explains. A path pattern is matched as a string, with `*` standing for any characters, so `/rpc/publira.v1.*` names the public API's prefix up to the dot after `v1`, which keeps a namespace such as `publira.v1beta` out, and `/rpc` and `/rpc/*` are two values, so that `/rpcabc` stays with a web app. The rules at `1000` and `1100` name no host, so they apply on every host the load balancer receives, which is what Routing asks of every tenant's hosts; a host in none of the other rules gets the `404` on every other path. The load balancer passes the path and the `Host` header on as the browser sent them; add no rewrite of either.

The load balancer sets no limit on the size of a body, and lets a request take as long as it keeps sending, so the uploads and webhooks [Edge](../4-edge/index.md#image-uploads-from-a-page) describes pass it as they are. Its idle timeout is how long it waits for the next byte either way, including for a web app's answer once a request has arrived: 60 seconds unless changed, which the command above raises to the 120 seconds CloudFront waits, as [The distribution](./1-cloudfront.md#the-distribution) sets.

## 6. Start the services

Each service gets its secrets from the parameters and the rest of the variables the [deployment reference](https://github.com/publira/publira/blob/main/infra/deploy/README.md#environment-variables) lists in its task definition. The sizes below are a starting point to adjust, and `ARM64` can be `X86_64`: every image is published for both.

`publira server` and `publira worker` stop within 30 seconds of being told to, so their container definitions give them a `stopTimeout` of 45 seconds before ECS kills them, where the default would be 30, as [Stopping a copy](../7-scaling-out.md#stopping-a-copy) describes.

`publira-server.json`:

```json
{
  "family": "publira-server",
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "runtimePlatform": {
    "operatingSystemFamily": "LINUX",
    "cpuArchitecture": "ARM64"
  },
  "cpu": "1024",
  "memory": "2048",
  "executionRoleArn": "arn:aws:iam::<account>:role/publira-task-execution",
  "taskRoleArn": "arn:aws:iam::<account>:role/publira-storage",
  "containerDefinitions": [
    {
      "name": "publira-server",
      "image": "ghcr.io/publira/publira:<tag>",
      "portMappings": [{ "containerPort": 8000 }],
      "environment": [
        { "name": "PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID", "value": "k1" },
        {
          "name": "PUBLIRA_WEB_STOREFRONT_INTERNAL_URL",
          "value": "http://web-storefront.publira.internal:3000"
        },
        {
          "name": "PUBLIRA_WEB_ADMIN_INTERNAL_URL",
          "value": "http://web-admin.publira.internal:4000"
        },
        {
          "name": "PUBLIRA_TRUSTED_PROXIES",
          "value": "<see The client address>"
        }
      ],
      "secrets": [
        {
          "name": "PUBLIRA_SECRET_ENCRYPTION_KEYS",
          "valueFrom": "/publira/secret-encryption-keys"
        },
        {
          "name": "PUBLIRA_AUTH_JWT_SECRET",
          "valueFrom": "/publira/auth-jwt-secret"
        },
        {
          "name": "PUBLIRA_WEB_SERVICE_TOKEN",
          "valueFrom": "/publira/web-service-token"
        },
        {
          "name": "PUBLIRA_REVALIDATE_TOKEN",
          "valueFrom": "/publira/revalidate-token"
        },
        { "name": "PUBLIRA_REDIS_URL", "valueFrom": "/publira/redis-url" },
        {
          "name": "PUBLIRA_PUBLIC_DB_URL",
          "valueFrom": "/publira/db-url/public"
        },
        {
          "name": "PUBLIRA_ADMIN_DB_URL",
          "valueFrom": "/publira/db-url/admin"
        },
        {
          "name": "PUBLIRA_PLATFORM_DB_URL",
          "valueFrom": "/publira/db-url/platform"
        }
      ],
      "healthCheck": {
        "command": [
          "CMD",
          "/usr/bin/bash",
          "-c",
          "exec 3<>/dev/tcp/127.0.0.1/8000 && printf 'GET /livez HTTP/1.0\\r\\n\\r\\n' >&3 && grep -q '^HTTP/1\\.[01] 200' <&3"
        ],
        "startPeriod": 30
      },
      "stopTimeout": 45,
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/publira",
          "awslogs-region": "<region>",
          "awslogs-stream-prefix": "publira-server"
        }
      }
    }
  ]
}
```

[The client address](./1-cloudfront.md#the-client-address) gives the value of `PUBLIRA_TRUSTED_PROXIES`.

`publira-worker.json` runs the same image with `worker` as its command, and its health check probes port `8003`:

```json
{
  "family": "publira-worker",
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "runtimePlatform": {
    "operatingSystemFamily": "LINUX",
    "cpuArchitecture": "ARM64"
  },
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::<account>:role/publira-task-execution",
  "taskRoleArn": "arn:aws:iam::<account>:role/publira-storage",
  "containerDefinitions": [
    {
      "name": "publira-worker",
      "image": "ghcr.io/publira/publira:<tag>",
      "command": ["worker"],
      "environment": [
        { "name": "PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID", "value": "k1" },
        {
          "name": "PUBLIRA_WEB_STOREFRONT_INTERNAL_URL",
          "value": "http://web-storefront.publira.internal:3000"
        },
        {
          "name": "PUBLIRA_WEB_ADMIN_INTERNAL_URL",
          "value": "http://web-admin.publira.internal:4000"
        }
      ],
      "secrets": [
        {
          "name": "PUBLIRA_SECRET_ENCRYPTION_KEYS",
          "valueFrom": "/publira/secret-encryption-keys"
        },
        {
          "name": "PUBLIRA_REVALIDATE_TOKEN",
          "valueFrom": "/publira/revalidate-token"
        },
        {
          "name": "PUBLIRA_WORKER_DB_URL",
          "valueFrom": "/publira/db-url/outbox"
        },
        {
          "name": "PUBLIRA_TICKER_DB_URL",
          "valueFrom": "/publira/db-url/ticker"
        },
        {
          "name": "PUBLIRA_CONTENT_STATS_DB_URL",
          "valueFrom": "/publira/db-url/content-stats"
        }
      ],
      "healthCheck": {
        "command": [
          "CMD",
          "/usr/bin/bash",
          "-c",
          "exec 3<>/dev/tcp/127.0.0.1/8003 && printf 'GET /livez HTTP/1.0\\r\\n\\r\\n' >&3 && grep -q '^HTTP/1\\.[01] 200' <&3"
        ],
        "startPeriod": 30
      },
      "stopTimeout": 45,
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/publira",
          "awslogs-region": "<region>",
          "awslogs-stream-prefix": "publira-worker"
        }
      }
    }
  ]
}
```

`web-storefront.json` follows the same shape, with no task role, and calls `publira server` by its Cloud Map name:

```json
{
  "family": "web-storefront",
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "runtimePlatform": {
    "operatingSystemFamily": "LINUX",
    "cpuArchitecture": "ARM64"
  },
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::<account>:role/publira-task-execution",
  "containerDefinitions": [
    {
      "name": "web-storefront",
      "image": "ghcr.io/publira/web-storefront:<tag>",
      "portMappings": [{ "containerPort": 3000 }],
      "environment": [
        {
          "name": "PUBLIRA_GRPC_URL",
          "value": "http://publira-server.publira.internal:8000/rpc"
        },
        {
          "name": "PUBLIRA_TRUSTED_PROXIES",
          "value": "<see The client address>"
        }
      ],
      "secrets": [
        {
          "name": "PUBLIRA_AUTH_SECRET",
          "valueFrom": "/publira/storefront-auth-secret"
        },
        {
          "name": "PNCH_REVALIDATE_TOKEN",
          "valueFrom": "/publira/revalidate-token"
        },
        { "name": "PNCH_REDIS_URL", "valueFrom": "/publira/redis-url" }
      ],
      "healthCheck": {
        "command": [
          "CMD",
          "/nodejs/bin/node",
          "-e",
          "fetch('http://127.0.0.1:3000/livez').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
        ],
        "startPeriod": 30
      },
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/publira",
          "awslogs-region": "<region>",
          "awslogs-stream-prefix": "web-storefront"
        }
      }
    }
  ]
}
```

`web-storefront` takes the same `PUBLIRA_TRUSTED_PROXIES` as `publira server`, to find the reader's address it passes to a tenant's Google tag gateway. `web-admin.json` is the same with `web-admin` everywhere `web-storefront` appears, port `4000` in place of `3000`, in its health check too, `/publira/admin-auth-secret` as its `PUBLIRA_AUTH_SECRET`, no `PUBLIRA_TRUSTED_PROXIES`, which `web-admin` does not read, and one more secret, `PUBLIRA_WEB_SERVICE_TOKEN` from `/publira/web-service-token`.

Register the four, and create a service for each, with the security group, the target group, and the Cloud Map name each one takes:

```bash
for family in publira-server publira-worker web-storefront web-admin; do
  aws ecs register-task-definition --cli-input-json "file://$family.json" > /dev/null
done

service() {
  local name=$1 sg=$2 port=$3 tg=$4
  set -- --cluster publira --service-name "$name" --task-definition "$name" \
    --desired-count 2 --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$sg],assignPublicIp=DISABLED}"
  if [ -n "$tg" ]; then
    set -- "$@" --load-balancers "targetGroupArn=$tg,containerName=$name,containerPort=$port" \
      --service-registries "registryArn=$(registry "$name")" --health-check-grace-period-seconds 60
  fi
  aws ecs create-service "$@" > /dev/null
}
service publira-server "$SERVER_SG" 8000 "$SERVER_TG"
service publira-worker "$WORKER_SG"
service web-storefront "$WEB_SG" 3000 "$STOREFRONT_TG"
service web-admin "$WEB_SG" 4000 "$ADMIN_TG"

aws ecs wait services-stable --cluster publira \
  --services publira-server publira-worker web-storefront web-admin
```

`publira-worker` creates the tables of its job queue when it starts, so it needs no task of its own. A service that does not become stable keeps stopping tasks, and `aws ecs describe-services --cluster publira --services <name> --query 'services[0].events[:5]'` says why: a task that failed its health check, or one that stopped, whose log in `/publira` names the cause, such as a role whose password does not match its connection URL.

### Health checks

An ECS service replaces a task that fails its health check, whichever kind it is, so every health check on this page probes `/livez`, which fails only when the process itself stops answering. Pointing one at `/readyz` would have ECS replace every task of a service together the moment the database stops answering, which is what [Probing from an orchestrator](../../3-operations/11-monitoring.md#probing-from-an-orchestrator) warns against.

- **Every service** has a health check in its task definition, which ECS runs inside the task. The images carry no HTTP client, so each check uses what its image does carry: `bash`, whose `/dev/tcp` opens the connection, in the `publira` image, and `node`, whose `fetch` makes the request, in the web images, which have no shell. Each check asks for `/livez` on the container's own port and passes on a `200`. It runs every 30 seconds, gives up after 5, and marks the task unhealthy after three failures in a row, the defaults of an ECS health check; `startPeriod` gives the process 30 seconds to start before a failure counts. Cloud Map marks a task's address healthy once that check passes, and removes it when the check fails, so the names the services call one another by follow the same check.
- **`publira-server` and the web apps** are also probed by their target groups, which `--health-check-path /livez` points at the same path. ECS waits `--health-check-grace-period-seconds` after a task starts before it acts on that check, and the load balancer sends a new task requests once it passes.

Readiness is still worth looking at, from outside the services rather than as a health check: `https://<domain>/readyz` answers with the readiness of `web-storefront`, which includes that of `publira server` and Valkey, once the edge is up. The worker's `/readyz` is reached by nothing; a login of its own that fails shows in its log, as the jobs that use it fail.

## 7. Set the install up

`publiractl setup` runs once, as a task with every value given as a flag: a task started with `run-task` has no terminal to ask on. It connects as `publira_platform` and seals what it saves with the encryption keys, so it reads the same parameters the server does for both, and it takes the `publira-storage` task role for the connection test of the bucket. It is not given `db-url/master`: `setup` never connects as the administrative login.

What it prints goes to CloudWatch Logs, so give the administrator a password rather than having one generated: a generated password is printed in the summary, and a password given through a variable is not. Store it, and the SMTP password, as parameters of their own:

```bash
put setup/smtp-password '<the SMTP password>'
put setup/admin-password "$(openssl rand -base64 18)"
```

They reach `publiractl` the way the role passwords do, as variables its `--smtp-password-env` and `--admin-password-env` flags name. `publiractl-setup.json`:

```json
{
  "family": "publiractl-setup",
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::<account>:role/publira-task-execution",
  "taskRoleArn": "arn:aws:iam::<account>:role/publira-storage",
  "containerDefinitions": [
    {
      "name": "publiractl",
      "image": "ghcr.io/publira/publiractl:<tag>",
      "command": [
        "setup",
        "--non-interactive",
        "--default-locale",
        "en",
        "--bucket",
        "publira-images",
        "--region",
        "<region>",
        "--host",
        "email-smtp.<region>.amazonaws.com",
        "--port",
        "587",
        "--encryption",
        "starttls",
        "--username",
        "<the SMTP user name>",
        "--smtp-password-env",
        "PUBLIRA_SETUP_SMTP_PASSWORD",
        "--from-address",
        "no-reply@example.com",
        "--tenant-name",
        "Example Comics",
        "--domain",
        "comics.example.com",
        "--admin-email",
        "owner@comics.example.com",
        "--admin-name",
        "Owner",
        "--admin-password-env",
        "PUBLIRA_SETUP_ADMIN_PASSWORD"
      ],
      "environment": [
        { "name": "PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID", "value": "k1" }
      ],
      "secrets": [
        {
          "name": "PUBLIRA_SECRET_ENCRYPTION_KEYS",
          "valueFrom": "/publira/secret-encryption-keys"
        },
        {
          "name": "PUBLIRA_PLATFORM_DB_URL",
          "valueFrom": "/publira/db-url/platform"
        },
        {
          "name": "PUBLIRA_SETUP_SMTP_PASSWORD",
          "valueFrom": "/publira/setup/smtp-password"
        },
        {
          "name": "PUBLIRA_SETUP_ADMIN_PASSWORD",
          "valueFrom": "/publira/setup/admin-password"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/publira",
          "awslogs-region": "<region>",
          "awslogs-stream-prefix": "publiractl-setup"
        }
      }
    }
  ]
}
```

```bash
aws ecs register-task-definition --cli-input-json file://publiractl-setup.json
run_publiractl publiractl-setup
```

There is no `--access-key-id` and no secret key: the bucket is saved with no key of its own, and every process signs with its task role. The SMTP values above are those of Amazon SES, whose SMTP credentials are not the access key of an IAM user but a user name and password made from one; for another server, give its host, port, and encryption. The [`publiractl` reference](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#setup) lists every flag, and the steps that are optional.

A run that stops partway, on a connection test that fails for one, keeps what it saved and is finished by running it again once the cause is fixed.

The administrator's password is the `/publira/setup/admin-password` parameter: `aws ssm get-parameter --with-decryption --name /publira/setup/admin-password --query Parameter.Value --output text` prints it. Once they have signed in and changed it, delete that parameter: nothing reads it afterwards.

## 8. Put CloudFront in front

CloudFront is the edge readers connect to: it terminates TLS for every tenant's hosts, redirects plain HTTP to HTTPS, removes the headers a caller must not choose, and forwards everything else to the load balancer. [CloudFront in front of ECS](./1-cloudfront.md) sets it up, in this same shell, since it uses the variables and the functions the steps above defined, and checks it from outside the VPC. Come back here once those checks pass, to sign in.

## 9. Sign in

Open the tenant console at `https://admin.comics.example.com`, or the console host you gave `--admin-domain`, and sign in with the administrator's email address and password. From here on the install is the one [Sign in](../2-installing.md#6-sign-in) describes.

## In this section

- [CloudFront in front of ECS](./1-cloudfront.md): the VPC origin, the headers, the cache policies, the distribution, the client address, and checking the edge from outside the VPC.
- [Operating on ECS](./2-operating.md): adding a tenant, keeping the consoles' credentials off the tenants' domains, and upgrading.

## Next steps

[Edge](../4-edge/index.md) is the full statement of what CloudFront and the load balancer have to do together, and [Monitoring](../../3-operations/11-monitoring.md) of what to watch once the install is serving. The variables each process reads are in the [deployment reference](https://github.com/publira/publira/blob/main/infra/deploy/README.md), and the optional processes are turned on as [Turning on the optional processes](../2-installing.md#turning-on-the-optional-processes) describes, each as a service like the ones above: `web-platform` with a target group, rules for its host, a Cloud Map name, and port `4100` opened in `publira-web`, and `email-renderer` with a Cloud Map name alone and a security group that admits port `8080` from `publira-worker`.
