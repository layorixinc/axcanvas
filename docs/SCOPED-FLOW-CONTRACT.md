# Scoped-flow implementation contract

This refines FLOW-BOUNDARIES.md into shared implementation interfaces. English UI, additive migration, canonical graph APIs, durable drafts/review and one-shot notification remain invariants. No turn inference from graph revision or creation order.

Current UI usage: [Scopes and arrangement](USER-GUIDE.md#5-choose-a-scope-and-arrange-it). Exact coordinate/storage/delivery conventions: [Layout data](LAYOUT-DATA.md). Source schemas are authoritative for limits.

## Data
Flow = {id,scope:'graph'|'turn'|'custom',label,status:'active'|'retired',turnId?:string,nodeIds:string[],edgeIds:string[],startNodeIds:string[],endNodeIds:string[]}. status defaults active; ID sets are unique. For scope graph, nodeIds/edgeIds default [] and membership is all active graph content; do not accept a nonempty explicit member list. turn requires nonempty turnId; turnId is absent for graph/custom. At most one active graph flow and one active flow for each turnId. turn/custom can be empty while authored; boundary IDs must belong to active member nodes; member edges require their endpoints in membership. Validate active flows after combined graph changes.

Graph and GraphView gain flows:Flow[] and flowLayouts:Record<flowId,ViewLayout>, defaulting to []/{} on old records/captures. ViewLayout = {positions:Record<nodeId,Position>,routes:Record<edgeId,EdgeRoute>,direction:'RIGHT'|'DOWN'|null}. Non-global layouts only. Existing graph.positions/routes/layoutDirection represent Whole graph, including a graph-scope flow regardless of its ID. Missing scoped layout initially uses member global coordinates where available and no claimed routed layout; it is not a fake Worker fallback. Global layoutRevision protects all view geometry.

graph_commit gains optional flows (upsert complete definitions by ID) and retireFlowIds (default []). Omission preserves other flows. Metadata-only commits are allowed and semantic, recorded in history with changedFlowIds. Agent retirement must repair active memberships/roles explicitly or fail atomically. Existing old history/result/capture loading defaults new fields without inventing flows.

graph_layout gains optional flowId (null/omitted means Whole graph). A graph-scope ID also targets Whole graph. Scope geometry references only its members/edges. Store layout changes only in the selected view; never copy scoped layout into global fields. Reject unknown/retired scope IDs and invalid route/member IDs. Semantic changes invalidate routes in every affected view conservatively while preserving coordinates.

## Shared pure view/layout helpers
- public/flows.js flowView(graph, flowId = null) returns {nodes,edges,positions,routes,layoutDirection,flow,flowId}. Null or an active graph flow targets all active content/global geometry; a non-global flow returns explicit active members and its scoped geometry. Unknown/retired IDs throw. Missing scoped entries fall back to member global positions with no routed layout/direction; existing entries are not filled from global per node. The backend's src/flows.ts view helper uses the field name direction and returns flow:null for a null ID, while the public helper resolves the active graph-flow definition for badges/constraints.
- boundaryRoles(graph,nodeId): returns [{flowId,label,scope,start,end}] for all active flows where the node has a role. Never infer from edges.
- buildLayoutGraph(graph,direction,measurements,flowId=null) filters through flowView and rejects multi-member dual-role constraints. Ordinary scopes use FIRST_SEPARATE/LAST_SEPARATE, separateConnectedComponents=false and GREEDY_MODEL_ORDER. Linked boundary bands use full-size ELK compound nodes with fixed-side ports because ELK forbids edges within FIRST_SEPARATE/LAST_SEPARATE bands. Extract nested coordinates into one frame and enforce the same actual-geometry and original semantic endpoint postconditions.
- extractLayout(elkOutput,direction,semanticGraph,flowId=null) requires semanticGraph, validates completeness, actual boundary bands, finite/nonoverlapping rectangles, orthogonal routes, labels and original edge endpoints, then returns {positions,routes,direction}. Migrate every caller; no hidden unconstrained fallback.

## Draft operations and annotation frames
Existing draft operations gain optional flowId where geometry/authoring depends on a view:
- node {type:'node',node,position?,flowId?}: new nodes in a non-global flow are added to its membership and positioned in that view, not global coordinates. Existing shared nodes are never cloned.
- edge {type:'edge',edge,flowId?}: include the edge in that flow; endpoints must already be members.
- move/layout gain flowId and modify only selected view geometry.
- layout_region also accepts flowId; positions must exactly match its nonempty nodeIds and routes must connect only region members. It merges the neighborhood while retaining outside positions/unrelated routes, clearing crossing routes and preserving the view's direction. Worker completion immediately saves one draft checkpoint; no preview/Apply stage exists.
- {type:'flow',flow:Flow} upserts a definition; {type:'retire_flow',flowId} retires an existing flow or removes a newly created one.
- human retire_node/retire_edge cleans affected memberships, boundaries and scoped geometry; review exposes flow diffs. New-then-removed nodes/flows produce no phantom changes.
- instruction gains optional flowId; DraftView gains captureFlowId:string|null. Feedback gains captureFlowId?:string|null. Store the annotation frame's selected view; default old payloads to Whole graph.

Block switching views while unsaved forms or captured strokes exist; preserve them and explain how to save/clear. Block geometry/member changes that reinterpret an existing drawing frame. Rebase drawing safety compares the captured scope/member positions rather than unrelated global coordinates. Semantic-only rebases retain drawings. Review snapshots and feedback SVG use captureFlowId and show corresponding badges and geometry; immutable before/after GraphViews retain all flows/layouts.

Add change entities flow and flow_layout with IDs identifying the definition or view. Rebase flows by stable IDs and merge independent ID-set additions/removals; explicit resolution is required for incompatible membership/role changes. Include flows/layouts/captureFlowId in checkpoints, review tokens and exact replay. Scope selection itself is browser view state, not a semantic mutation.

## Stable UI selectors
#flow-selector: value '' for Whole graph, otherwise active turn/custom ID. #add-flow, #edit-flow. Flow editor/dialog #flow-editor with #flow-label, #flow-scope, #flow-turn-id, multi-select #flow-nodes/#flow-edges/#flow-starts/#flow-ends, #flow-save/#flow-retire/#flow-cancel. Node role controls #node-flow-start/#node-flow-end and qualified list #node-flow-roles. Preserve existing authoring/review selectors and Ctrl/middle-pan behavior. Show selected-scope START/END/START + END badges, additional roles, accessible names and minimap marks. View switch fits only the view, not canonical coordinates.

Whole-graph boundary editor can create a graph flow if absent. New turn/custom flows require explicit members rather than deducing them from provenance. Scope labels and turnId are user data; never translate them. Existing node kind/status are unchanged.

## Acceptance

Required proof: existing graphs preserve data; repeated turn commits preserve membership/roles; same node has Turn 1 END and Turn 2 START; multiple starts/ends and disconnected members satisfy RIGHT/DOWN; arranging Turn 2 leaves global/Turn 1 geometry unchanged; UI flow creation/role toggles survive draft reload and net undo; stale tokens/jobs and conflicting rebases fail without losing input; captured scope SVG agrees with canvas; final review creates one watcher event, never intermediate role/layout saves. Verify narrow UI and English defaults. Real agent-created flow payloads and actual native Worker rendering are required for live proof; do not label fixture execution as another agent product's live integration.
