# 자동 정렬 설계 — 2026-11-24

## 사용자 흐름
방향(좌→우/위→아래) 선택 → 자동 정렬 → Worker 계산 → 캔버스 미리보기 → 적용 또는 취소. 적용은 한 번의 HTTP 변경이며 저장 후 새로고침해도 경로·라벨·위치가 동일하다. 되돌리기는 현재 탭에서 가장 최근 적용 1회에 대해 이전 레이아웃을 복원한다. 탭을 닫으면 undo 메모리는 사라지며 서버의 의미 이력은 변경하지 않는다.

## 불변 조건
- 답변 갱신마다 자동 정렬하지 않는다. 의미 노드·관계·출처·피드백을 변경하지 않는다.
- ELK 0.12.1 layered/ORTHOGONAL, 340×150 노드, 실제 폰트로 측정한 축약 관계 라벨 크기를 입력한다. SVG에는 반환 sections의 start/bend/end 점과 라벨 상자를 사용한다.
- 정렬 입력에서 retired 노드·관계는 제외한다. 순환·복수 관계·self-loop·분리 노드를 처리하고 원래 source/target은 보존한다.
- 실제 계산은 same-origin Web Worker에서 한다. 작업 ID와 sessionId/graph revision/layout revision을 묶고 늦은 결과는 폐기한다. 실패 시 기존 레이아웃을 유지하며 성공을 가장하는 fallback 정렬은 없다.
- 미리보기 중 저장은 하지 않는다. 취소 시 원래 camera와 레이아웃을 복원한다. 적용/undo는 baseRevision와 baseLayoutRevision 모두 검사한다.
- 미제출 그림·지시·노드 편집이 있으면 정렬하지 않는다. 계산·미리보기 중에는 node editing/move/drawing/session 전환을 막고 pan/zoom은 유지한다.
- 수동 node move는 모든 저장 경로를 무효화한다. 이동 노드가 무관한 경로를 가로막을 수도 있기 때문이다. 위치는 유지하고 명시적 정렬로 다시 라우팅한다.
- 의미 commit은 경로를 무효화하되 기존 좌표는 보존한다. 경로가 삭제되면 layoutRevision도 증가한다. 오래된 preview/undo는 재조회로 취소한다.
- 새 데이터에 맞지 않는 경로를 조용히 사용하지 않는다. 경로 없는 상태는 기본 연결로 표시하며 UI에서 재정렬이 가능하다.

## 계약·저장
Graph에 routes와 layoutDirection을 추가한다. route = {sections: Position[][], label:{x,y,width,height,text}}. layoutDirection은 RIGHT/DOWN/null이다.

graph_layout 입력: baseRevision, baseLayoutRevision, mode(move|replace), positions, routes(기본 {}), direction(기본 null).
- move: 일부 위치 merge, routes 비움, 기존 방향 유지.
- replace: 위치·경로·방향을 정확히 교체. undo의 빈 위치 {}도 그대로 복원한다.
- node/edge ID·활성 상태·유한 좌표·label dimension을 검증한다. 실패·충돌 시 부분 적용하지 않는다.
- SQLite graphs에 routes와 layout_direction을 비파괴 migration. 기존 DB/이력/성공 요청은 보존한다.
- 그래프/레이아웃 리비전은 함께 CAS. graph_layout input과 모든 caller·테스트를 새 계약으로 cutover한다.

## 렌더링
public/layout.js는 브라우저와 Node 테스트가 공유하는 순수 입력/출력 변환이다. ELK client와 worker는 고정된 npm 패키지에서 동일 origin의 제한된 asset URL로만 제공한다. CSP는 worker-src self를 명시하고 외부 CDN·임의 node_modules 공개를 하지 않는다.

경로·라벨 상자를 전체 보기 bounds에 포함한다. 기본 라벨은 축약하고 SVG title 및 선택 노드의 전체 관계 목록으로 원문을 읽는다. 연결 집중 체크 시 선택 노드와 이웃을 강조하고 다른 노드·선을 옅게 표시한다. dragging 중에는 저장 경로를 쓰지 않고 연결을 이동 위치에 맞춰 그린다.

## TDD·수용 기준
- 먼저 새로운 HTTP 레이아웃 필드를 기존 계약이 거부하는 red와 없는 계산 모듈 red를 관찰한다.
- 실제 ELK로 방향·겹침·직교 경로·라벨·순환·복수 관계·self-loop·분리 노드를 검사한다.
- 저장/재오픈/undo/graph 및 layout 충돌/노드 이동 및 의미 변경 시 경로 무효화/피드백 보존을 검사한다.
- 실제 브라우저 Worker 실행, 취소 시 서버 무변경, 적용·새로고침·되돌리기, 사용자 draft 차단, 충돌 취소, 연결 강조, pan 회귀를 확인한다.
