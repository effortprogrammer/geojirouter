# geojirouter

무료 조건을 사용자가 확인한 모델만 연결하는 로컬 OpenAI 호환 게이트웨이입니다.

- upstream API 키는 로컬 암호화 저장소에 보관합니다.
- 유료 모델이나 유료 fallback으로 전환하지 않습니다.
- 서버는 `127.0.0.1`에만 바인딩합니다.

## 설치

```sh
curl -fsSL https://raw.githubusercontent.com/effortprogrammer/geojirouter/main/install.sh | bash
```

설치 후 `gateway`를 찾지 못하면 installer가 출력한 `PATH` 설정을 적용하세요.

## 사용

### Route 등록

제공처의 현재 무료 조건과 모델 약관을 확인한 뒤 route를 등록합니다.

```sh
export PROVIDER_API_KEY='your-key'
export GATEWAY_CONFIRM_FREE=1
export GATEWAY_CONFIRM_COMMERCIAL=1

gateway provider add \
  --provider PROVIDER_ID \
  --key-env PROVIDER_API_KEY \
  --model FREE_MODEL_ID \
  --alias MODEL_ALIAS \
  --free-model

unset PROVIDER_API_KEY
```

`PROVIDER_ID`, `FREE_MODEL_ID`, `MODEL_ALIAS`는 실제 값으로 바꿔야 합니다.
`--free-model`과 두 확인 변수 없이는 route를 등록할 수 없습니다.

### 서버 실행

```sh
gateway init --json
gateway doctor --json

export GATEWAY_TOKEN='local-client-token'
gateway serve --host 127.0.0.1 --port 18473
```

기본 API 주소는 `http://127.0.0.1:18473/v1`입니다.

### API 호출

사용 가능한 모델:

```sh
curl http://127.0.0.1:18473/v1/models \
  -H "Authorization: Bearer $GATEWAY_TOKEN"
```

Chat Completions:

```sh
curl http://127.0.0.1:18473/v1/chat/completions \
  -H "Authorization: Bearer $GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "model": "MODEL_ALIAS",
    "messages": [{"role": "user", "content": "Reply with OK"}],
    "max_tokens": 32
  }'
```

## CLI

| 명령 | 용도 |
|---|---|
| `gateway init --json` | 암호화 상태 저장소 초기화 |
| `gateway doctor --json` | route 자격과 만료 상태 점검 |
| `gateway status --json` | 저장된 route 상태 확인 |
| `gateway env --json` | 로컬 API 접속 설정 확인 |
| `gateway catalog --json` | 제공처 카탈로그 출력 |
| `gateway estimate --json` | 무료 제공량 추정 |
| `gateway serve --host 127.0.0.1 --port 18473` | 로컬 API 서버 실행 |

## 정책

- 확인된 무료 모델만 등록할 수 있습니다.
- 무료 한도가 소진되거나 route가 만료되면 `503`을 반환합니다.
- `GATEWAY_TOKEN` 없이는 서버를 시작하지 않습니다.
- API 키는 로그, `status`, `env` 출력에 포함하지 않습니다.
- 계정별·지역별 무료 조건과 모델 라이선스는 직접 확인해야 합니다.
- `GATEWAY_HOME`으로 기본 저장 위치 `~/.everyone-gateway`를 바꿀 수 있습니다.

## 개발

요구 사항: Bun `>=1.3.0`

```sh
pnpm install
bun run check
bun test
bun run build
./scripts/qa-http.sh
```

## License

MIT
