import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { commitSchema, layoutSchema, openSchema, draftChangeSchema, draftIdSchema, draftVersionSchema, draftRebaseSchema, type Graph, type GraphNode, type GraphEdge, type CommitResult, type Feedback, type LayoutChange, type DraftView, type GraphView, type DraftOperation } from './schema.ts';
import { graphView, stable, validateWork, applyOperation, diff, mergeGraph, type DraftWork } from './review.ts';
import { flowView, annotationFrame, validateFlows, validateGeometry, invalidateFlowRoutes, pruneFlowLayouts } from './flows.ts';

export class GraphError extends Error {
  code: string;
  info: Record<string, unknown>;
  constructor(code: string, message: string, info: Record<string, unknown> = {}) { super(message); this.code = code; this.info = info; }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(k => `${JSON.stringify(k)}:${canonical(object[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function distinct(ids: string[], name: string) {
  if (new Set(ids).size !== ids.length) throw new GraphError('INVALID_GRAPH', `Duplicate ${name} ID`);
}
type GraphRow = { graph_id: string; session_id: string; title: string; revision: number; snapshot: string; positions: string; layout_revision: number; routes: string; layout_direction: 'RIGHT' | 'DOWN' | null; flows: string; flow_layouts: string };
type DraftRecord = { id: string; sessionId: string; version: number; state: DraftView['state']; base: GraphView; work: DraftWork; checkpoint: number; editGroup?: { id: string; target: string; checkpoint: number }; submittedVersion?: number; token?: string; feedbackId?: string; submittedFeedback?: Feedback };
function restoreFeedback(item: Feedback): Feedback {
  item.captureFlowId ??= null;
  for (const graph of [item.capture, item.review?.before, item.review?.after]) if (graph) { graph.flows ??= []; graph.flowLayouts ??= {}; }
  return item;
}

export class GraphStore {
  private db: DatabaseSync;
  private closed = false;
  private inTransaction = false;
  private changes = new Set<string>();
  onChange?: (graphId: string) => void;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS graphs (
        graph_id TEXT PRIMARY KEY, session_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0, snapshot TEXT NOT NULL,
        positions TEXT NOT NULL DEFAULT '{}', layout_revision INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS commits (
        graph_id TEXT NOT NULL REFERENCES graphs(graph_id), request_id TEXT NOT NULL,
        request_hash TEXT NOT NULL, answer_id TEXT NOT NULL, actor TEXT NOT NULL,
        result TEXT NOT NULL, PRIMARY KEY(graph_id,request_id)
      );
      CREATE TABLE IF NOT EXISTS history (
        graph_id TEXT NOT NULL REFERENCES graphs(graph_id), revision INTEGER NOT NULL,
        snapshot TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL,
        PRIMARY KEY(graph_id,revision)
      );
      CREATE TABLE IF NOT EXISTS agent_requests (
        session_id TEXT NOT NULL, request_id TEXT NOT NULL, request_hash TEXT NOT NULL,
        response TEXT NOT NULL, PRIMARY KEY(session_id,request_id)
      );
      CREATE TABLE IF NOT EXISTS feedback (
        id TEXT PRIMARY KEY, graph_id TEXT NOT NULL REFERENCES graphs(graph_id),
        status TEXT NOT NULL, payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS drafts (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES graphs(session_id), payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS draft_history (
        draft_id TEXT NOT NULL REFERENCES drafts(id), checkpoint INTEGER NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY(draft_id,checkpoint)
      );
      CREATE TABLE IF NOT EXISTS submissions (
        cursor INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES graphs(session_id),
        feedback_id TEXT NOT NULL UNIQUE REFERENCES feedback(id)
      );
      CREATE INDEX IF NOT EXISTS submissions_session_cursor ON submissions(session_id,cursor);
    `);
    const columns = this.db.prepare('PRAGMA table_info(graphs)').all().map(column => column.name);
    const additions: Record<string, string> = { routes: "TEXT NOT NULL DEFAULT '{}'", layout_direction: 'TEXT', flows: "TEXT NOT NULL DEFAULT '[]'", flow_layouts: "TEXT NOT NULL DEFAULT '{}'" };
    for (const [name, definition] of Object.entries(additions)) if (!columns.includes(name)) this.db.exec(`ALTER TABLE graphs ADD COLUMN ${name} ${definition}`);
  }
  close() { if (!this.closed) { this.db.close(); this.closed = true; } }
  private transaction<T>(action: () => T): T {
    if (this.inTransaction) return action();
    this.db.exec('BEGIN IMMEDIATE'); this.inTransaction = true;
    let result: T;
    try { result = action(); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); this.changes.clear(); throw error; }
    finally { this.inTransaction = false; }
    const changed = [...this.changes]; this.changes.clear();
    for (const id of changed) this.onChange?.(id);
    return result;
  }
  open(sessionId: string, title: string): Graph {
    openSchema.parse({ sessionId, title });
    const existing = this.db.prepare('SELECT graph_id FROM graphs WHERE session_id=?').get(sessionId) as { graph_id: string } | undefined;
    if (existing) return this.read(existing.graph_id);
    const graphId = randomUUID();
    this.db.prepare('INSERT OR IGNORE INTO graphs(graph_id,session_id,title,snapshot,updated_at) VALUES(?,?,?,?,?)')
      .run(graphId, sessionId, title, JSON.stringify({ nodes: [], edges: [] }), new Date().toISOString());
    const row = this.db.prepare('SELECT graph_id FROM graphs WHERE session_id=?').get(sessionId) as { graph_id: string };
    this.changed(row.graph_id);
    return this.read(row.graph_id);
  }
  private changed(graphId: string) {
    if (this.inTransaction) this.changes.add(graphId);
    else this.onChange?.(graphId);
  }
  readSession(sessionId: string): Graph {
    const row = this.db.prepare('SELECT graph_id FROM graphs WHERE session_id=?').get(sessionId) as { graph_id: string } | undefined;
    if (!row) throw new GraphError('SESSION_NOT_FOUND', 'Session not found; call session_open with this sessionId first');
    return this.read(row.graph_id);
  }
  read(graphId: string): Graph {
    const row = this.db.prepare('SELECT * FROM graphs WHERE graph_id=?').get(graphId) as GraphRow | undefined;
    if (!row) throw new GraphError('NOT_FOUND', 'Graph not found');
    return {
      graphId: row.graph_id, sessionId: row.session_id, title: row.title, revision: row.revision,
      ...JSON.parse(row.snapshot), positions: JSON.parse(row.positions), layoutRevision: row.layout_revision,
      routes: JSON.parse(row.routes), layoutDirection: row.layout_direction, flows: JSON.parse(row.flows), flowLayouts: JSON.parse(row.flow_layouts)
    };
  }
  history(graphId: string): Graph[] {
    this.read(graphId);
    return this.db.prepare('SELECT snapshot FROM history WHERE graph_id=? ORDER BY revision').all(graphId).map(r => ({ flows: [], flowLayouts: {}, changedFlowIds: [], ...JSON.parse(r.snapshot as string) }));
  }
  commit(raw: unknown, actor: 'agent' | 'user' = 'agent'): CommitResult {
    const input = commitSchema.parse(raw);
    const hash = createHash('sha256').update(canonical({ actor, input })).digest('hex');
    const result = this.transaction(() => {
      const previous = this.db.prepare('SELECT request_hash,result FROM commits WHERE graph_id=? AND request_id=?').get(input.graphId, input.requestId) as { request_hash: string; result: string } | undefined;
      if (previous) {
        if (previous.request_hash !== hash) throw new GraphError('REQUEST_ID_REUSED', 'Request ID reused with a different body');
        return { changedFlowIds: [], ...JSON.parse(previous.result) } as CommitResult;
      }
      const graph = this.read(input.graphId);
      if (input.baseRevision !== graph.revision) throw new GraphError('REVISION_CONFLICT', `Revision conflict: expected ${graph.revision}, received ${input.baseRevision}; read the graph again`, { currentRevision: graph.revision });
      distinct(input.nodes.map(n => n.id), 'node'); distinct(input.edges.map(e => e.id), 'edge');
      distinct(input.retireNodeIds, 'retired node'); distinct(input.retireEdgeIds, 'retired edge');
      distinct((input.flows ?? []).map(flow => flow.id), 'flow');
      if (!input.nodes.length && !input.edges.length && !input.retireNodeIds.length && !input.retireEdgeIds.length && !input.flows?.length && !input.retireFlowIds?.length) throw new GraphError('INVALID_GRAPH', 'Empty graph change is not an answer');
      const nodes = new Map<string, GraphNode>(graph.nodes.map(n => [n.id, n]));
      const edges = new Map<string, GraphEdge>(graph.edges.map(e => [e.id, e]));
      for (const n of input.nodes) {
        const previous = nodes.get(n.id);
        nodes.set(n.id, n.tags === undefined && previous?.tags !== undefined ? { ...n, tags: previous.tags } : n);
      }
      for (const e of input.edges) edges.set(e.id, e);
      for (const id of input.retireNodeIds) {
        const n = nodes.get(id); if (!n) throw new GraphError('INVALID_GRAPH', `Unknown retired node: ${id}`);
        nodes.set(id, { ...n, status: 'retired' });
        for (const e of edges.values()) if (e.source === id || e.target === id) edges.set(e.id, { ...e, status: 'retired' });
      }
      for (const id of input.retireEdgeIds) {
        const e = edges.get(id); if (!e) throw new GraphError('INVALID_GRAPH', `Unknown retired edge: ${id}`);
        edges.set(id, { ...e, status: 'retired' });
      }
      for (const e of edges.values()) {
        if (!nodes.has(e.source) || !nodes.has(e.target)) throw new GraphError('INVALID_GRAPH', `Relation endpoint missing: ${e.id}`);
        if (e.status === 'active' && (nodes.get(e.source)!.status === 'retired' || nodes.get(e.target)!.status === 'retired')) edges.set(e.id, { ...e, status: 'retired' });
      }
      const snapshot = { nodes: [...nodes.values()], edges: [...edges.values()] };
      const flows = new Map(graph.flows.map(flow => [flow.id, flow]));
      for (const flow of input.flows ?? []) flows.set(flow.id, flow);
      for (const id of input.retireFlowIds ?? []) {
        const flow = flows.get(id);
        if (!flow) throw new GraphError('INVALID_GRAPH', `Unknown retired flow: ${id}`);
        flows.set(id, { ...flow, status: 'retired' });
      }
      const next = { ...graph, ...snapshot, flows: [...flows.values()], flowLayouts: structuredClone(graph.flowLayouts) };
      invalidateFlowRoutes(next); pruneFlowLayouts(next); validateFlows(next);
      const changedFlowIds = next.flows.filter(flow => stable(flow) !== stable(graph.flows.find(old => old.id === flow.id))).map(flow => flow.id);
      const revision = graph.revision + 1;
      const at = new Date().toISOString();
      this.db.prepare("UPDATE graphs SET snapshot=?,revision=?,updated_at=?,routes='{}',flows=?,flow_layouts=?,layout_revision=layout_revision+? WHERE graph_id=?").run(JSON.stringify(snapshot), revision, at, JSON.stringify(next.flows), JSON.stringify(next.flowLayouts), Object.keys(graph.routes).length || stable(next.flowLayouts) !== stable(graph.flowLayouts) ? 1 : 0, graph.graphId);
      const committed: CommitResult = { graphId: graph.graphId, revision, answerId: input.answerId, changedFlowIds, changedNodeIds: [...new Set([...input.nodes.map(n => n.id), ...input.retireNodeIds])], changedEdgeIds: [...edges.values()].filter(e => JSON.stringify(graph.edges.find(old => old.id === e.id)) !== JSON.stringify(e)).map(e => e.id) };
      this.db.prepare('INSERT INTO history(graph_id,revision,snapshot,actor,at) VALUES(?,?,?,?,?)').run(graph.graphId, revision, JSON.stringify({ ...this.read(graph.graphId), actor, answerId: input.answerId, changedNodeIds: committed.changedNodeIds, changedFlowIds, at }), actor, at);
      this.db.prepare('INSERT INTO commits VALUES(?,?,?,?,?,?)').run(graph.graphId, input.requestId, hash, input.answerId, actor, JSON.stringify(committed));
      return committed;
    });
    this.changed(input.graphId);
    return result;
  }
  layout(graphId: string, change: LayoutChange): Graph {
    const input = layoutSchema.parse({ ...change, graphId });
    this.transaction(() => {
      const graph = this.read(graphId);
      if (input.baseRevision !== graph.revision) throw new GraphError('REVISION_CONFLICT', 'Graph changed since layout computation; read again', { currentRevision: graph.revision });
      if (graph.layoutRevision !== input.baseLayoutRevision) throw new GraphError('LAYOUT_REVISION_CONFLICT', 'Layout revision conflict; read again', { currentRevision: graph.layoutRevision });
      const view = flowView(graph, input.flowId ?? null);
      validateGeometry(graph, view.flowId, input);
      if (input.mode === 'move' && Object.keys(input.routes).length) throw new GraphError('INVALID_LAYOUT', 'Move invalidates routes; use replace to apply routed geometry');
      const positions = input.mode === 'move' ? { ...view.positions, ...input.positions } : input.positions;
      const routes = input.mode === 'move' ? {} : input.routes;
      const direction = input.mode === 'move' ? view.direction : input.direction;
      if (view.flowId) {
        graph.flowLayouts[view.flowId] = { positions, routes, direction };
        this.db.prepare('UPDATE graphs SET flow_layouts=?,layout_revision=? WHERE graph_id=?').run(JSON.stringify(graph.flowLayouts), graph.layoutRevision + 1, graphId);
      } else this.db.prepare('UPDATE graphs SET positions=?,routes=?,layout_direction=?,layout_revision=? WHERE graph_id=?').run(JSON.stringify(positions), JSON.stringify(routes), direction, graph.layoutRevision + 1, graphId);
    });
    this.changed(graphId);
    return this.read(graphId);
  }
  executeRequest<T>(sessionId: string, requestId: string, tool: string, args: unknown, actor: string, readOnly: boolean, execute: () => T): T {
    const hash = createHash('sha256').update(canonical({ tool, args, actor })).digest('hex');
    const run = () => {
      const old = this.db.prepare('SELECT request_hash,response FROM agent_requests WHERE session_id=? AND request_id=?').get(sessionId, requestId) as { request_hash: string; response: string } | undefined;
      if (old) {
        if (old.request_hash !== hash) throw new GraphError('REQUEST_ID_REUSED', 'Request ID reused with a different tool, body or actor; use a new requestId');
        return JSON.parse(old.response) as T;
      }
      const result = execute();
      if (!readOnly) this.db.prepare('INSERT INTO agent_requests VALUES(?,?,?,?)').run(sessionId, requestId, hash, JSON.stringify(result));
      return result;
    };
    return readOnly ? run() : this.transaction(run);
  }
  submitFeedback(sessionId: string, input: { baseRevision: number; note: string; nodeIds: string[]; strokes: Feedback['strokes']; captureFlowId?: string | null }): Feedback {
    const graph = this.readSession(sessionId);
    if (input.baseRevision !== graph.revision) throw new GraphError('REVISION_CONFLICT', 'Feedback is based on an older graph; read again', { currentRevision: graph.revision });
    const view = flowView(graph, input.captureFlowId ?? null);
    for (const id of input.nodeIds) if (!view.nodes.some(n => n.id === id)) throw new GraphError('INVALID_GRAPH', `Unknown or nonmember feedback node: ${id}`);
    const feedback: Feedback = { id: randomUUID(), sessionId, graphRevision: graph.revision, nodeIds: input.nodeIds, note: input.note, strokes: input.strokes, captureFlowId: view.flowId, status: 'pending', resolution: '', createdAt: new Date().toISOString(), capture: graph };
    this.db.prepare('INSERT INTO feedback VALUES(?,?,?,?)').run(feedback.id, graph.graphId, 'pending', JSON.stringify(feedback));
    this.changed(graph.graphId);
    return feedback;
  }
  feedback(sessionId: string, status: 'pending' | 'all' = 'pending'): Feedback[] {
    const graph = this.readSession(sessionId);
    const rows = status === 'all' ? this.db.prepare('SELECT payload FROM feedback WHERE graph_id=? ORDER BY rowid').all(graph.graphId) : this.db.prepare("SELECT payload FROM feedback WHERE graph_id=? AND status='pending' ORDER BY rowid").all(graph.graphId);
    return rows.map(row => restoreFeedback(JSON.parse(row.payload as string) as Feedback));
  }
  feedbackItem(sessionId: string, id: string): Feedback {
    const graph = this.readSession(sessionId);
    const row = this.db.prepare('SELECT payload FROM feedback WHERE graph_id=? AND id=?').get(graph.graphId, id) as { payload: string } | undefined;
    if (!row) throw new GraphError('NOT_FOUND', 'Feedback not found in this session');
    return restoreFeedback(JSON.parse(row.payload) as Feedback);
  }
  ackFeedback(sessionId: string, ids: string[], status: Exclude<Feedback['status'], 'pending'>, note: string): Feedback[] {
    return this.transaction(() => {
      distinct(ids, 'feedback');
      const items = ids.map(id => this.feedbackItem(sessionId, id));
      for (const item of items) if (item.status !== 'pending' && (item.status !== status || item.resolution !== note)) throw new GraphError('FEEDBACK_RESOLVED', 'Feedback already resolved differently; read it again');
      const updated = items.map(item => ({ ...item, status, resolution: note }));
      for (const item of updated) this.db.prepare('UPDATE feedback SET status=?,payload=? WHERE id=?').run(status, JSON.stringify(item), item.id);
      if (updated.length) this.changed(this.readSession(sessionId).graphId);
      return updated;
    });
  }
  private draftRecord(sessionId: string, draftId: string): DraftRecord {
    this.readSession(sessionId);
    const row = this.db.prepare('SELECT payload FROM drafts WHERE id=? AND session_id=?').get(draftId, sessionId) as { payload: string } | undefined;
    if (!row) throw new GraphError('DRAFT_NOT_FOUND', 'Draft not found in this session; open a new draft ID or restore this session’s saved draft');
    const draft = JSON.parse(row.payload) as DraftRecord;
    draft.base.flows ??= []; draft.base.flowLayouts ??= {};
    draft.work.graph.flows ??= []; draft.work.graph.flowLayouts ??= {}; draft.work.captureFlowId ??= null;
    if (draft.work.routeOrigin) { draft.work.routeOrigin.flows ??= []; draft.work.routeOrigin.flowLayouts ??= {}; }
    if (draft.submittedFeedback) restoreFeedback(draft.submittedFeedback);
    return draft;
  }
  private draftView(draft: DraftRecord): DraftView {
    const before = this.db.prepare('SELECT checkpoint FROM draft_history WHERE draft_id=? AND checkpoint<? ORDER BY checkpoint DESC LIMIT 1').get(draft.id, draft.checkpoint);
    const after = this.db.prepare('SELECT checkpoint FROM draft_history WHERE draft_id=? AND checkpoint>? ORDER BY checkpoint LIMIT 1').get(draft.id, draft.checkpoint);
    return { id: draft.id, sessionId: draft.sessionId, version: draft.version, state: draft.state, baseRevision: draft.base.revision, baseLayoutRevision: draft.base.layoutRevision, graph: draft.work.graph, note: draft.work.note, strokes: draft.work.strokes, nodeIds: draft.work.nodeIds, captureFlowId: draft.work.captureFlowId ?? null, canUndo: draft.state === 'editing' && !!before, canRedo: draft.state === 'editing' && !!after };
  }
  private checkDraft(draft: DraftRecord, version: number) {
    if (draft.state !== 'editing') throw new GraphError('DRAFT_STATE_CONFLICT', `Draft is ${draft.state}; read it and open a new draft to make further changes`, { currentDraftVersion: draft.version });
    if (draft.version !== version) throw new GraphError('DRAFT_VERSION_CONFLICT', 'Draft changed in another tab; read draft_read and reconcile before retrying', { currentDraftVersion: draft.version });
  }
  private saveDraft(draft: DraftRecord) {
    this.db.prepare('UPDATE drafts SET payload=? WHERE id=? AND session_id=?').run(JSON.stringify(draft), draft.id, draft.sessionId);
  }
  private checkpointDraft(draft: DraftRecord) {
    this.db.prepare('DELETE FROM draft_history WHERE draft_id=? AND checkpoint>?').run(draft.id, draft.checkpoint);
    draft.checkpoint++; draft.version++;
    this.db.prepare('INSERT INTO draft_history VALUES(?,?,?)').run(draft.id, draft.checkpoint, JSON.stringify(draft.work));
    this.db.prepare('DELETE FROM draft_history WHERE draft_id=? AND checkpoint<?').run(draft.id, draft.checkpoint - 100);
    this.saveDraft(draft);
  }
  draftOpen(sessionId: string, draftId: string): DraftView {
    draftIdSchema.parse({ draftId });
    return this.transaction(() => {
      const graph = this.readSession(sessionId);
      const exists = this.db.prepare('SELECT session_id FROM drafts WHERE id=?').get(draftId);
      if (exists) return this.draftView(this.draftRecord(sessionId, draftId));
      const base = graphView(graph);
      const draft: DraftRecord = { id: draftId, sessionId, version: 0, state: 'editing', base, work: { graph: base, note: '', strokes: [], nodeIds: [], captureFlowId: null }, checkpoint: 0 };
      this.db.prepare('INSERT INTO drafts VALUES(?,?,?)').run(draftId, sessionId, JSON.stringify(draft));
      this.db.prepare('INSERT INTO draft_history VALUES(?,?,?)').run(draftId, 0, JSON.stringify(draft.work));
      return this.draftView(draft);
    });
  }
  draftRead(sessionId: string, draftId: string): DraftView {
    draftIdSchema.parse({ draftId });
    return this.draftView(this.draftRecord(sessionId, draftId));
  }
  draftChange(sessionId: string, input: { draftId: string; baseDraftVersion: number; operation: unknown; editGroup?: string }): DraftView {
    const parsed = draftChangeSchema.parse(input), operation = parsed.operation;
    return this.transaction(() => {
      const draft = this.draftRecord(sessionId, parsed.draftId);
      this.checkDraft(draft, parsed.baseDraftVersion);
      const target = parsed.editGroup ? this.editTarget(draft.work, operation) : null;
      const coalesce = parsed.editGroup && target && draft.editGroup?.id === parsed.editGroup && draft.editGroup.target === target && draft.editGroup.checkpoint === draft.checkpoint;
      draft.work = applyOperation(draft.work, draft.base, operation);
      draft.editGroup = parsed.editGroup && target ? { id: parsed.editGroup, target, checkpoint: draft.checkpoint + (coalesce ? 0 : 1) } : undefined;
      if (coalesce) {
        draft.version++;
        this.db.prepare('UPDATE draft_history SET payload=? WHERE draft_id=? AND checkpoint=?').run(JSON.stringify(draft.work), draft.id, draft.checkpoint);
        this.saveDraft(draft);
      } else this.checkpointDraft(draft);
      return this.draftView(draft);
    });
  }
  private editTarget(work: DraftWork, operation: DraftOperation): string | null {
    if (operation.type === 'node' && !operation.position && operation.node.status !== 'retired' && work.graph.nodes.some(node => node.id === operation.node.id)) return `node:${operation.node.id}:${operation.flowId ?? ''}`;
    if (operation.type === 'edge' && operation.edge.status === 'active' && work.graph.edges.some(edge => edge.id === operation.edge.id)) return `edge:${operation.edge.id}:${operation.flowId ?? ''}`;
    if (operation.type === 'instruction' && stable(work.strokes) === stable(operation.strokes)) return `instruction:${operation.flowId ?? ''}:${stable(operation.nodeIds)}`;
    return null;
  }
  draftStep(sessionId: string, input: { draftId: string; baseDraftVersion: number; direction: 'undo' | 'redo' }): DraftView {
    draftVersionSchema.parse({ draftId: input.draftId, baseDraftVersion: input.baseDraftVersion });
    if (input.direction !== 'undo' && input.direction !== 'redo') throw new GraphError('VALIDATION_FAILED', 'direction must be undo or redo');
    return this.transaction(() => {
      const draft = this.draftRecord(sessionId, input.draftId);
      this.checkDraft(draft, input.baseDraftVersion);
      const query = input.direction === 'undo' ? 'SELECT checkpoint,payload FROM draft_history WHERE draft_id=? AND checkpoint<? ORDER BY checkpoint DESC LIMIT 1' : 'SELECT checkpoint,payload FROM draft_history WHERE draft_id=? AND checkpoint>? ORDER BY checkpoint LIMIT 1';
      const row = this.db.prepare(query).get(draft.id, draft.checkpoint) as { checkpoint: number; payload: string } | undefined;
      if (!row) throw new GraphError('DRAFT_HISTORY_CONFLICT', `No ${input.direction} checkpoint remains; read draft_read`);
      draft.work = JSON.parse(row.payload); draft.checkpoint = row.checkpoint; draft.version++;
      delete draft.editGroup;
      draft.work.graph.flows ??= []; draft.work.graph.flowLayouts ??= {}; draft.work.captureFlowId ??= null;
      if (draft.work.routeOrigin) { draft.work.routeOrigin.flows ??= []; draft.work.routeOrigin.flowLayouts ??= {}; }
      this.saveDraft(draft);
      return this.draftView(draft);
    });
  }
  draftRebase(sessionId: string, raw: { draftId: string; baseDraftVersion: number; baseRevision: number; baseLayoutRevision: number; resolution: 'fail' | 'draft' | 'latest' }): DraftView {
    const input = draftRebaseSchema.parse(raw);
    return this.transaction(() => {
      const draft = this.draftRecord(sessionId, input.draftId);
      this.checkDraft(draft, input.baseDraftVersion);
      delete draft.editGroup;
      const latest = graphView(this.readSession(sessionId));
      if (latest.revision !== input.baseRevision || latest.layoutRevision !== input.baseLayoutRevision) throw new GraphError('DRAFT_BASE_CONFLICT', 'The inspected graph changed; graph_read again before rebasing', { currentRevision: latest.revision, currentLayoutRevision: latest.layoutRevision });
      const merged = mergeGraph(draft.base, draft.work.graph, latest, input.resolution);
      if (merged.conflicts.length && input.resolution === 'fail') throw new GraphError('DRAFT_REBASE_CONFLICT', 'Conflicting changes need explicit draft or latest resolution; no changes were applied', { conflicts: merged.conflicts });
      if (draft.work.strokes.length) {
        let frameChanged = false;
        try { frameChanged = stable(annotationFrame(merged.graph, draft.work.captureFlowId ?? null)) !== stable(annotationFrame(draft.work.graph, draft.work.captureFlowId ?? null)); } catch { frameChanged = true; }
        if (frameChanged) throw new GraphError('DRAFT_REBASE_CONFLICT', 'Rebase would change the captured drawing frame; clear drawings before rebasing. No changes were applied.', { conflicts: ['captureFlowId', 'positions'] });
      }
      draft.work.graph = merged.graph;
      delete draft.work.routeOrigin;
      validateWork(draft.work);
      draft.base = latest;
      // Earlier checkpoints use the old base and must never undo remote changes.
      this.db.prepare('DELETE FROM draft_history WHERE draft_id=?').run(draft.id);
      this.checkpointDraft(draft);
      return this.draftView(draft);
    });
  }
  draftReview(sessionId: string, input: { draftId: string; baseDraftVersion: number }) {
    draftVersionSchema.parse(input);
    const draft = this.draftRecord(sessionId, input.draftId);
    this.checkDraft(draft, input.baseDraftVersion);
    const latest = this.readSession(sessionId);
    const changes = diff(draft.base, draft.work);
    const conflict = latest.revision !== draft.base.revision || latest.layoutRevision !== draft.base.layoutRevision;
    const token = createHash('sha256').update(stable({ id: draft.id, sessionId, version: draft.version, base: draft.base, work: draft.work })).digest('hex');
    return { draftId: draft.id, version: draft.version, token, changes, baseRevision: draft.base.revision, baseLayoutRevision: draft.base.layoutRevision, conflict, canSubmit: !conflict && changes.length > 0 };
  }
  draftDiscard(sessionId: string, input: { draftId: string; baseDraftVersion: number }): DraftView {
    draftVersionSchema.parse(input);
    return this.transaction(() => {
      const draft = this.draftRecord(sessionId, input.draftId);
      this.checkDraft(draft, input.baseDraftVersion);
      draft.state = 'discarded'; draft.version++; this.saveDraft(draft);
      return this.draftView(draft);
    });
  }
  draftSubmit(sessionId: string, input: { draftId: string; baseDraftVersion: number; reviewToken: string }): Feedback {
    draftVersionSchema.parse({ draftId: input.draftId, baseDraftVersion: input.baseDraftVersion });
    return this.transaction(() => {
      const draft = this.draftRecord(sessionId, input.draftId);
      if (draft.state === 'submitted') {
        if (input.reviewToken === draft.token && input.baseDraftVersion === draft.submittedVersion) return draft.submittedFeedback ?? this.feedbackItem(sessionId, draft.feedbackId!);
        throw new GraphError('DRAFT_REVIEW_CONFLICT', 'This draft was submitted with a different review; read feedback and open a new draft');
      }
      const review = this.draftReview(sessionId, { draftId: input.draftId, baseDraftVersion: input.baseDraftVersion });
      if (review.token !== input.reviewToken) throw new GraphError('DRAFT_REVIEW_CONFLICT', 'Review token is stale; review this exact draft version again');
      if (review.conflict) {
        const latest = this.readSession(sessionId);
        throw new GraphError('DRAFT_BASE_CONFLICT', 'Canonical graph or layout changed; read graph_read and explicitly rebase before reviewing again', { currentRevision: latest.revision, currentLayoutRevision: latest.layoutRevision });
      }
      if (!review.canSubmit) throw new GraphError('VALIDATION_FAILED', 'No meaningful changes or instructions to submit');
      validateWork(draft.work);
      const graph = this.readSession(sessionId);
      const semantic = review.changes.some(change => change.entity === 'node' || change.entity === 'edge' || change.entity === 'flow');
      const layout = review.changes.some(change => change.entity === 'position' || change.entity === 'layout' || change.entity === 'flow_layout');
      const after: GraphView = { ...draft.work.graph, revision: graph.revision + Number(semantic), layoutRevision: graph.layoutRevision + Number(layout) };
      const at = new Date().toISOString();
      this.db.prepare('UPDATE graphs SET snapshot=?,revision=?,positions=?,routes=?,layout_direction=?,layout_revision=?,updated_at=?,flows=?,flow_layouts=? WHERE graph_id=?').run(JSON.stringify({ nodes: after.nodes, edges: after.edges }), after.revision, JSON.stringify(after.positions), JSON.stringify(after.routes), after.layoutDirection, after.layoutRevision, at, JSON.stringify(after.flows), JSON.stringify(after.flowLayouts), graph.graphId);
      if (semantic) this.db.prepare('INSERT INTO history VALUES(?,?,?,?,?)').run(graph.graphId, after.revision, JSON.stringify({ ...after, graphId: graph.graphId, actor: 'user', answerId: `draft-${draft.id}`, changedNodeIds: review.changes.filter(change => change.entity === 'node').map(change => change.id), changedFlowIds: review.changes.filter(change => change.entity === 'flow').map(change => change.id), at }), 'user', at);
      const feedback: Feedback = { id: randomUUID(), sessionId, graphRevision: after.revision, note: draft.work.note, nodeIds: draft.work.nodeIds, strokes: draft.work.strokes, captureFlowId: draft.work.captureFlowId ?? null, status: 'pending', resolution: '', createdAt: at, capture: { ...after, graphId: graph.graphId }, review: { draftId: draft.id, baseRevision: draft.base.revision, baseLayoutRevision: draft.base.layoutRevision, changes: review.changes, before: draft.base, after } };
      this.db.prepare('INSERT INTO feedback VALUES(?,?,?,?)').run(feedback.id, graph.graphId, 'pending', JSON.stringify(feedback));
      this.db.prepare('INSERT INTO submissions(session_id,feedback_id) VALUES(?,?)').run(sessionId, feedback.id);
      draft.submittedVersion = draft.version; draft.version++; draft.state = 'submitted'; draft.token = review.token; draft.feedbackId = feedback.id; draft.work.graph = after;
      draft.submittedFeedback = feedback;
      this.saveDraft(draft);
      this.changed(graph.graphId);
      return feedback;
    });
  }
  nextSubmission(sessionId: string, after: number): { cursor: number; feedback: Feedback } | null {
    this.readSession(sessionId);
    if (!Number.isSafeInteger(after) || after < 0) throw new GraphError('VALIDATION_FAILED', 'after must be a nonnegative safe integer');
    const row = this.db.prepare("SELECT s.cursor,f.payload FROM submissions s JOIN feedback f ON f.id=s.feedback_id WHERE s.session_id=? AND s.cursor>? AND f.status='pending' ORDER BY s.cursor LIMIT 1").get(sessionId, after) as { cursor: number; payload: string } | undefined;
    return row ? { cursor: row.cursor, feedback: restoreFeedback(JSON.parse(row.payload) as Feedback) } : null;
  }
}
