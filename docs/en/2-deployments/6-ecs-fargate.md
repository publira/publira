---
title: Amazon ECS on Fargate
description: Run an install as Amazon ECS services on AWS Fargate behind CloudFront and an Application Load Balancer, from its parameters and task definitions to the first sign-in to the tenant console.
published: 2026-10-15
updated: 2026-10-20
---

This page takes an install from a VPC with the managed services provisioned to the first sign-in to the tenant console, with every process an Amazon ECS service on AWS Fargate and CloudFront in front of an Application Load Balancer as the edge. It runs the same steps as [Installing](./2-installing.md), which explains why each step exists, what every secret protects, and what each database role can reach, and it puts the edge in front the way [Edge](./4-edge.md#what-the-edge-has-to-do) requires. This page covers what is particular to ECS and Fargate: which resources each part becomes, and how each requirement of those two pages is met with them.

The commands and JSON below are illustrations to adapt, not a maintained set: the repository ships no CloudFormation template, CDK app, or Terraform module. They are written for the AWS CLI version 2 and name the published images, `ghcr.io/publira/<name>:<tag>`; write the version of the release you install in place of `<tag>`, as [Before you start](./2-installing.md#before-you-start) describes, and your account ID and Region in place of `<account>` and `<region>`.

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

Run `publira server` and `publira worker` as the two services above rather than as one `publira server --with-worker`. That flag is for an install on one host: on ECS it gives up scaling the two apart and puts the worker's database logins in the process the load balancer forwards to, as the [Overview](./1-overview.md#what-an-install-runs) describes, and buys nothing ECS needs.

The processes call one another by the names Cloud Map service discovery gives them, such as `publira-server.publira.internal`, which resolve to the address of each running task. A call therefore reaches the task directly, from the caller's own address. ECS Service Connect would instead pass each call through a proxy in the receiving task, which hands it on from `127.0.0.1`, and `publira server` would record every request a web app makes for a reader with that address.

`publiractl` is not kept running. It runs as a task you start with `aws ecs run-task`, from the image of the release you install, and stops when the command finishes.

## Before you start

You need:

- **The AWS CLI version 2**, signed in to the account with permission to manage ECS, Cloud Map, Elastic Load Balancing, CloudFront, ACM, IAM roles, Systems Manager parameters, EC2 security groups, and CloudWatch Logs.
- **A VPC** with private subnets in at least two Availability Zones for the tasks and the load balancer, with at least one free address in each for the network interface CloudFront creates there, and an internet gateway attached, which CloudFront requires of a VPC whose load balancer it reaches as a VPC origin, even though nothing is routed through it. The tasks have to reach the GitHub Container Registry to pull the images, the Systems Manager and CloudWatch Logs APIs, Amazon S3, and your SMTP server: give the private subnets a NAT gateway, or VPC endpoints for the AWS services and a pull-through cache for the images.
- **The services the install depends on**, provisioned as [Provision the services](./2-installing.md#provision-the-services) lists:
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

[Generate the secrets](./2-installing.md#generate-the-secrets) lists every secret an install needs and what each one protects. Store each one as a `SecureString` parameter in Systems Manager Parameter Store, under `/publira/`: a task definition names a parameter in its `secrets`, and ECS sets the value as an environment variable when the container starts, so a value shared by several processes, such as the revalidation token, is stored once and named by each of them. The connection URLs carry the role passwords, so they are parameters too, and so is the Valkey URL, which carries the AUTH token:

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
| `db-url/master` | The `db` tasks alone: the `db` commands are the only ones that read the [administrative login](./2-installing.md#provision-the-services)'s connection, so nothing kept running is given it | `PUBLIRA_DB_URL` |
| `db-password/*` | The `db roles` task | Files, as [Create the database roles](#create-the-database-roles) describes |

The parameters are not a backup. Keep the encryption keys in your own secret store as well: lose them and every credential the install stored has to be entered again, as [Generate the secrets](./2-installing.md#generate-the-secrets) says. ECS reads a value when a container starts, so a changed parameter reaches a service only with its next deployment. If you keep the values in AWS Secrets Manager instead, name each secret, or a JSON key of one, in `valueFrom` in place of the parameter name, and grant the task execution role `secretsmanager:GetSecretValue` on those secrets in place of the `ssm:GetParameters` statement below.

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

`publira-storage` is the task role of `publira-server`, `publira-worker`, and the `publiractl setup` task: the server uploads and reads images, the worker deletes the ones nothing uses any more, and `setup` signs its connection test with it. The AWS SDK in each of them finds the role's credentials on its own, from the variables ECS sets in every task that has a task role, so [Set the install up](#7-set-the-install-up) saves the bucket without an access key, as [Object storage](../3-operations/5-object-storage.md) describes. The web apps and the `db` tasks need no task role.

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
| `publira-alb` | `443` | CloudFront alone, once [Put CloudFront in front](#8-put-cloudfront-in-front) adds it |
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

A task started with `run-task` runs once, and ECS does not start it again when it fails, which is what a failed migration needs: it leaves the database marked dirty, which [When a migration fails](./7-upgrading.md#when-a-migration-fails) resolves by hand. Running it again, as the last step of that recovery does, is the same `run_publiractl`.

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

The load balancer routes each host and path to the right service. It is internal, with no address on the internet: CloudFront reaches it as a VPC origin, as [Put CloudFront in front](#8-put-cloudfront-in-front) sets up. It still terminates TLS with a certificate for every host it serves, because CloudFront forwards the `Host` the browser sent and then accepts only a certificate for that name from the load balancer, and because the load balancer tells the web apps the request arrived over HTTPS only when it arrived at an HTTPS listener.

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

The listener's rules follow [Routing](./4-edge.md#routing). A rule takes up to three values per condition and five across its conditions, and the load balancer tries its rules in the order of their priorities, lowest first:

| Priority | Host | Path | Forwards to |
| --- | --- | --- | --- |
| `1000` | Any | `/images*`, `/rpc/publira.v1.*`, `/api/publira.v1.*` | `publira-server` |
| `1100` | Any | `/rpc`, `/rpc/*` | None: a fixed `404` |
| `2000` to `2999` | A tenant's domain | `/api/v1`, `/api/v1/*` | `web-storefront` |
| `2000` to `2999` | A tenant's console host | `/api/v1`, `/api/v1/*` | `web-admin` |
| `3000` | Any | `/api`, `/api/*` | None: a fixed `404` |
| `4000` to `4999` | A tenant's domain | Any | `web-storefront` |
| `4000` to `4999` | A tenant's console host | Any | `web-admin` |

```bash
rule() { aws elbv2 create-rule --listener-arn "$LISTENER" --priority "$1" \
  --conditions "$2" --actions "Type=forward,TargetGroupArn=$3" > /dev/null; }
not_found() { aws elbv2 create-rule --listener-arn "$LISTENER" --priority "$1" \
  --conditions "$2" \
  --actions 'Type=fixed-response,FixedResponseConfig={StatusCode=404,ContentType=text/plain}' > /dev/null; }
host_is() { printf '{"Field":"host-header","HostHeaderConfig":{"Values":["%s"]}}' "$1"; }
path_is() { printf '{"Field":"path-pattern","PathPatternConfig":{"Values":%s}}' "$1"; }

rule 1000 "[$(path_is '["/images*","/rpc/publira.v1.*","/api/publira.v1.*"]')]" "$SERVER_TG"
not_found 1100 "[$(path_is '["/rpc","/rpc/*"]')]"
rule 2001 "[$(host_is comics.example.com),$(path_is '["/api/v1","/api/v1/*"]')]" "$STOREFRONT_TG"
rule 2002 "[$(host_is admin.comics.example.com),$(path_is '["/api/v1","/api/v1/*"]')]" "$ADMIN_TG"
not_found 3000 "[$(path_is '["/api","/api/*"]')]"
rule 4001 "[$(host_is comics.example.com)]" "$STOREFRONT_TG"
rule 4002 "[$(host_is admin.comics.example.com)]" "$ADMIN_TG"
```

`/rpc` is the API's prefix, and `/api` the one it had before, which `publira server` answers until 0.3.0 for the clients not yet on `/rpc`; route both until then. Under either, only the public API, `publira.v1`, is forwarded: the consoles call their own APIs over the VPC, so the load balancer answers the rest with a `404` of its own, as [Only the public API goes through the edge](./4-edge.md#only-the-public-api-goes-through-the-edge) explains. A path pattern is matched as a string, with `*` standing for any characters, so `/rpc/publira.v1.*` names the public API's prefix up to the dot after `v1`, which keeps a namespace such as `publira.v1beta` out, and `/api/v1` and `/api/v1/*` are two values: `/api/v1*` would send `/api/v10` to a web app, where Routing has the edge answer it. The rules at `1000`, `1100`, and `3000` name no host, so they apply on every host the load balancer receives, which is what Routing asks of every tenant's hosts; a host in none of the other rules gets the `404` on every other path. The load balancer passes the path and the `Host` header on as the browser sent them; add no rewrite of either.

The load balancer sets no limit on the size of a body, and lets a request take as long as it keeps sending, so the uploads and webhooks [Edge](./4-edge.md#image-uploads-from-a-page) describes pass it as they are. Its idle timeout is how long it waits for the next byte either way, including for a web app's answer once a request has arrived: 60 seconds unless changed, which the command above raises to the 120 seconds CloudFront waits, as [The distribution](#the-distribution) sets.

## 6. Start the services

Each service gets its secrets from the parameters and the rest of the variables the [deployment reference](https://github.com/publira/publira/blob/main/infra/deploy/README.md#environment-variables) lists in its task definition. The sizes below are a starting point to adjust, and `ARM64` can be `X86_64`: every image is published for both.

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

[The client address](#the-client-address) gives the value of `PUBLIRA_TRUSTED_PROXIES`.

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

`web-admin.json` is the same with `web-admin` everywhere `web-storefront` appears, port `4000` in place of `3000`, in its health check too, `/publira/admin-auth-secret` as its `PUBLIRA_AUTH_SECRET`, and one more secret, `PUBLIRA_WEB_SERVICE_TOKEN` from `/publira/web-service-token`.

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

An ECS service replaces a task that fails its health check, whichever kind it is, so every health check on this page probes `/livez`, which fails only when the process itself stops answering. Pointing one at `/readyz` would have ECS replace every task of a service together the moment the database stops answering, which is what [Probing from an orchestrator](../3-operations/11-monitoring.md#probing-from-an-orchestrator) warns against.

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

CloudFront is the edge readers connect to: it terminates TLS for every tenant's hosts with the certificate in `us-east-1`, redirects plain HTTP to HTTPS, removes the headers a caller must not choose, and forwards everything else to the load balancer, as [What the edge has to do](./4-edge.md#what-the-edge-has-to-do) requires.

### The VPC origin

The load balancer is internal, so CloudFront reaches it as a VPC origin, over HTTPS:

```bash
aws cloudfront create-vpc-origin --vpc-origin-endpoint-config "{
  \"Name\": \"publira\",
  \"Arn\": \"$ALB\",
  \"HTTPPort\": 80,
  \"HTTPSPort\": 443,
  \"OriginProtocolPolicy\": \"https-only\",
  \"OriginSslProtocols\": { \"Quantity\": 1, \"Items\": [\"TLSv1.2\"] }
}" --query 'VpcOrigin.Id' --output text
```

Once its status is `Deployed`, which `aws cloudfront get-vpc-origin --id <the VPC origin ID> --query VpcOrigin.Status` shows, CloudFront has created a security group named `CloudFront-VPCOrigins-Service-SG` in the VPC. Let it, and nothing else, reach the load balancer:

```bash
CLOUDFRONT_SG=$(aws ec2 describe-security-groups \
  --filters Name=vpc-id,Values="$VPC" Name=group-name,Values=CloudFront-VPCOrigins-Service-SG \
  --query 'SecurityGroups[0].GroupId' --output text)
allow "$ALB_SG" 443 "$CLOUDFRONT_SG"
```

That group belongs to the VPC origins of your own account, which is why the load balancer is internal rather than on the internet. A load balancer on the internet would admit CloudFront's managed prefix list, `com.amazonaws.global.cloudfront.origin-facing`, which every CloudFront distribution connects from and not only yours: a caller who points a distribution of their own at it reaches the load balancer past the function below, with a `Forwarded` and an `X-Forwarded-Host` of their choosing.

### The headers

A CloudFront Function on every viewer request removes the trace context headers, `Forwarded`, and `X-Forwarded-Host` before anything else sees the request. `strip-request-headers.js`:

```js
function handler(event) {
  var headers = event.request.headers;
  delete headers.traceparent;
  delete headers.tracestate;
  delete headers.baggage;
  delete headers.forwarded;
  delete headers["x-forwarded-host"];
  return event.request;
}
```

```bash
aws cloudfront create-function --name publira-strip-request-headers \
  --function-config Comment=publira,Runtime=cloudfront-js-2.0 \
  --function-code fileb://strip-request-headers.js --query ETag --output text
aws cloudfront publish-function --name publira-strip-request-headers --if-match <the ETag above>
```

`traceparent`, `tracestate`, and `baggage` are removed as [Trace context](./4-edge.md#trace-context) requires. CloudFront and the load balancer pass on a `Forwarded` and an `X-Forwarded-Host` the caller sent, and Publira would read both, as [The client address](./4-edge.md#the-client-address) and [The host the request was sent to](./4-edge.md#the-host-the-request-was-sent-to) describe; neither of them writes either header itself, so removing them here leaves the web apps reading the `Host` the browser sent, and `PUBLIRA_FORWARDED_HEADER_ENABLED` at its default on every process.

### The cache policies

Every path but `/images` is forwarded uncached, with every header, cookie, and query string the browser sent: the managed cache policy `Managed-CachingDisabled` and the managed origin request policy `Managed-AllViewer`. The pages depend on the reader's session cookie, and the web apps keep a cache of their own in Valkey, which the revalidation from the server and the worker keeps current; a copy in CloudFront would be one that revalidation never reaches. `Managed-AllViewer` forwards the `Host` header, which picks the tenant, and the `Authorization` header the mobile app signs its requests with.

`/images` is worth caching. `publira server` marks an image a reader may be shown without signing in as `public` for up to an hour, and one that needs a reader's credential as `private`, which CloudFront does not store. It picks the format from the `Accept` header, and the tenant from the host, and takes a reader's credential from `Authorization` or from the query string, so each of those belongs in the key a cached copy is found by:

```bash
aws cloudfront create-cache-policy --cache-policy-config '{
  "Name": "publira-images",
  "MinTTL": 0,
  "DefaultTTL": 0,
  "MaxTTL": 86400,
  "ParametersInCacheKeyAndForwardedToOrigin": {
    "EnableAcceptEncodingGzip": false,
    "EnableAcceptEncodingBrotli": false,
    "HeadersConfig": {
      "HeaderBehavior": "whitelist",
      "Headers": { "Quantity": 3, "Items": ["Host", "Accept", "Authorization"] }
    },
    "CookiesConfig": { "CookieBehavior": "none" },
    "QueryStringsConfig": { "QueryStringBehavior": "all" }
  }
}' --query 'CachePolicy.Id' --output text
```

`MinTTL` is `0` so CloudFront follows the `Cache-Control` of every answer, `private` and `no-store` included, and `DefaultTTL` is `0` so an answer without one is not stored.

### The distribution

One distribution serves one tenant: its domain and its console host, with the certificate that names both. A distribution holds one certificate, and a tenant's certificate is its own, so the next tenant gets a distribution of its own, as [Adding a tenant](#adding-a-tenant) describes. `distribution.json`:

```json
{
  "CallerReference": "publira-comics-example-com",
  "Comment": "comics.example.com",
  "Enabled": true,
  "HttpVersion": "http2and3",
  "IsIPV6Enabled": true,
  "Aliases": {
    "Quantity": 2,
    "Items": ["comics.example.com", "admin.comics.example.com"]
  },
  "ViewerCertificate": {
    "ACMCertificateArn": "<the certificate ARN in us-east-1>",
    "SSLSupportMethod": "sni-only",
    "MinimumProtocolVersion": "TLSv1.2_2021"
  },
  "Origins": {
    "Quantity": 1,
    "Items": [
      {
        "Id": "publira",
        "DomainName": "<the load balancer's DNS name>",
        "VpcOriginConfig": {
          "VpcOriginId": "<the VPC origin ID>",
          "OriginReadTimeout": 120,
          "OriginKeepaliveTimeout": 5
        }
      }
    ]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "publira",
    "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": {
      "Quantity": 7,
      "Items": ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"],
      "CachedMethods": { "Quantity": 2, "Items": ["GET", "HEAD"] }
    },
    "Compress": true,
    "CachePolicyId": "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
    "OriginRequestPolicyId": "216adef6-5c7f-47e4-b989-5492eafa07d3",
    "FunctionAssociations": {
      "Quantity": 1,
      "Items": [
        {
          "EventType": "viewer-request",
          "FunctionARN": "arn:aws:cloudfront::<account>:function/publira-strip-request-headers"
        }
      ]
    }
  },
  "CacheBehaviors": {
    "Quantity": 1,
    "Items": [
      {
        "PathPattern": "/images*",
        "TargetOriginId": "publira",
        "ViewerProtocolPolicy": "redirect-to-https",
        "AllowedMethods": {
          "Quantity": 2,
          "Items": ["GET", "HEAD"],
          "CachedMethods": { "Quantity": 2, "Items": ["GET", "HEAD"] }
        },
        "Compress": false,
        "CachePolicyId": "<the publira-images cache policy ID>",
        "OriginRequestPolicyId": "216adef6-5c7f-47e4-b989-5492eafa07d3",
        "FunctionAssociations": {
          "Quantity": 1,
          "Items": [
            {
              "EventType": "viewer-request",
              "FunctionARN": "arn:aws:cloudfront::<account>:function/publira-strip-request-headers"
            }
          ]
        }
      }
    ]
  }
}
```

```bash
aws cloudfront create-distribution --distribution-config file://distribution.json \
  --query 'Distribution.[Id,DomainName]' --output text
```

- **The IDs.** `4135ea2d-…` is `Managed-CachingDisabled`, and `216adef6-…` is `Managed-AllViewer`. `aws elbv2 describe-load-balancers --load-balancer-arns "$ALB" --query 'LoadBalancers[0].DNSName'` prints the load balancer's DNS name.
- **The methods.** The default behaviour admits every method, since the pages post forms and the API is called with `POST`; `/images` answers reads alone.
- **The upload timeout.** CloudFront sets no limit on a body that matters here, so the uploads and webhooks pass it as they are. `OriginReadTimeout` is how long CloudFront waits for the load balancer to answer, 30 seconds unless set; 120 is the most it takes without raising the quota, and leaves the console time to store a whole episode's pages once they have arrived.
- **The function** is associated with both behaviours: a behaviour that names none forwards the caller's headers untouched.

Once the distribution is deployed, point both host names at its domain name, `d111111abcdef8.cloudfront.net` or the like: a `CNAME` record for each, or an alias record if the zone is in Route 53.

### The client address

Publira records the address of the reader behind every request, and reads it from the `X-Forwarded-For` header the edge writes, as [The client address](./4-edge.md#the-client-address) describes. CloudFront puts the reader's address there, appending it to whatever the caller wrote, and the load balancer appends the address CloudFront connected from. A web app that calls the API for a reader appends the load balancer's address in turn. `publira server` walks those addresses from the right and steps over each one it trusts, so `PUBLIRA_TRUSTED_PROXIES` has to cover every hop after the reader:

- **The VPC's range**, which the load balancer and the web apps connect from.
- **CloudFront's origin-facing ranges**, which AWS publishes under the service `CLOUDFRONT_ORIGIN_FACING`, for the address CloudFront reaches the load balancer from.

```bash
TRUSTED_PROXIES="$VPC_CIDR,$(curl -s https://ip-ranges.amazonaws.com/ip-ranges.json \
  | jq -r '[.prefixes[] | select(.service == "CLOUDFRONT_ORIGIN_FACING") | .ip_prefix] | join(",")')"
echo "$TRUSTED_PROXIES"
```

Write that value in place of `<see The client address>` in `publira-server.json`, register the task definition again, and deploy the service with it:

```bash
aws ecs register-task-definition --cli-input-json file://publira-server.json > /dev/null
aws ecs update-service --cluster publira --service publira-server --task-definition publira-server > /dev/null
```

AWS changes those ranges from time to time, and announces each change on the `AmazonIpSpaceChanged` SNS topic. Until you update the variable, a request that arrived through a new range is recorded with CloudFront's address rather than the reader's: every reader behind that range shares an address, but none of them can choose it. Trust no wider range than these: a trusted range that reaches readers lets any of them name an address of their choosing.

### Check the edge

Once the DNS records answer, check the routing from outside the VPC:

```bash
curl -sI https://comics.example.com/ | head -1
curl -s https://comics.example.com/readyz
curl -s -X POST -H 'Content-Type: application/json' -d '{}' \
  https://comics.example.com/rpc/publira.v1.TenantService/GetTenant
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{}' \
  https://comics.example.com/rpc/publira.admin.v1.AdminAuditLogService/ListAuditLogs
curl -sI http://comics.example.com/ | grep -i '^location'
```

The first answers `200` from `web-storefront`, and the second with its readiness, `"status":"ok"` once it reaches `publira server` and Valkey. The third reaches `publira server`, which refuses the empty request with `invalid_argument`. The fourth calls the tenant console's API, and the load balancer answers it with `404` without forwarding it. The last answers with CloudFront's redirect to `https://comics.example.com/`. Run the same on the console host, where the console's API answers `404` as well: the console calls it over the VPC, not through the edge.

## 9. Sign in

Open the tenant console at `https://admin.comics.example.com`, or the console host you gave `--admin-domain`, and sign in with the administrator's email address and password. From here on the install is the one [Sign in](./2-installing.md#6-sign-in) describes.

## Adding a tenant

A tenant created with `publiractl tenant create` or in the Platform Console needs its two host names on the edge, as [Adding a tenant](./4-edge.md#adding-a-tenant) describes. On ECS that is, before its staff open the console:

1. **Certificates.** Request a certificate naming its domain and its console host in the load balancer's Region and in `us-east-1`, as in [Create the load balancer](#5-create-the-load-balancer), and validate both.
2. **The load balancer.** Add the first certificate to the listener with `aws elbv2 add-listener-certificates --listener-arn "$LISTENER" --certificates CertificateArn=<its ARN>`, and four rules: its domain and its console host each in the `2000` band with the `/api/v1` paths, and each in the `4000` band alone, as in the table there. A load balancer takes 25 certificates besides its listener's default one, and 100 rules, unless you raise those quotas; a rule's host condition takes up to three names, so up to three tenants can share each rule.
3. **CloudFront.** Create a distribution of its own from `distribution.json`, with its two names in `Aliases`, its `us-east-1` certificate in `ViewerCertificate`, and a `CallerReference` of its own. The VPC origin, the function, and the cache policy are the ones the first distribution uses.
4. **DNS.** Point both names at the new distribution's domain name.

Nothing else changes: the services, the parameters, and the security groups serve every tenant alike.

## Keeping the consoles' credentials off the tenants' domains

The load balancer already keeps the consoles' APIs off the internet, but the `publira-server` it forwards the tenants' domains to still serves them, and holds their database logins and the web service token to do so. To take all three out of the process readers reach, a layer apart from the edge rule as [Only the public API goes through the edge](./4-edge.md#only-the-public-api-goes-through-the-edge) describes, run a second service with `--role storefront`, and route the tenants' domains to it.

Its task definition is `publira-server.json` with the family and the container named `publira-storefront`, `["server", "--role", "storefront"]` as its command, and only the secrets that role reads: the encryption keys, `PUBLIRA_AUTH_JWT_SECRET`, `PUBLIRA_REVALIDATE_TOKEN`, `PUBLIRA_REDIS_URL`, and `PUBLIRA_PUBLIC_DB_URL`. Give it a target group of its own, `publira-storefront` on port `8000`, and create its service with the `publira-server` security group and no Cloud Map name, since nothing but the load balancer calls it.

Then add rules ahead of the server's, which send the tenants' domains to it:

| Priority | Host | Path | Forwards to |
| --- | --- | --- | --- |
| `900` to `999` | A tenant's domain | `/images*`, `/rpc/publira.v1.*`, `/api/publira.v1.*` | `publira-storefront` |

The console hosts and the web apps keep reaching `publira-server`, which serves every role: `web-admin` calls the public API as well as the console's, through its one `PUBLIRA_GRPC_URL`. The three paths leave room for two host names among the five values a rule takes, so a rule in this band serves the domains of two tenants at most: add a new tenant's domain to a rule that names one, or give it a rule of its own at the next free priority in the band.

The load balancer answers a console API with `404` on every host either way, so check that the tenants' domains reach the new service instead: `aws elbv2 describe-target-health --target-group-arn <the publira-storefront target group ARN>` lists its tasks as `healthy`, and the public API call in [Check the edge](#check-the-edge) still answers `invalid_argument` on the tenant's domain, now from `publira-storefront`.

## Upgrading

[Upgrading](./7-upgrading.md) brings an install to a new release: a backup, the migrations and the roles with the new release's `publiractl`, and then the processes. Read it, and its release notes, first. On ECS its steps become:

Every step below acts on every service the install runs. List them once, adding `web-platform`, `email-renderer`, and `publira-storefront` if you run them:

```bash
SERVICES="publira-server publira-worker web-storefront web-admin"
```

1. **Stop the services** when you decided to stop them first, which [Decide whether to stop the processes first](./7-upgrading.md#decide-whether-to-stop-the-processes-first) weighs, by setting every one of them to no tasks, after noting how many each one ran:

   ```bash
   declare -A COUNT
   for name in $SERVICES; do
     COUNT[$name]=$(aws ecs describe-services --cluster publira --services "$name" \
       --query 'services[0].desiredCount' --output text)
     aws ecs update-service --cluster publira --service "$name" --desired-count 0 > /dev/null
   done
   aws ecs wait services-stable --cluster publira --services $SERVICES
   ```

2. **Back up the database** with a snapshot of the RDS instance or the Aurora cluster, or with `pg_dump` from a host that reaches it, as [Back up the database](./7-upgrading.md#1-back-up-the-database) describes.
3. **Apply the migrations and the roles**: change `<tag>` in `publiractl-db-migrate.json` and `publiractl-db-roles.json` to the new release, register both, and run them in that order with `run_publiractl`, going on only when each succeeds. The roles task gives each role the password its parameter holds, which is the one it already has, so it runs unchanged. A release that adds a role needs a parameter for that role's password, a `secrets` entry setting it as a variable, and the flag that names the variable.
4. **Start the new release**: change `<tag>` in every service's task definition, add the variables the release notes name, register them, and update each service to its new revision, and, if you stopped it in step 1, to the number of tasks it ran before, which that step noted in `COUNT`:

   ```bash
   for name in $SERVICES; do
     aws ecs register-task-definition --cli-input-json "file://$name.json" > /dev/null
     aws ecs update-service --cluster publira --service "$name" --task-definition "$name" \
       ${COUNT[$name]:+--desired-count ${COUNT[$name]}} > /dev/null
   done
   aws ecs wait services-stable --cluster publira --services $SERVICES
   ```

5. **Check the install**, as [Check the install](./7-upgrading.md#5-check-the-install) describes.

When the services keep running through the upgrade instead, update every service at once after the roles task: ECS replaces the tasks of a service a few at a time, so the two releases serve side by side until the last old task stops, and the shorter that is the better, as the same page explains.

## Next steps

[Edge](./4-edge.md) is the full statement of what CloudFront and the load balancer have to do together, and [Monitoring](../3-operations/11-monitoring.md) of what to watch once the install is serving. The variables each process reads are in the [deployment reference](https://github.com/publira/publira/blob/main/infra/deploy/README.md), and the optional processes are turned on as [Turning on the optional processes](./2-installing.md#turning-on-the-optional-processes) describes, each as a service like the ones above: `web-platform` with a target group, rules for its host, a Cloud Map name, and port `4100` opened in `publira-web`, and `email-renderer` with a Cloud Map name alone and a security group that admits port `8080` from `publira-worker`.
