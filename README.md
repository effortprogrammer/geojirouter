# 거지라우터 / geojirouter

쉬었음 청년들을 위한 모두의 게이트웨이

거지라우터는 결제·충전 없이 사용할 수 있는 무료 모델 경로를 모아
로컬 OpenAI 호환 API로 제공하는 게이트웨이입니다.

## 현재 상태

- 51개 제공처를 2026-09-21 기준으로 기록했습니다.
- `SambaNova DeepSeek-V3.1`은 공식 문서상 결제수단을 연결하지 않은 Free Tier에서
  모델당 20 RPD, 200,000 TPD입니다.
- OpenRouter 실시간 모델 API는 확인 당시 446개 모델 중 `:free` 21개였지만 무료
  DeepSeek는 없었습니다.
- Cloudflare Workers AI는 Free 플랜에서 하루 10,000 Neurons를 제공하지만 frontier
  DeepSeek 모델은 유료 청구수단이 필요합니다.
- “무료 달러”와 “매일 갱신되는 쿼터”는 서로 합산하지 않습니다. 실제 제공처의 결제
  상태를 로컬 프로그램이 완전히 알 수 없으므로, 무료 보장은 사용자가 무료 전용 조건을
  직접 확인하고 활성화한 라우트에만 적용됩니다.

### 좁은 실측 범위

현재 실제 연결을 우선 확인하는 대상은 Codebuff, OpenRouter 무료 모델, NVIDIA NIM입니다.
Codebuff 자체는 무료 OpenAI 호환 upstream이 아니라 유료 코딩 에이전트 서비스이므로
Gateway route로 취급하지 않습니다. OpenRouter와 NVIDIA NIM은 사용자 계정과 API 키를
직접 확인한 뒤에만 등록하며, 계정·키가 없으면 유료 fallback 없이 차단합니다.
실제 키와 브라우저 증거는 저장소에 넣지 않습니다.

## 실행

```sh
pnpm install
bun run check
bun test
bun run build

bun src/cli.ts catalog --json
bun src/cli.ts estimate --json
bun src/cli.ts serve --host 127.0.0.1 --port 18473
```

기본 서버는 `127.0.0.1`에만 바인딩하고 `GATEWAY_TOKEN` bearer 토큰을 사용합니다.
기본적으로 upstream을 설정하지 않으므로 유료 호출이 일어날 수 없습니다.

## 새 사용자 첫 실행

패키지를 설치한 뒤 사용자별 암호화 저장소를 만들고 상태를 확인합니다.

```sh
gateway init --json
gateway doctor --json
gateway status --json
gateway env --json
```

기본 저장 위치는 `~/.everyone-gateway`이며 `GATEWAY_HOME`으로 바꿀 수 있습니다.
`doctor`는 저장된 credential, 로컬 무료 정책, 만료 상태를 구분하고 실제 제공처
호출은 하지 않습니다. `env`는 무료 정책을 통과한 저장 라우트의 alias만 출력하며
upstream 키는 출력하지 않습니다. 첫 실행에는 route가 없어 `model: null`,
`status: "not_configured"`가 정상입니다.

## SambaNova DeepSeek 활성화

사용자가 직접 가입·약관 확인·무료 계정 상태 확인을 끝낸 뒤에만 다음처럼 명시적으로
활성화합니다. 카드 연결 계정이나 무료 조건을 확인하지 않은 키는 넣지 마세요.

```sh
export SAMBANOVA_API_KEY='(터미널 히스토리에 남기지 않는 방식으로 설정)'
export GATEWAY_ENABLE_SAMBANOVA=1
export GATEWAY_CONFIRM_COMMERCIAL=1
export GATEWAY_CONFIRM_FREE=1
export GATEWAY_TOKEN='local-client-token'
bun src/cli.ts serve --host 127.0.0.1 --port 18473
```

라우터는 `deepseek`를 `DeepSeek-V3.1`로만 매핑하고, 하루 20회·200,000 토큰
예약을 보수적으로 선점합니다. 소진되면 `503 no_free_capacity`를 반환하며 다른 유료
모델로 바꾸지 않습니다.

키를 저장한 뒤에는 다음 실행에서 환경변수 없이도 저장된 라우트를 복구합니다.
저장 키는 로컬 0600 키 파일로 암호화되며 `status`는 키를 출력하지 않습니다.

```sh
gateway provider add --provider sambanova --key-env SAMBANOVA_API_KEY \
  --model DeepSeek-V3.1 --alias deepseek --free-model
unset SAMBANOVA_API_KEY
gateway status --json
GATEWAY_TOKEN='local-client-token' gateway serve --host 127.0.0.1 --port 18473
```

`--host`는 `127.0.0.1`만 허용하고, `GATEWAY_TOKEN`이 없으면 서버를 시작하지 않습니다.
현재 CLI가 자동으로 허용하는 generic OpenAI 호환 경로는 공식 모델 식별자가 확인된
SambaNova, OpenRouter `:free`, Gemini Free-tier 모델입니다. 먼저 제공처의 무료
모델·약관을 직접 확인한 뒤 자신의 키를 연결합니다.

```sh
export GATEWAY_CONFIRM_FREE=1
export GATEWAY_CONFIRM_COMMERCIAL=1
export OPENROUTER_API_KEY='...'
gateway provider add --provider openrouter --key-env OPENROUTER_API_KEY \
  --model openrouter/free --alias openrouter-free --free-model
unset OPENROUTER_API_KEY
```

Google AI Studio users can use the same flow only after confirming that the
selected account and model are on the Free tier:

```sh
export GEMINI_API_KEY='...'
gateway provider add --provider gemini --key-env GEMINI_API_KEY \
  --model gemini-2.5-flash --alias gemini --free-model
unset GEMINI_API_KEY
```

Requesty, Groq, Hugging Face, Cloudflare Workers AI, NVIDIA API Catalog는 카탈로그와
온보딩 후보로 관리하지만, 현재 모델별 무료·상업 조건을 로컬 정책이 확인할 수 없으므로
자동 route로 등록하지 않습니다. `--free-model`만 붙였다고 불명확한 모델을 허용하지
않습니다.

## Aside 보조 가입

```sh
bun src/cli.ts onboard --provider sambanova --browser aside --json
```

Aside가 소유한 탭에서 가입 페이지를 열고 스크린샷을 저장하지만, 로그인·CAPTCHA·약관
동의는 `needs_user_action`으로 반환합니다. 계정을 자동 생성하거나 사용자의 동의 없이
약관을 통과했다고 주장하지 않습니다. API 키는 Aside 명령 인자나 로그로 전달하지
않습니다.

## 설계 출처

- SambaNova 무료 한도: <https://docs.sambanova.ai/docs/en/models/rate-limits>
- OpenRouter 무료 한도: <https://openrouter.ai/docs/api/reference/limits>
- OpenRouter 실시간 카탈로그: <https://openrouter.ai/api/v1/models>
- Cloudflare Workers AI 가격/무료 할당: <https://developers.cloudflare.com/workers-ai/platform/pricing/>
- Alibaba Model Studio 무료 쿼터: <https://www.alibabacloud.com/help/en/model-studio/new-free-quota>
- Vercel AI Gateway 무료 티어·모델 목록: <https://vercel.com/docs/ai-gateway/pricing>
  · <https://vercel.com/ai-gateway/models?freeTier=true>
- NVIDIA NIM API Trial / 무료 개발자 API: <https://build.nvidia.com/>
  · <https://forums.developer.nvidia.com/t/api-credits-for-build-nvidia-com/306633>
- OmniRoute MIT 프로젝트의 pool deduplication·ToS 분리 아이디어를 검토했지만, 제공처
  코드를 복사하지 않고 이 프로젝트의 출처·무료 보장 스키마에 맞춰 재구현했습니다:
  <https://github.com/diegosouzapw/OmniRoute>
- Freebuff는 하루 100 Freebucks와 모델별 시간표를 공개하지만 일반 공개 API 조건과
  상업 이용 권한이 확인되지 않아 자동 라우트에 포함하지 않았습니다:
  <https://freebuff.com/>

## 범위 밖

중복 계정 생성, CAPTCHA·SMS 우회, 유료 크레딧 자동 충전, 유료 fallback, API 키
재판매, 외부 배포·게시를 하지 않습니다. 제공처 약관과 모델 라이선스가 바뀌면
카탈로그를 다시 검증해야 합니다.
