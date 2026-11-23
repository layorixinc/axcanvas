# 연결 집중·미니맵 설계 — 2026-11-24

## 연결 집중
기본 해제. Ctrl+노드 클릭(키보드는 Ctrl+Enter/Space)으로 선택 노드와 이웃을 집중 표시한다. 일반 선택은 집중을 해제한다. 서버 재조회 같은 내부 select 호출은 현재 모드를 바꾸지 않는다. 사용자 편집 중 선택 차단 규칙은 유지한다. 기존 수동 체크박스도 명시적 대체 입력으로 남긴다.

## 미니맵
- 캔버스 오른쪽 아래에 전체 그래프와 현재 화면 영역을 표시한다. 문서/새 창 없이 같은 화면에서 사용한다.
- 활성/현재 표시 노드·연결 경로를 요약하고, 노드 상세 텍스트나 관계 라벨은 생략한다. 현재 선택은 식별 가능하게 표시한다.
- 화면 영역은 SVG의 실제 screen→world 변환으로 계산한다. viewBox와 viewport 비율이 다른 경우의 여백도 고려한다.
- 지도 범위는 그래프 geometry와 현재 viewport의 합집합이다. 멀리 pan한 경우에도 현재 위치를 표시한다.
- 클릭은 해당 world 지점을 화면 중앙으로 이동시킨다. viewport 내부에서 드래그하면 잡은 위치의 offset을 보존한다.
- 드래그 도중 mini viewBox/좌표 변환은 시작 시점으로 고정해 범위 변경으로 인한 떨림을 막는다. 해제·취소·capture 상실을 처리한다.
- 방향키로 10% 이동, Home으로 전체 보기. 접기/펼치기 지원. 빈 그래프에서는 숨긴다.
- main pan/zoom/resize, 노드 이동, 자동 정렬 preview/apply/cancel/undo 시 동기화한다.
- 미니맵 탐색은 camera만 바꾸며 graph_layout이나 graph_commit을 호출하지 않는다. 사용자 그림과 노드 위치를 바꾸지 않는다.
- SVG 문자열을 innerHTML로 삽입하지 않는다. 기존 DOM 생성 방식과 같은 안전한 속성 설정을 사용한다.
- 접기 상태는 탭 메모리만 사용한다. 원본 지식 데이터나 layout revision에 UI 설정을 저장하지 않는다.

## 검증
먼저 실제 브라우저에서 기본 focus checked와 없는 minimap을 red로 확인한다. 이후 Ctrl/일반 클릭·내부 refresh, minimap 노드/viewport·zoom·클릭·드래그·키보드·접기·preview·resize 및 저장된 graph 불변을 검증한다. 기존 pan 검사는 새 overlay와 겹치지 않는 실제 main canvas 지점을 사용한다.
