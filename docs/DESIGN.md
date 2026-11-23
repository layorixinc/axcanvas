# axcanvas local HTTP 도구 계약

## 기획
로컬 또는 명시적으로 활성화한 신뢰하는 LAN의 웹 캔버스를 agent가 추가 설치 없이 조작한다. 한 대화마다 고정 sessionId를 사용하고 URL을 사용자에게 알린다. 로그인·MCP·WebMCP·전용 omp 확장은 필요 없다. 같은 세션 ID를 아는 네트워크 사용자는 읽기·수정 가능하다.

## 발견과 호출
- GET /agents.md: 실행 순서·curl/Node 예제·오류 복구·보안·도구 설명. 읽는 것 자체가 실행 권한을 부여하지 않는다.
- GET /openapi.json: 단일 POST의 도구별 request/response 변형을 레지스트리에서 생성.
- POST /api/agent/v1: requestId(필수), sessionId(세션 도구 필수), tool, arguments(object), actor(선택, agent/user 표시용).
- tools_list는 세션 없이 허용하고 각 도구의 설명·입출력 JSON Schema·readOnlyHint·idempotentHint를 반환한다. Zod 4의 native JSON Schema를 사용하며 입력의 default 필드는 선택적이고 출력의 default 필드는 필수인 계약을 구분한다.
- session_open, graph_read, graph_commit, graph_edit, graph_layout, graph_history, feedback_submit, feedback_read, feedback_ack. UI도 같은 POST 계약을 사용한다. graph_edit/layout/feedback_submit은 일반 클라이언트도 호출 가능하며 actor로 신원을 인증하지 않는다.
- GET /api/events?sessionId=...: 해당 세션 알림만 전송. GET /feedback/{id}.svg?sessionId=...: 제출 당시의 그래프·사용자 선을 서버가 안전한 SVG로 재구성한다.

## 세션·저장
- 외부에는 sessionId만 필요하고 내부 graphId는 기존 저장소 매핑으로 유지한다. 기존 SQLite 그래프/이력은 보존한다.
- session_open은 멱등 생성·재개이며 기존 title·내용을 덮어쓰지 않는다.
- 모든 성공한 변경 요청은 (sessionId,requestId)와 정규화한 tool/arguments/actor hash, 응답을 저장한다. 재전송은 원래 결과를 반환하고 다른 본문 재사용은 409.
- 실패한 검증·리비전 충돌은 저장하지 않는다. 검증 오류는 입력 수정 후 같은 requestId 재사용 가능. 충돌 후 재구성은 새 requestId 권장.
- request cache·graph delta·feedback ack는 동일 DB의 한 트랜잭션에서 적용한다. 예외는 전체 rollback. SSE는 최외곽 commit 이후 발행한다.
- graph_commit은 기존 baseRevision·stable ID·원자적 변경·retired 이력을 유지한다. 선택적으로 feedbackIds를 함께 적용 완료 처리하여 변경과 ack가 분리되지 않게 한다.
- layout은 별도 layoutRevision. 사용자 노드 수정도 CAS와 이력에 포함한다.

## 오류·재시도
- 모든 실패: ok:false, isError:true, content:[{type:'text',text}], requestId/sessionId(알 수 있으면), error.
- error에는 code,message,fieldErrors[{path,message}], expectedSchema(해당 계약), recovery{retryable,action,instructions}, 필요한 currentRevision/availableTools 포함.
- 400 INVALID_REQUEST/UNKNOWN_TOOL/INVALID_JSON, 404 SESSION_NOT_FOUND/NOT_FOUND, 409 REVISION_CONFLICT/LAYOUT_REVISION_CONFLICT/REQUEST_ID_REUSED, 413 PAYLOAD_TOO_LARGE, 415 UNSUPPORTED_MEDIA_TYPE, 422 VALIDATION_FAILED/INVALID_GRAPH, 403 FORBIDDEN, 500 INTERNAL_ERROR.
- 잘못된 envelope는 envelope 스키마, 잘못된 arguments는 정확한 도구 스키마를 반환한다. 실행 오류는 도구 스키마와 구체적 복구 지침을 제공한다. retryable은 '지침에 따라 고쳐 재시도 가능'이지 동일 요청 무한 반복 허용이 아니다.
- 내부 오류·원시 SQLite 예외는 클라이언트에 노출하지 않고 서버 stderr에만 기록한다.

## 사용자 협업
캔버스는 sessionId URL로 연다. 최근에 연 세션 목록은 브라우저 로컬 저장소만 사용하며 전역 서버 목록은 없다. 노드 직접 편집·이동, 단일 캔버스 상세 설명, pen strokes와 메모 제출을 제공한다. 피드백은 원래 graphRevision, 선택 nodeIds, note, 좌표와 capture snapshot을 저장한다. 단순 그림과 명시적 요청을 구분하고 agent는 다음 응답 전에 pending 피드백을 읽는다. 도구가 자동으로 현재 CLI에 사용자 메시지를 밀어넣지는 않는다.

## LAN·보안
Node >=24.16, TypeScript, SQLite. 기본 127.0.0.1:43821. AXCANVAS_HOST=0.0.0.0으로 LAN 공유를 명시적으로 활성화한다. AXCANVAS_PUBLIC_URL이 있으면 반환 URL의 기준으로 사용하며 아니면 허용된 요청 Host로 만든다. 허용 Host는 localhost/loopback/서버 IPv4와 명시 설정한 host뿐이다. 브라우저는 같은 Origin만 허용하고 외부/null Origin과 cross-site 요청을 거부한다. curl/기본 HTTP 도구의 Origin 없는 요청은 허용한다. 본문 최대 1MiB, sessionId는 안전한 문자·길이로 검증하고 파일 경로로 쓰지 않는다. 별도 인증이 없으므로 로컬 또는 신뢰하는 LAN과 제한된 방화벽에 한정한다. 방화벽은 사용자 승인 없이 변경하지 않는다.

## TDD·라이브 수용 기준
1. 새 HTTP 테스트가 기존 서버에서 실패한다.
2. 스키마 오류에 필드·기대 스키마·복구 방법이 있고 동일 requestId로 고쳐 성공한다.
3. stale write가 거부되고 re-read/rebuild로 사용자 수정 보존. 다른 세션 ID로 데이터가 섞이지 않는다.
4. 성공 재전송·다른 본문 ID 재사용·알 수 없는 도구·잘못된 Origin/Host/Content-Type/대용량/JSON을 검증한다.
5. feedback와 graph 변경의 원자적 처리·DB 재오픈·격리를 검증한다.
6. 독립 브라우저 runner는 임시 DB·임의 포트에서 실제 편집·드로잉 제출·정렬 Worker·focus·minimap을 검증한다. 모델 결과로 주장하지 않는다.
7. agent 연동 자체 변경 시 추가 확장 없이 실제 agent가 agents.md와 HTTP로 오류를 고치는지 별도 검증한다. LAN 자체 변경 시 외부 기기 연결을 별도 검증하고 미검증 범위를 명시한다.

