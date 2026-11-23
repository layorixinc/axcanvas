import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { commitSchema, layoutSchema, openSchema, type Graph, type GraphNode, type GraphEdge, type CommitResult, type Feedback, type LayoutChange } from './schema.ts';

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
type GraphRow = { graph_id: string; session_id: string; title: string; revision: number; snapshot: string; positions: string; layout_revision: number; routes: string; layout_direction: 'RIGHT' | 'DOWN' | null };

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
      );`);
    const columns = this.db.prepare('PRAGMA table_info(graphs)').all().map(column => column.name);
    const additions: Record<string, string> = { routes: "TEXT NOT NULL DEFAULT '{}'", layout_direction: 'TEXT' };
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
      routes: JSON.parse(row.routes), layoutDirection: row.layout_direction
    };
  }
  history(graphId: string): Graph[] {
    this.read(graphId);
    return this.db.prepare('SELECT snapshot FROM history WHERE graph_id=? ORDER BY revision').all(graphId).map(r => JSON.parse(r.snapshot as string));
  }
  commit(raw: unknown, actor: 'agent' | 'user' = 'agent'): CommitResult {
    const input = commitSchema.parse(raw);
    const hash = createHash('sha256').update(canonical({ actor, input })).digest('hex');
    const result = this.transaction(() => {
      const previous = this.db.prepare('SELECT request_hash,result FROM commits WHERE graph_id=? AND request_id=?').get(input.graphId, input.requestId) as { request_hash: string; result: string } | undefined;
      if (previous) {
        if (previous.request_hash !== hash) throw new GraphError('REQUEST_ID_REUSED', 'Request ID reused with a different body');
        return JSON.parse(previous.result) as CommitResult;
      }
      const graph = this.read(input.graphId);
      if (input.baseRevision !== graph.revision) throw new GraphError('REVISION_CONFLICT', `Revision conflict: expected ${graph.revision}, received ${input.baseRevision}; read the graph again`, { currentRevision: graph.revision });
      distinct(input.nodes.map(n => n.id), 'node'); distinct(input.edges.map(e => e.id), 'edge');
      distinct(input.retireNodeIds, 'retired node'); distinct(input.retireEdgeIds, 'retired edge');
      if (!input.nodes.length && !input.edges.length && !input.retireNodeIds.length && !input.retireEdgeIds.length) throw new GraphError('INVALID_GRAPH', 'Empty graph change is not an answer');
      const nodes = new Map<string, GraphNode>(graph.nodes.map(n => [n.id, n]));
      const edges = new Map<string, GraphEdge>(graph.edges.map(e => [e.id, e]));
      for (const n of input.nodes) nodes.set(n.id, n);
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
      const revision = graph.revision + 1;
      const at = new Date().toISOString();
      this.db.prepare("UPDATE graphs SET snapshot=?,revision=?,updated_at=?,routes='{}',layout_revision=layout_revision+? WHERE graph_id=?").run(JSON.stringify(snapshot), revision, at, Object.keys(graph.routes).length ? 1 : 0, graph.graphId);
      const committed: CommitResult = { graphId: graph.graphId, revision, answerId: input.answerId, changedNodeIds: [...new Set([...input.nodes.map(n => n.id), ...input.retireNodeIds])], changedEdgeIds: [...edges.values()].filter(e => JSON.stringify(graph.edges.find(old => old.id === e.id)) !== JSON.stringify(e)).map(e => e.id) };
      this.db.prepare('INSERT INTO history(graph_id,revision,snapshot,actor,at) VALUES(?,?,?,?,?)').run(graph.graphId, revision, JSON.stringify({ ...this.read(graph.graphId), actor, answerId: input.answerId, changedNodeIds: committed.changedNodeIds, at }), actor, at);
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
      for (const id of Object.keys(input.positions)) if (!graph.nodes.some(n => n.id === id)) throw new GraphError('INVALID_LAYOUT', `Unknown layout node: ${id}`);
      if (input.mode === 'move' && Object.keys(input.routes).length) throw new GraphError('INVALID_LAYOUT', 'Move invalidates routes; use replace to apply routed geometry');
      for (const id of Object.keys(input.routes)) {
        const edge = graph.edges.find(e => e.id === id);
        if (!edge || edge.status !== 'active') throw new GraphError('INVALID_LAYOUT', `Unknown or retired routed edge: ${id}`);
      }
      const positions = input.mode === 'move' ? { ...graph.positions, ...input.positions } : input.positions;
      const routes = input.mode === 'move' ? {} : input.routes;
      const direction = input.mode === 'move' ? graph.layoutDirection : input.direction;
      this.db.prepare('UPDATE graphs SET positions=?,routes=?,layout_direction=?,layout_revision=? WHERE graph_id=?').run(JSON.stringify(positions), JSON.stringify(routes), direction, graph.layoutRevision + 1, graphId);
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
  submitFeedback(sessionId: string, input: { baseRevision: number; note: string; nodeIds: string[]; strokes: Feedback['strokes'] }): Feedback {
    const graph = this.readSession(sessionId);
    if (input.baseRevision !== graph.revision) throw new GraphError('REVISION_CONFLICT', 'Feedback is based on an older graph; read again', { currentRevision: graph.revision });
    for (const id of input.nodeIds) if (!graph.nodes.some(n => n.id === id)) throw new GraphError('INVALID_GRAPH', `Unknown feedback node: ${id}`);
    const feedback: Feedback = { id: randomUUID(), sessionId, graphRevision: graph.revision, nodeIds: input.nodeIds, note: input.note, strokes: input.strokes, status: 'pending', resolution: '', createdAt: new Date().toISOString(), capture: graph };
    this.db.prepare('INSERT INTO feedback VALUES(?,?,?,?)').run(feedback.id, graph.graphId, 'pending', JSON.stringify(feedback));
    this.changed(graph.graphId);
    return feedback;
  }
  feedback(sessionId: string, status: 'pending' | 'all' = 'pending'): Feedback[] {
    const graph = this.readSession(sessionId);
    const rows = status === 'all' ? this.db.prepare('SELECT payload FROM feedback WHERE graph_id=? ORDER BY rowid').all(graph.graphId) : this.db.prepare("SELECT payload FROM feedback WHERE graph_id=? AND status='pending' ORDER BY rowid").all(graph.graphId);
    return rows.map(row => JSON.parse(row.payload as string) as Feedback);
  }
  feedbackItem(sessionId: string, id: string): Feedback {
    const graph = this.readSession(sessionId);
    const row = this.db.prepare('SELECT payload FROM feedback WHERE graph_id=? AND id=?').get(graph.graphId, id) as { payload: string } | undefined;
    if (!row) throw new GraphError('NOT_FOUND', 'Feedback not found in this session');
    return JSON.parse(row.payload) as Feedback;
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
}
