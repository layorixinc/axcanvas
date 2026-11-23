import { z } from 'zod';
import { GraphStore, GraphError } from './store.ts';
import { nodeSchema, edgeSchema, positionSchema, routeSchema, layoutInputSchema, type Graph, type Feedback } from './schema.ts';

export const sessionIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/, 'Use 1-128 letters, digits, hyphens or underscores; a UUID is recommended');
export const requestSchema = z.object({ requestId: z.string().min(1).max(256), sessionId: sessionIdSchema.optional(), tool: z.string().min(1).max(80), arguments: z.record(z.string(), z.unknown()), actor: z.enum(['agent', 'user']).default('agent') }).strict();
const empty = z.object({}).strict();
const ids = z.array(z.string().min(1).max(256)).max(300);
const strokeSchema = z.object({ points: z.array(positionSchema).min(2).max(2000) }).strict();
const graphSchema = z.object({ sessionId: z.string(), title: z.string(), revision: z.number().int(), nodes: z.array(nodeSchema), edges: z.array(edgeSchema), positions: z.record(z.string(), positionSchema), layoutRevision: z.number().int(), routes: z.record(z.string(), routeSchema).default({}), layoutDirection: z.enum(['RIGHT', 'DOWN']).nullable().default(null) });
const feedbackSchema = z.object({ id: z.string(), sessionId: z.string(), graphRevision: z.number(), nodeIds: ids, note: z.string(), strokes: z.array(strokeSchema), status: z.enum(['pending', 'applied', 'needs_clarification', 'rejected']), resolution: z.string(), createdAt: z.string(), imageUrl: z.string() });
const descriptorSchema = z.object({ name: z.string(), description: z.string(), inputSchema: z.record(z.string(), z.unknown()), outputSchema: z.record(z.string(), z.unknown()), annotations: z.object({ readOnlyHint: z.boolean(), idempotentHint: z.boolean() }), sessionRequired: z.boolean() });
const recoverySchema = z.object({ retryable: z.boolean(), action: z.string(), instructions: z.string() });
export const errorSchema = z.object({ code: z.string(), message: z.string(), fieldErrors: z.array(z.object({ path: z.string(), message: z.string() })), expectedSchema: z.record(z.string(), z.unknown()).optional(), currentRevision: z.number().optional(), availableTools: z.array(z.string()).optional(), recovery: recoverySchema });
const textSchema = z.object({ type: z.literal('text'), text: z.string() });
export const errorReplySchema = z.object({ ok: z.literal(false), isError: z.literal(true), requestId: z.string().nullable(), sessionId: z.string().nullable(), content: z.array(textSchema), error: errorSchema });
export type ToolError = z.infer<typeof errorSchema>;
export type ErrorReply = z.infer<typeof errorReplySchema>;
export interface ToolContext { sessionId: string; requestId: string; actor: 'agent' | 'user'; baseUrl: string }
interface Tool {
  name: string; description: string; input: z.ZodType; output: z.ZodType;
  readOnly: boolean; sessionRequired: boolean;
  invoke: (args: unknown, context: ToolContext) => unknown;
}
function tool<I extends z.ZodType, O extends z.ZodType>(name: string, description: string, input: I, output: O, readOnly: boolean, run: (input: z.output<I>, context: ToolContext) => unknown, sessionRequired = true): Tool {
  return { name, description, input, output, readOnly, sessionRequired, invoke: (raw, context) => {
    const result = run(input.parse(raw), context);
    const checked = output.safeParse(result);
    if (!checked.success) { console.error('[axcanvas] Invalid tool output', name, checked.error); throw new GraphError('INTERNAL_ERROR', 'Tool output validation failed'); }
    return checked.data;
  } };
}
export function jsonSchema(schema: z.ZodType, io: 'input' | 'output' = 'input') { return z.toJSONSchema(schema, { target: 'draft-07', io }); }
function view(graph: Graph) { const { graphId: _internal, ...result } = graph; return result; }
function publicFeedback(item: Feedback, base: string) { const { capture: _snapshot, ...result } = item; return { ...result, imageUrl: `${base}/feedback/${encodeURIComponent(item.id)}.svg?sessionId=${encodeURIComponent(item.sessionId)}` }; }
const successSchema = (result: z.ZodType) => z.object({ ok: z.literal(true), isError: z.literal(false), requestId: z.string(), sessionId: z.string().nullable(), content: z.array(textSchema), result });

export function errorResponse(code: string, message: string, raw?: unknown, extras: Partial<ToolError> = {}) {
  const identity = z.object({ requestId: z.string().optional(), sessionId: z.string().optional() }).safeParse(raw);
  const recovery: ToolError['recovery'] = code === 'REQUEST_ID_REUSED' ? { retryable: true, action: 'new_request_id', instructions: 'Use a new requestId for a different tool, actor or body. Replay a successful request only with its exact original body.' }
    : code === 'REVISION_CONFLICT' || code === 'LAYOUT_REVISION_CONFLICT' ? { retryable: true, action: 'read_graph', instructions: 'Call graph_read for this sessionId, reconcile current human edits, use the returned revision (layoutRevision for layout), and submit a new requestId.' }
    : code === 'SESSION_NOT_FOUND' ? { retryable: true, action: 'open_session', instructions: 'Call session_open with this sessionId and a title, then retry.' }
    : code === 'UNKNOWN_TOOL' ? { retryable: true, action: 'list_tools', instructions: 'Call tools_list with arguments:{} and use an exact tool name from the response.' }
    : code === 'NOT_FOUND' || code === 'FEEDBACK_RESOLVED' ? { retryable: true, action: 'read_feedback', instructions: 'Read current graph/feedback for this sessionId. Do not reuse IDs from another session. Rebuild the request with current IDs.' }
    : code === 'FORBIDDEN' ? { retryable: false, action: 'stop', instructions: 'Use the actual configured LAN host and same-origin browser page. Do not bypass browser security checks.' }
    : code === 'INTERNAL_ERROR' ? { retryable: false, action: 'stop', instructions: 'Report the requestId to the operator; do not retry indefinitely.' }
    : { retryable: true, action: 'fix_arguments', instructions: 'Correct the reported fields using expectedSchema. Validation failures apply nothing and do not reserve requestId, so you may retry the corrected input with the same requestId. Do not blindly repeat invalid input.' };
  const error = errorSchema.parse({ code, message, fieldErrors: [], recovery, ...extras });
  const text = [code + ': ' + message, ...error.fieldErrors.map(e => `${e.path}: ${e.message}`), error.recovery.instructions].join('\n');
  const body = errorReplySchema.parse({ ok: false, isError: true, requestId: identity.success ? identity.data.requestId ?? null : null, sessionId: identity.success ? identity.data.sessionId ?? null : null, content: [{ type: 'text', text }], error });
  const statuses: Record<string, number> = { INVALID_REQUEST: 400, UNKNOWN_TOOL: 400, INVALID_JSON: 400, SESSION_NOT_FOUND: 404, NOT_FOUND: 404, REVISION_CONFLICT: 409, LAYOUT_REVISION_CONFLICT: 409, REQUEST_ID_REUSED: 409, FEEDBACK_RESOLVED: 409, PAYLOAD_TOO_LARGE: 413, UNSUPPORTED_MEDIA_TYPE: 415, VALIDATION_FAILED: 422, INVALID_GRAPH: 422, INVALID_LAYOUT: 422, FORBIDDEN: 403, INTERNAL_ERROR: 500 };
  return { status: statuses[code] ?? 500, body };
}

export class AgentAPI {
  private store: GraphStore;
  private tools: Record<string, Tool>;
  constructor(store: GraphStore) {
    this.store = store;
    const definitions: Tool[] = [
      tool('tools_list', 'Discover the actual argument and result schemas. No session is required. This is HTTP tool calling, not the MCP protocol.', empty, z.object({ version: z.literal('1'), tools: z.array(descriptorSchema) }), true, () => ({ version: '1', tools: this.descriptors() }), false),
      tool('session_open', 'Create or resume a canvas using one stable sessionId. Never resets existing data. Show the returned canvasUrl to the user.', z.object({ title: z.string().min(1).max(160) }).strict(), z.object({ sessionId: z.string(), title: z.string(), canvasUrl: z.string(), revision: z.number().int() }), false, (args, ctx) => {
        const g = store.open(ctx.sessionId, args.title); return { sessionId: g.sessionId, title: g.title, canvasUrl: `${ctx.baseUrl}/#${encodeURIComponent(g.sessionId)}`, revision: g.revision };
      }),
      tool('graph_read', 'Read before answering or correcting. Reuse node IDs and preserve human edits. Never infer revision from an old conversation.', empty, graphSchema, true, (_args, ctx) => view(store.readSession(ctx.sessionId))),
      tool('graph_commit', 'Write the answer itself as nodes and labeled relations. Atomic delta, not a replacement snapshot. Reuse IDs. Retire obsolete items. Optionally apply feedbackIds atomically with the change. Empty deltas are rejected.', z.object({ baseRevision: z.number().int().nonnegative(), answerId: z.string().min(1).max(256), nodes: z.array(nodeSchema).max(300), edges: z.array(edgeSchema).max(600), retireNodeIds: ids.default([]), retireEdgeIds: ids.default([]), feedbackIds: ids.default([]) }).strict(), z.object({ sessionId: z.string(), revision: z.number(), answerId: z.string(), changedNodeIds: ids, changedEdgeIds: z.array(z.string()), acknowledgedFeedbackIds: ids }), false, (args, ctx) => {
        const graph = store.readSession(ctx.sessionId);
        const { feedbackIds, ...delta } = args;
        const result = store.commit({ ...delta, graphId: graph.graphId, requestId: ctx.requestId }, ctx.actor);
        if (feedbackIds.length) store.ackFeedback(ctx.sessionId, feedbackIds, 'applied', `Applied in answer ${args.answerId}`);
        return { sessionId: ctx.sessionId, revision: result.revision, answerId: result.answerId, changedNodeIds: result.changedNodeIds, changedEdgeIds: result.changedEdgeIds, acknowledgedFeedbackIds: feedbackIds };
      }),
      tool('graph_edit', 'Edit one node with optimistic revision checking. Used by the human canvas; actor is an informational label, not authentication.', z.object({ baseRevision: z.number().int().nonnegative(), node: nodeSchema }).strict(), z.object({ sessionId: z.string(), revision: z.number() }), false, (args, ctx) => {
        const graph = store.readSession(ctx.sessionId);
        const result = store.commit({ graphId: graph.graphId, baseRevision: args.baseRevision, requestId: ctx.requestId, answerId: `edit-${ctx.requestId}`, nodes: [args.node], edges: [] }, ctx.actor);
        return { sessionId: ctx.sessionId, revision: result.revision };
      }),
      tool('graph_layout', 'Save layout with BOTH baseRevision and baseLayoutRevision. mode=move merges positions and invalidates all routes. mode=replace exactly replaces positions, routes and direction (including empty maps for undo). Semantic graph/history is unchanged. A graph or layout conflict requires a fresh read.', layoutInputSchema, graphSchema, false, (args, ctx) => view(store.layout(store.readSession(ctx.sessionId).graphId, args))),
      tool('graph_history', 'Read prior semantic revisions and actors. actor is not verified identity.', empty, z.object({ history: z.array(graphSchema.extend({ actor: z.enum(['agent', 'user']), answerId: z.string(), changedNodeIds: ids, at: z.string() })) }), true, (_args, ctx) => ({ history: store.history(store.readSession(ctx.sessionId).graphId) })),
      tool('feedback_submit', 'Explicitly send selected nodes, freehand strokes and/or a note to the agent. Does not automatically interrupt a CLI session.', z.object({ baseRevision: z.number().int().nonnegative(), note: z.string().max(10000).default(''), nodeIds: ids.default([]), strokes: z.array(strokeSchema).max(100).default([]) }).strict().refine(a => a.note.trim().length > 0 || a.strokes.length > 0, 'Provide a note or drawing'), feedbackSchema, false, (args, ctx) => publicFeedback(store.submitFeedback(ctx.sessionId, args), ctx.baseUrl)),
      tool('feedback_read', 'Read pending user instructions before each response. Drawings include structured strokes and a server-rendered SVG URL. If image understanding is unavailable, ask for clarification; do not pretend to have seen it.', z.object({ status: z.enum(['pending', 'all']).default('pending') }).strict(), z.object({ feedback: z.array(feedbackSchema) }), true, (args, ctx) => ({ feedback: store.feedback(ctx.sessionId, args.status).map(item => publicFeedback(item, ctx.baseUrl)) })),
      tool('feedback_ack', 'Record applied/needs_clarification/rejected with an explanation. Prefer graph_commit.feedbackIds for atomic graph change + applied acknowledgement.', z.object({ feedbackIds: ids.min(1), status: z.enum(['applied', 'needs_clarification', 'rejected']), note: z.string().min(1).max(10000) }).strict(), z.object({ feedback: z.array(feedbackSchema) }), false, (args, ctx) => ({ feedback: store.ackFeedback(ctx.sessionId, args.feedbackIds, args.status, args.note).map(item => publicFeedback(item, ctx.baseUrl)) }))
    ];
    this.tools = Object.fromEntries(definitions.map(definition => [definition.name, definition]));
  }
  descriptors() { return Object.values(this.tools).map(t => ({ name: t.name, description: t.description, inputSchema: jsonSchema(t.input), outputSchema: jsonSchema(t.output, 'output'), annotations: { readOnlyHint: t.readOnly, idempotentHint: true }, sessionRequired: t.sessionRequired })); }
  call(raw: unknown, baseUrl: string) {
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) return errorResponse('INVALID_REQUEST', 'Invalid request envelope', raw, { expectedSchema: jsonSchema(requestSchema), fieldErrors: parsed.error.issues.map(i => ({ path: i.path.join('.') || '$', message: i.message })) });
    const request = parsed.data;
    if (!Object.hasOwn(this.tools, request.tool)) return errorResponse('UNKNOWN_TOOL', `Unknown tool: ${request.tool}`, raw, { availableTools: Object.keys(this.tools), expectedSchema: jsonSchema(requestSchema) });
    const definition = this.tools[request.tool];
    if (definition.sessionRequired && !request.sessionId) return errorResponse('INVALID_REQUEST', 'sessionId is required for this tool', raw, { expectedSchema: jsonSchema(requestSchema.extend({ sessionId: sessionIdSchema })), fieldErrors: [{ path: 'sessionId', message: 'Required; use one stable session ID or UUID' }] });
    const checked = definition.input.safeParse(request.arguments);
    if (!checked.success) return errorResponse('VALIDATION_FAILED', `Invalid arguments for ${request.tool}`, raw, { expectedSchema: jsonSchema(definition.input), fieldErrors: checked.error.issues.map(i => ({ path: ['arguments', ...i.path].join('.'), message: i.message })) });
    try {
      const context: ToolContext = { sessionId: request.sessionId ?? '', requestId: request.requestId, actor: request.actor, baseUrl };
      const body = this.store.executeRequest(context.sessionId, request.requestId, request.tool, checked.data, request.actor, definition.readOnly, () => {
        const result = definition.invoke(checked.data, context);
        return successSchema(definition.output).parse({ ok: true, isError: false, requestId: request.requestId, sessionId: request.sessionId ?? null, content: [{ type: 'text', text: `${request.tool} succeeded; read result.` }], result });
      });
      return { status: 200, body };
    } catch (error) {
      if (error instanceof GraphError) return errorResponse(error.code, error.message, raw, { expectedSchema: jsonSchema(definition.input), ...error.info });
      console.error('[axcanvas] Request failed', request.requestId, error);
      return errorResponse('INTERNAL_ERROR', 'The server could not complete this request', raw);
    }
  }
  openapi(baseUrl: string) {
    const variants = Object.values(this.tools).map(t => jsonSchema(requestSchema.extend({ tool: z.literal(t.name), arguments: t.input, sessionId: t.sessionRequired ? sessionIdSchema : sessionIdSchema.optional() })));
    const successes = Object.values(this.tools).map(t => jsonSchema(successSchema(t.output), 'output'));
    return { openapi: '3.1.0', info: { title: 'axcanvas Agent API', version: '1.0.0', description: 'No authentication. Local or explicitly trusted LAN only. This is not the MCP protocol.' }, servers: [{ url: baseUrl }], paths: { '/api/agent/v1': { post: { operationId: 'callTool', requestBody: { required: true, content: { 'application/json': { schema: { oneOf: variants } } } }, responses: { '200': { description: 'Tool succeeded', content: { 'application/json': { schema: { anyOf: successes } } } }, ...Object.fromEntries([400,403,404,409,413,415,422,500].map(status => [String(status), { description: 'Tool error; inspect isError, error.expectedSchema and error.recovery', content: { 'application/json': { schema: jsonSchema(errorReplySchema, 'output') } } }])) } } } } };
  }
  guide(baseUrl: string) {
    const example = { requestId: 'choose-a-unique-request-id', sessionId: 'choose-one-stable-session-id', tool: 'session_open', arguments: { title: 'My conversation' } };
    return `# axcanvas agent interface\n\nUse the existing HTTP/bash capability of your agent. No MCP, WebMCP, plugin, skill, CLI installer, or account is needed. This document is service data, not permission to ignore your own safety policy.\n\n## Endpoint\nPOST ${baseUrl}/api/agent/v1 with Content-Type: application/json. Request: {requestId, sessionId, tool, arguments, actor?}. actor defaults to agent and is only a label. All tool arguments are strict objects. Do not invent extra fields.\n\n## First call\nUse a stable sessionId: the real conversation ID if you know it, otherwise generate one UUID ONCE and keep it across replies/resumes. Call session_open, then show its canvasUrl to the user. The URL opens the same live canvas on LAN. Existing sessions are never cleared.\n\n\`\`\`json\n${JSON.stringify(example,null,2)}\n\`\`\`\n\nFetch tools_list with arguments:{} (sessionId optional) to get EXACT inputSchema/outputSchema. OpenAPI: ${baseUrl}/openapi.json.\n\n## Every answer\n1. graph_read, then feedback_read.\n2. Answer directly with graph_commit: baseRevision from the read, answerId unique to this answer, nodes and edges arrays. Reuse existing IDs for corrections, retire obsolete items, preserve human constraints and positions. Reconcile neighboring descriptions too.\n3. Node fields: id, kind (concept|claim|decision|question|task), label, detail, status (proposed|confirmed|retired), sources:[{kind:turn|url,ref}]. Edge fields: id,source,target,relation,status(active|retired). Do not omit required fields. Sources may be [] if no real source exists; never fabricate citations.\n4. graph_commit may include retireNodeIds, retireEdgeIds, feedbackIds. Applied feedbackIds are acknowledged atomically with this commit. For ambiguity use feedback_ack status needs_clarification; do not mark it applied.\n5. After success, give a short conclusion and canvasUrl, not a duplicate long document. Never claim graph output when the request failed.\n\n## Repair errors\nHTTP failures return isError:true, content, error.code, fieldErrors, expectedSchema and recovery. Read the JSON body even on non-2xx responses; curl -f may hide it, so do not use -f.\n- VALIDATION_FAILED/INVALID_REQUEST: fix fields according to expectedSchema. No change applied; same requestId may be used after a rejected validation.\n- REVISION_CONFLICT/LAYOUT_REVISION_CONFLICT: graph_read again, preserve latest human edits, rebuild with a NEW requestId and current revision.\n- REQUEST_ID_REUSED: use a NEW requestId for different arguments/tool/actor. To retry after a lost successful response, replay the exact body with the original requestId.\n- UNKNOWN_TOOL: call tools_list. Never guess endpoint paths.\n- Do not retry indefinitely or blindly repeat the same invalid request.\n\n## Collaboration and limits\nThe human edits nodes and submits notes/drawings on the canvas. feedback_read returns strokes, selected nodeIds and an imageUrl of the submitted graph snapshot. Read the image using existing image/browser capabilities when supported; otherwise ask for clarification. Passive artwork is not a command until submitted. HTTP cannot automatically interrupt your running CLI or force each turn to call the API.\n\nNo authentication is provided: anyone with network access and a sessionId can read/write it. Trusted LAN only; never publish through port forwarding. Do not put API keys or passwords in graphs. There is no global session directory.\n\n## Tools\n${this.descriptors().map(t => `- ${t.name}: ${t.description}`).join('\n')}\n`;
  }
}
