---
title: 모니터링
description: /livez와 /readyz로 모든 프로세스를 확인하는 방법, 알림을 걸 만한 로그 줄과 메트릭, OpenTelemetry 메트릭과 트레이스를 켜는 방법을 설명합니다.
published: 2026-11-03
source_updated: 2026-11-01
---

설치 환경은 네 가지 방법으로 상태를 알려 줍니다. 모든 프로세스가 활성 상태 확인과 준비 상태 확인에 응답하고, `publira server`와 `publira worker`는 구조화된 로그를 쓰며, 같은 두 프로세스는 켜면 OpenTelemetry 메트릭을 내보내고, `email-renderer`를 제외한 모든 프로세스는 OpenTelemetry 트레이스를 내보낼 수 있습니다. 이 페이지에서는 각각이 무엇을 보고하는지, 오케스트레이터와 알림 시스템에 어떻게 연결하는지, 무엇에 알림을 걸 만한지 설명합니다. 이를 받는 모니터링 시스템은 직접 선택하며, 이 페이지는 설치 환경이 보내는 것만 다룹니다.

변수는 [`publira server`와 `publira worker` 레퍼런스](https://github.com/publira/publira/blob/main/server/cmd/publira/README.md), [서버의 트레이싱과 메트릭 레퍼런스](https://github.com/publira/publira/blob/main/server/README.md#distributed-tracing-opentelemetry), [웹 앱의 트레이싱 레퍼런스](https://github.com/publira/publira/blob/main/packages/tracing/README.md)에 자세히 설명되어 있으며, 이 페이지에서는 반복하지 않고 링크만 겁니다.

## 헬스 체크

모든 프로세스는 일반 HTTP로 두 가지 요청에 응답합니다.

- **`GET /livez`** 요청은 프로세스가 응답할 수만 있으면 언제나 `ok`라는 텍스트와 함께 `200`으로 응답합니다. 그 밖에는 아무것도 확인하지 않으므로, 프로세스가 멈추거나 정지했을 때만 실패합니다.
- **`GET /readyz`** 요청은 프로세스가 의존하는 것을 확인해, 모든 확인 항목이 통과하면 `200`으로, 하나라도 실패하면 `503`으로 응답합니다. 본문에는 각 확인 항목이 표시됩니다.

| 프로세스 | 포트 | `/readyz`가 확인하는 것 |
| --- | --- | --- |
| `publira server` | `8000`(`PUBLIRA_PUBLIC_API_ADDR`) | 세 가지 데이터베이스 로그인 각각(`db.public`, `db.admin`, `db.platform`, 또는 `--role`로 지정한 역할의 로그인)과, [읽기 전용 레플리카](../2-deployments/7-scaling-out.md#레플리카에서-읽기)가 지정된 경우 `db.public.replica` |
| `publira worker` | `8003`(`PUBLIRA_WORKER_ADDR`) | 세 가지 데이터베이스 로그인 각각(`db.outbox`, `db.ticker`, `db.content_stats`, 또는 `--queue`로 지정한 큐의 로그인)과, `maintenance` 큐를 맡고 [읽기 전용 레플리카](../2-deployments/7-scaling-out.md#일일-재구축)가 지정된 경우 `db.content_stats.replica`. 또한 작업 큐가 시작될 때까지 준비되지 않은 것으로 응답합니다 |
| `web-storefront`, `web-admin`, `web-platform` | `PORT`: 저장소가 빌드하는 이미지에서는 `3000`, `4000`, `4100` | `api`: `PUBLIRA_GRPC_URL`이 지정하는 호스트에 있는 `publira server`의 `/readyz`. `PUBLIRA_PUBLIC_GRPC_URL`이 설정된 `web-admin`에서는 `public-api`: 그 변수가 지정하는 호스트에서 같은 확인. 그리고 `redis`: `PNCH_REDIS_URL`의 공유 캐시에 대한 ping이며, 그 캐시가 꺼져 있는 동안에는 항상 통과합니다 |
| `email-renderer` | `8080`(`PORT`) | 없음. 다른 서비스에 의존하지 않으므로 실행 중이면 언제나 준비된 상태입니다 |

`publira server --with-worker` 프로세스는 처음 두 행의 두 포트 모두에서 각 행의 확인 항목으로 응답하므로, 두 프로세스를 확인하듯이 확인하세요.

어느 프로세스도 오브젝트 스토어, SMTP 서버, 검색 엔진은 확인하지 않습니다. 그쪽의 장애는 `/readyz`가 아니라 로그와 독자가 보는 화면에 나타납니다.

정상적인 응답은 다음과 같습니다.

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

`status`는 모든 확인 항목이 통과하면 `ok`, 하나라도 실패하면 `unavailable`, 워커의 작업 큐가 아직 시작되지 않은 동안에는 `starting`입니다. 실패한 확인 항목에는 어떤 종류의 실패였는지(`timeout`, `dependency_failed`, `not configured`)만 알려 주는 `error`가 붙으며, 호스트 이름이나 연결 문자열은 절대 포함되지 않으므로 응답을 누구에게 보여 주어도 안전합니다. 이유 자체는 확인 항목 이름이 들어간 `readiness check failed` 줄로 프로세스의 로그에 기록됩니다.

각 확인 항목에는 2초가 주어집니다. `publira server`와 `publira worker`는 확인 항목을 하나씩 차례로 실행하므로, 모든 로그인이 응답하지 않으면 응답에 약 6초가 걸립니다. 웹 앱은 확인 항목을 동시에 실행하므로 약 2초 안에 응답합니다.

### 오케스트레이터에서 프로브하기

모든 프로세스의 활성 프로브는 `/livez`로, 준비 프로브는 `/readyz`로 지정하세요. `/readyz`를 활성 프로브로 사용하지 마세요. 데이터베이스가 응답하지 않게 되면 오케스트레이터가 모든 프로세스를 한꺼번에 재시작하게 되는데, 그래도 데이터베이스는 돌아오지 않고 프로세스가 캐시에서 계속 제공할 수 있던 것까지 잃게 됩니다.

웹 앱의 `/readyz`는 `publira server`의 `/readyz`가 실패할 때마다 실패하므로, 데이터베이스 로그인 하나가 응답하지 않게 되면 `publira server`와 함께 모든 웹 앱이 준비되지 않은 상태가 됩니다. 이는 의도된 것입니다. 정상 동작하는 API에 접근할 수 없는 웹 앱은 캐시되지 않은 페이지를 제공할 수 없기 때문입니다. 하지만 준비 상태를 따르는 로드 밸런서는 모든 웹 앱에 한꺼번에 트래픽을 보내지 않게 됩니다. 로드 밸런서가 `/readyz`를 가리키게 하기 전에 그것이 원하는 동작인지 판단하세요.

`publira server`나 `publira worker`의 `/readyz` 프로브에는 6초보다 긴 타임아웃을 주어, 느린 확인 항목이 프로브 타임아웃이 아니라 그 항목이 가리키는 실패로 보고되게 하세요. Kubernetes에서 워커의 프로브는 다음과 같으며, 모든 프로세스의 프로브는 [Kubernetes](../2-deployments/5-kubernetes/index.md#4-프로세스-시작)에 있습니다.

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

ECS에서는 서비스가 헬스 체크에 실패한 태스크를 교체하므로, 서비스 태스크의 모든 헬스 체크가 활성 프로브로 동작합니다. [헬스 체크](../2-deployments/6-ecs-fargate/index.md#헬스-체크)에서는 이를 모두 `/livez`로 지정합니다.

[Docker Compose](../2-deployments/3-docker-compose.md) 설치 환경은 모든 Publira 프로세스에 `/readyz`를 사용하는 헬스 체크를 둡니다. 컨테이너 안에서 묻는데, 시작 후 처음 1분 동안은 2초마다 묻고 실패를 세지 않으며, 그 후에는 10초마다 묻고 세 번 연속 실패하면 프로세스를 `unhealthy`로 표시합니다. `server`는 두 포트 모두에서 확인합니다. `docker compose ps`는 각 서비스 옆에 결과를 표시하며, 웹 앱은 `server`와 Valkey가 정상이 된 후에, 프록시는 `server`, `web-storefront`, `web-admin`이 정상이 된 후에 시작됩니다. 이미지에는 자체 Docker `HEALTHCHECK`가 선언되어 있지 않습니다. 어느 이미지에도 `curl`이 없으므로, Compose 파일은 서버의 이미지에서는 `bash`를, 나머지에서는 `node`를 실행합니다.

이 결과로 프로세스를 재시작하는 것은 없습니다. Compose는 종료된 프로세스를 재시작할 뿐, 멈추거나 비정상이 된 프로세스는 재시작하지 않으며, 결과는 그 프로세스를 기다리는 서비스를 대기시키는 데만 사용합니다. 그런 일이 생겼을 때 알림을 받으려면, 컨테이너의 네트워크에 접근할 수 있는 모니터에서 설치 환경을 외부로부터 확인하거나 `docker compose ps`를 지켜보세요. 테넌트 사이트의 `/livez`와 `/readyz`는 `https://comics.example.com/readyz`처럼 모든 테넌트의 도메인에서 리버스 프록시를 통해서도 접근할 수 있으므로, 인터넷 상의 가동 시간 모니터가 사용할 수 있습니다. API와 워커의 것은 그렇지 않습니다. 프록시는 `/rpc`와 `/images`만 `publira server`로 전달하기 때문입니다.

## 로그

`publira server`, `publira worker`, `publiractl`은 로그를 표준 출력에 한 줄에 레코드 하나씩, 기본적으로 `key=value` 쌍으로 씁니다.

```text
time=2026-10-07T09:41:03.402Z level=ERROR msg="outbox event dead" event_id=0199b5f0-1c2e-7c41-9a8e-3f5d2a6b7c80 event_type=contact_message_reply_email idempotency_key=… attempts=10 trace_id=4bf92f3577b34da6a3ce929d0e0e4736 span_id=00f067aa0ba902b7 error="dial tcp: connection refused"
```

`PUBLIRA_LOG_FORMAT=json`을 설정하면 각 레코드가 같은 키를 가진 JSON 객체 하나가 되므로, 로그 수집기가 별도의 파싱 규칙 없이 읽을 수 있습니다.

```jsonl
{"time":"2026-10-07T09:41:03.402Z","level":"ERROR","msg":"outbox event dead","event_id":"0199b5f0-1c2e-7c41-9a8e-3f5d2a6b7c80","event_type":"contact_message_reply_email","idempotency_key":"…","attempts":10,"trace_id":"4bf92f3577b34da6a3ce929d0e0e4736","span_id":"00f067aa0ba902b7","error":"dial tcp: connection refused"}
```

모든 레코드에는 `time`, `level`(`DEBUG`, `INFO`, `WARN`, `ERROR`), `msg`가 있습니다. 트레이스되고 있는 요청이나 작업을 처리하는 중에 기록된 레코드에는 `trace_id`와 `span_id`도 있으며, 이를 따라가면 트레이싱 백엔드에서 그 트레이스를 찾을 수 있습니다. 나머지는 무엇이 기록했는지에 따라 다릅니다. 아웃박스의 레코드는 항목을(`event_id`, `event_type`, `attempts`), 유지 관리 작업의 레코드는 실행을(`job_kind`, `job_id`, `attempt`) 나타내며, 실패에는 `error`가 붙습니다.

`PUBLIRA_LOG_LEVEL`은 기록할 가장 낮은 수준을 정하며, `debug`, `info`(기본값), `warn`, `error` 중 하나입니다. `warn`으로 하면 바쁜 설치 환경의 일상적인 `INFO` 레코드는 빠지고 모든 문제는 남습니다. 감사 로그의 `audit` 레코드와 모든 로그인 시도의 `audit auth` 레코드는 수준과 관계없이 `INFO`로 기록됩니다. 프로세스의 상태가 아니라 누가 무엇을 했는지 기록하는 것이기 때문입니다. 두 변수 중 어느 쪽이든 알 수 없는 값이면 프로세스는 시작할 때 그 변수 이름을 담은 메시지와 함께 멈춥니다.

웹 앱과 `email-renderer`는 그 대신 Next.js와 Node.js 자체의 일반 텍스트 출력을 씁니다. 실패는 `[web-storefront] getTenantSiteInfo failed`처럼 앱 이름이 앞에 붙은 줄이며, 실패한 준비 상태 확인은 `health check api failed`로 기록됩니다.

### 알림을 걸 대상

`publira server`와 `publira worker`의 모든 `ERROR` 레코드에 알림을 거는 것이 무난한 출발점입니다. API가 응답하지 못한 요청은 그 원인이 된 오류와 함께 이 수준으로 기록됩니다. 다음 레코드는 각각 무언가를 잃었거나 멈춰 있다는 뜻이므로 따로 알림을 걸 만합니다.

| 레코드 | 프로세스 | 의미 |
| --- | --- | --- |
| `outbox event dead` | `publira worker` | 메일, 푸시 알림, 캐시 재검증이 완전히 포기되었습니다. 어느 것인지는 `event_type`이 알려 주며, 그 영향은 [아웃박스](./10-scheduled-jobs.md#포기된-항목-확인)에서 설명합니다 |
| `outbox event retry scheduled`의 반복 | `publira worker` | 항목을 보내는 대상(SMTP 서버, `email-renderer`, 웹 앱)이 실패하고 있습니다. 항목은 dead가 되기 전까지 약 9분 동안 다시 시도됩니다 |
| `episode publish failed after all retries` | `publira worker` | 예약된 에피소드가 **예약됨** 상태로 남았습니다. [예약 공개](./10-scheduled-jobs.md#예약-공개)에서 설명하듯이 테넌트의 관리자와 모든 운영자에게도 알림이 갑니다 |
| `auditlog: queue is full; dropping entry`, `auditlog: failed to persist; dropping entry` | `publira server` | 테넌트나 플랫폼의 감사 로그 항목을 잃었습니다 |
| `readiness check failed` | `publira server`, `publira worker` | 이름이 표시된 확인 항목이 실패했습니다. 이유는 `error` 필드에 있습니다 |
| `opentelemetry error` | `publira server`, `publira worker` | 메트릭이나 트레이스를 내보내지 못했습니다. 대개 수집기에 접근할 수 없기 때문입니다 |
| `failed to initialize …` | `publira server`, `publira worker` | 프로세스가 시작하지 못하고 종료되었습니다. 오케스트레이터가 재시작하지만, 원인이 해결될 때까지 같은 줄이 다시 나타납니다 |

워커의 예약 작업이 로그와 `river_job` 테이블에 실패를 기록하는 방식은 [작업의 실패가 기록되는 곳](./10-scheduled-jobs.md#작업의-실패가-기록되는-곳)에 있습니다.

## 메트릭

`publira server`와 `publira worker`는 `PUBLIRA_METRICS_ENABLED=true`를 설정하면 OpenTelemetry 메트릭을 내보냅니다. 설정하지 않으면 아무것도 내보내지 않습니다. 웹 앱과 `email-renderer`는 메트릭을 내보내지 않습니다.

내보내는 방식은 `OTEL_METRICS_EXPORTER`로 정합니다.

- **`otlp`**(기본값) 방식은 60초마다 트레이스와 같은 수집기 주소인 `OTEL_EXPORTER_OTLP_ENDPOINT`로 메트릭을 보냅니다.
- **`prometheus`** 방식은 Prometheus 스크레이퍼를 위해 포트 `9464`의 `/metrics`에서 메트릭을 제공합니다. `OTEL_EXPORTER_PROMETHEUS_HOST=0.0.0.0`도 설정하세요. 기본값인 `localhost`로는 컨테이너 밖에서 접근할 수 없습니다. 하나의 Kubernetes Pod처럼 `publira server`와 `publira worker`가 네트워크 네임스페이스를 공유한다면, 각각에 별도의 `OTEL_EXPORTER_PROMETHEUS_PORT`를 지정하세요.

[Docker Compose](../2-deployments/3-docker-compose.md) 설치 환경에서는 `.env`에 `PUBLIRA_METRICS_ENABLED`, `OTEL_METRICS_EXPORTER`, `OTEL_EXPORTER_PROMETHEUS_HOST`를 설정하면 `server`에 전달되며, 그 후 `docker compose up -d`를 다시 실행하세요. 그 밖의 변수와 기록되는 항목의 전체 목록은 [메트릭 레퍼런스](https://github.com/publira/publira/blob/main/server/README.md#metrics-opentelemetry)에 있습니다. 각 프로세스는 `service.name` 하나로 보고합니다. `publira server`는 `publira-api-server`, `publira worker`는 `publira-worker`입니다. Compose 파일의 `server`인 `publira server --with-worker` 프로세스는 모든 것을 `publira-api-server`로 보고합니다.

### 아웃박스

워커의 메트릭은 [아웃박스](./10-scheduled-jobs.md#아웃박스-메일-푸시-캐시-재검증)에서 설명하는, 모든 메일, 푸시 알림, 캐시 재검증이 거쳐 가는 아웃박스를 추적합니다. 각 메트릭에는 항목의 종류가 `outbox.event_type`으로 붙습니다.

| 메트릭 | 세는 것 | 지켜볼 것 |
| --- | --- | --- |
| `publira.outbox.events.dead` | 완전히 포기된 항목 | 조금이라도 늘어나는 것. 알림을 거세요 |
| `publira.outbox.events.retry` | 다시 시도될 실패한 시도 | 계속 높은 비율. 그 `outbox.event_type`의 대상이 실패하고 있습니다 |
| `publira.outbox.events.claimed` | 워커가 보내려고 항목을 가져간 횟수. 다시 시도되거나 재개된 항목은 다시 가져가며 다시 세므로, 모든 항목이 보내지더라도 `done`보다 빠르게 늘어납니다 | — |
| `publira.outbox.events.done` | 보낸 항목 | — |
| `publira.outbox.events.resumed` | 많은 독자에게 보내는 푸시 알림처럼, 작업의 일부를 보낸 후 나중에 이어서 하도록 되돌려 놓은 항목 | — |
| `publira.outbox.handler.duration` | 시도 한 번에 걸린 시간(초) | 증가. SMTP 서버, `email-renderer`, 웹 앱이 느려지고 있습니다 |

카운터는 워커가 한 일을 말해 줄 뿐, 아직 기다리고 있는 것은 말해 주지 않습니다. 보내기를 멈춘 워커는 아무것도 보고하지 않으며, 그 `/readyz`도 알아차리지 못합니다. `/readyz`는 데이터베이스 로그인을 확인할 뿐, 항목이 처리되고 있는지는 확인하지 않기 때문입니다. 무엇이 기다리고 있는지 보려면, 데이터베이스의 [관리용 로그인](../2-deployments/2-installing.md#서비스-준비)으로 연결한 `psql`로 실행 시각이 되었는데 보내지 않은 항목과, 가져갔는데 끝나지 않은 항목을 세세요.

```sql
SELECT status, count(*), min(updated_at)
FROM outbox_events
WHERE (status = 'pending' AND available_at < now() - interval '5 minutes')
   OR (status = 'processing' AND updated_at < now() - interval '15 minutes')
GROUP BY status;
```

정상적인 워커는 항목의 실행 시각이 되면 몇 초 안에 보내고, 처리하던 항목은 15분 후에 다시 대기 상태로 되돌리므로, 이 쿼리가 행을 하나라도 반환하면 워커가 항목을 처리하지 못하고 있다는 뜻입니다.

### 감사 로그

`publira server`는 테넌트 콘솔과 플랫폼 콘솔의 감사 로그를 큐를 통해 기록하므로, 요청이 그 항목을 기다리지 않습니다. `publira.auditlog.queue.depth`는 기다리는 항목 수이고, `publira.auditlog.entries.dropped`는 잃은 항목을 `auditlog.drop_reason`별로 셉니다. 항목을 하나라도 잃거나 큐 깊이가 계속 늘어나면 알림을 거세요. 데이터베이스가 따라가지 못하고 있다는 뜻입니다. 감사 로그의 나머지 메트릭은 [레퍼런스](https://github.com/publira/publira/blob/main/server/README.md#operational-monitoring-for-the-asynchronous-audit-log)에 있습니다.

## 트레이싱

`email-renderer`를 제외한 모든 프로세스는 `PUBLIRA_TRACING_ENABLED=true`를 설정하면 OpenTelemetry 트레이스를 내보냅니다. `publira server`, `publira worker`, 웹 앱에서 함께 켜세요. 그러면 페이지 요청 하나가 웹 앱에서 API를 거쳐 그 요청이 실행한 데이터베이스 쿼리까지 하나의 트레이스가 됩니다.

OpenTelemetry SDK가 직접 읽는 변수로 수집기를 지정하세요.

| 변수 | 설정할 값 |
| --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4318` 같은 수집기 |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf`. `publira server`와 `publira worker`는 `grpc`도 받지만 웹 앱은 받지 않으므로, 모든 프로세스에서 동작하는 값은 `http/protobuf`입니다 |
| `PUBLIRA_DEPLOYMENT_ENVIRONMENT` | `production` 또는 환경의 이름. 모든 스팬에 기록되며, 아래의 샘플링을 결정합니다 |

[Docker Compose](../2-deployments/3-docker-compose.md) 설치 환경에서는 이 변수들과 `PUBLIRA_TRACING_ENABLED`를 `.env`에 설정하면 워커도 실행하는 `server`와 웹 앱에 전달되며, 그 후 `docker compose up -d`를 다시 실행하세요.

각 프로세스는 자체 `service.name`으로 보고합니다. `publira server`가 제공하는 세 API는 `publira-api-server`, `publira-admin-api-server`, `publira-platform-api-server`, 그 이미지 전달은 `publira-image-server`, `publira worker`는 `publira-worker`와 예약 작업별 이름이며, `publira server --with-worker`가 둘을 한 프로세스에서 실행할 때도 모두 유지됩니다. 웹 앱은 `publira-web-storefront`, `publira-web-admin`, `publira-web-platform`입니다. 전체 목록과 각 스팬에 기록되는 내용은 [서버의 트레이싱 레퍼런스](https://github.com/publira/publira/blob/main/server/README.md#distributed-tracing-opentelemetry)에 있습니다. `publira server`의 헬스 체크는 트레이스되지 않으므로, 프로브 때문에 몇 초마다 백엔드에 트레이스가 쌓이지는 않습니다.

### 샘플링

`PUBLIRA_DEPLOYMENT_ENVIRONMENT`가 설정되지 않으면 모든 프로세스는 자신을 `development`로 간주해 모든 트레이스를 기록합니다. 그 밖의 값이면 열 개 중 하나를 기록합니다. 결정은 트레이스가 시작되는 곳에서 한 번만 내려지며, 요청이 이어서 도달하는 모든 프로세스가 그 결정을 따르므로, 트레이스는 전체가 기록되거나 전혀 기록되지 않습니다. 모든 프로세스에 같은 값을 설정하세요.

다른 비율로 샘플링하려면 SDK 자체의 `OTEL_TRACES_SAMPLER`와 `OTEL_TRACES_SAMPLER_ARG`를 `parentbased_traceidratio`와 `0.25`처럼 설정하세요. 이 변수들은 설정된 모든 프로세스에서 기본값을 대체합니다.

### 엣지가 트레이스 헤더를 제거하는 이유

모든 프로세스는 요청에 담겨 온 트레이스 컨텍스트를 신뢰합니다. `traceparent` 헤더가 있으면 그 스팬은 호출한 쪽의 트레이스에 속하게 되고, 호출한 쪽의 샘플링 결정도 함께 전달됩니다. 웹 앱의 스팬과 API의 스팬이 이어지는 것은 이 덕분입니다. 하지만 브라우저나 모바일 앱도 같은 헤더를 보낼 수 있으며, 그러면 자기 스팬을 다른 사람의 트레이스에 붙이거나, 모든 요청을 샘플링 대상으로 표시해 열 개 중 하나라는 비율을 넘어 요청마다 트레이스를 내보내게 할 수 있습니다.

그래서 설치 환경 앞의 엣지는 [트레이스 컨텍스트](../2-deployments/4-edge/index.md#트레이스-컨텍스트)가 모든 엣지에 요구하듯이, 전달하는 모든 요청에서 `traceparent`, `tracestate`, `baggage`를 제거하며, 외부에서 온 모든 요청은 새 트레이스를 시작합니다. 웹 앱은 API를, API와 워커는 웹 앱을 엣지를 거치지 않고 사설 네트워크에서 직접 호출하므로, 그 트레이스 컨텍스트는 유지됩니다.
