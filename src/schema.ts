import { z } from 'zod';

const id = z.string().min(1).max(256);
export const nodeSchema = z.object({
  id,
  kind: z.enum(['concept', 'claim', 'decision', 'question', 'task']),
  label: z.string().min(1).max(160),
  detail: z.string().max(20000),
  status: z.enum(['proposed', 'confirmed', 'retired']),
  sources: z.array(z.object({ kind: z.enum(['turn', 'url']), ref: z.string().min(1).max(2000) }).strict()).max(40)
}).strict();
export const edgeSchema = z.object({
  id, source: id, target: id,
  relation: z.string().min(1).max(160),
  status: z.enum(['active', 'retired'])
}).strict();
const idSet = z.array(id).max(1000).refine(items => new Set(items).size === items.length, 'IDs must be unique');
export const flowSchema = z.object({
  id, scope: z.enum(['graph', 'turn', 'custom']), label: z.string().min(1).max(160),
  status: z.enum(['active', 'retired']).default('active'), turnId: id.optional(),
  nodeIds: idSet.default([]), edgeIds: idSet.default([]), startNodeIds: idSet.default([]), endNodeIds: idSet.default([])
}).strict().superRefine((flow, ctx) => {
  if (flow.scope === 'turn' ? !flow.turnId : flow.turnId !== undefined) ctx.addIssue({ code: 'custom', path: ['turnId'], message: 'turnId is required only for turn scope' });
  if (flow.scope === 'graph' && (flow.nodeIds.length || flow.edgeIds.length)) ctx.addIssue({ code: 'custom', path: ['nodeIds'], message: 'Graph scope implicitly includes all active content; leave member lists empty' });
});
export type Flow = z.infer<typeof flowSchema>;
export const openSchema = z.object({ sessionId: id, title: z.string().min(1).max(160) }).strict();
export const commitSchema = z.object({
  graphId: id,
  baseRevision: z.number().int().nonnegative(),
  requestId: id,
  answerId: id,
  nodes: z.array(nodeSchema).max(300),
  edges: z.array(edgeSchema).max(600),
  retireNodeIds: z.array(id).max(300).default([]),
  retireEdgeIds: z.array(id).max(600).default([]),
  flows: z.array(flowSchema).max(300).optional(), retireFlowIds: idSet.optional()
}).strict();
export const positionSchema = z.object({ x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000) }).strict();
export const routeSchema = z.object({
  sections: z.array(z.array(positionSchema).min(2).max(1000)).min(1).max(50),
  label: positionSchema.extend({ width: z.number().finite().positive().max(10000), height: z.number().finite().positive().max(10000), text: z.string().max(160) }).strict()
}).strict();
export const viewLayoutSchema = z.object({ positions: z.record(id, positionSchema), routes: z.record(id, routeSchema), direction: z.enum(['RIGHT', 'DOWN']).nullable() }).strict();
export type ViewLayout = z.infer<typeof viewLayoutSchema>;
export const layoutSchema = z.object({
  graphId: id, baseRevision: z.number().int().nonnegative(), baseLayoutRevision: z.number().int().nonnegative(),
  flowId: id.nullable().optional(),
  mode: z.enum(['move', 'replace']).default('move'), positions: z.record(id, positionSchema),
  routes: z.record(id, routeSchema).default({}), direction: z.enum(['RIGHT', 'DOWN']).nullable().default(null)
}).strict();
export const layoutInputSchema = layoutSchema.omit({ graphId: true });
export type LayoutChange = z.input<typeof layoutInputSchema>;
export type EdgeRoute = z.infer<typeof routeSchema>;
export type GraphNode = z.infer<typeof nodeSchema>;
export type GraphEdge = z.infer<typeof edgeSchema>;
export type CommitInput = z.input<typeof commitSchema>;
export type Position = z.infer<typeof positionSchema>;
export type Graph = {
  graphId: string; sessionId: string; title: string; revision: number;
  nodes: GraphNode[]; edges: GraphEdge[];
  positions: Record<string, Position>; layoutRevision: number;
  routes: Record<string, EdgeRoute>; layoutDirection: 'RIGHT' | 'DOWN' | null;
  flows: Flow[]; flowLayouts: Record<string, ViewLayout>;
};
export type CommitResult = { graphId: string; revision: number; answerId: string; changedNodeIds: string[]; changedEdgeIds: string[]; changedFlowIds: string[] };

export type Stroke = { points: Position[] };
export type Feedback = {
  id: string; sessionId: string; graphRevision: number; nodeIds: string[]; note: string; strokes: Stroke[];
  status: 'pending' | 'applied' | 'needs_clarification' | 'rejected'; resolution: string;
  createdAt: string; capture: Graph;
  captureFlowId?: string | null;
  review?: Review;
};

export const graphViewSchema = z.object({
  sessionId: z.string(), title: z.string(), revision: z.number().int().nonnegative(),
  nodes: z.array(nodeSchema), edges: z.array(edgeSchema), positions: z.record(id, positionSchema),
  layoutRevision: z.number().int().nonnegative(), routes: z.record(id, routeSchema),
  flows: z.array(flowSchema).default([]), flowLayouts: z.record(id, viewLayoutSchema).default({}),
  layoutDirection: z.enum(['RIGHT', 'DOWN']).nullable()
}).strict();
export type GraphView = z.infer<typeof graphViewSchema>;
export const strokeSchema = z.object({ points: z.array(positionSchema).min(2).max(2000) }).strict();
export const changeSchema = z.object({
  entity: z.enum(['node', 'edge', 'position', 'layout', 'flow', 'flow_layout', 'instruction']), id,
  change: z.enum(['added', 'modified', 'retired', 'removed']),
  before: z.unknown().nullable(), after: z.unknown().nullable()
}).strict();
export type ReviewChange = z.infer<typeof changeSchema>;
export const reviewSchema = z.object({
  draftId: id, baseRevision: z.number().int().nonnegative(), baseLayoutRevision: z.number().int().nonnegative(),
  changes: z.array(changeSchema), before: graphViewSchema, after: graphViewSchema
}).strict();
export type Review = z.infer<typeof reviewSchema>;
export const draftLeafOperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('node'), node: nodeSchema, position: positionSchema.optional(), flowId: id.nullable().optional() }).strict(),
  z.object({ type: z.literal('edge'), edge: edgeSchema, flowId: id.nullable().optional() }).strict(),
  z.object({ type: z.literal('flow'), flow: flowSchema }).strict(),
  z.object({ type: z.literal('retire_flow'), flowId: id }).strict(),
  z.object({ type: z.literal('retire_node'), nodeId: id }).strict(),
  z.object({ type: z.literal('retire_edge'), edgeId: id }).strict(),
  z.object({ type: z.literal('move'), nodeId: id, position: positionSchema, flowId: id.nullable().optional() }).strict(),
  z.object({ type: z.literal('layout'), positions: z.record(id, positionSchema), routes: z.record(id, routeSchema), direction: z.enum(['RIGHT', 'DOWN']).nullable(), flowId: id.nullable().optional() }).strict(),
  z.object({ type: z.literal('instruction'), note: z.string().max(10000), strokes: z.array(strokeSchema).max(100), nodeIds: z.array(id).max(300), flowId: id.nullable().optional() }).strict()
]);
export type DraftLeafOperation = z.infer<typeof draftLeafOperationSchema>;
export const draftOperationSchema = z.union([
  draftLeafOperationSchema,
  z.object({ type: z.literal('batch'), operations: z.array(draftLeafOperationSchema).min(1).max(300) }).strict()
]);
export type DraftOperation = z.infer<typeof draftOperationSchema>;
export const draftIdSchema = z.object({ draftId: id }).strict();
export const draftVersionSchema = draftIdSchema.extend({ baseDraftVersion: z.number().int().nonnegative() }).strict();
export const draftChangeSchema = draftVersionSchema.extend({ operation: draftOperationSchema, editGroup: z.string().min(1).max(128).optional() }).strict();
export const draftRebaseSchema = draftVersionSchema.extend({
  baseRevision: z.number().int().nonnegative(), baseLayoutRevision: z.number().int().nonnegative(),
  resolution: z.enum(['fail', 'draft', 'latest'])
}).strict();
export const draftViewSchema = z.object({
  id, sessionId: z.string(), version: z.number().int().nonnegative(), state: z.enum(['editing', 'submitted', 'discarded']),
  baseRevision: z.number().int().nonnegative(), baseLayoutRevision: z.number().int().nonnegative(),
  graph: graphViewSchema, note: z.string(), strokes: z.array(strokeSchema), nodeIds: z.array(id),
  captureFlowId: id.nullable().default(null),
  canUndo: z.boolean(), canRedo: z.boolean()
}).strict();
export type DraftView = z.infer<typeof draftViewSchema>;
export const draftReviewSchema = z.object({
  draftId: id, version: z.number().int().nonnegative(), token: z.string(), changes: z.array(changeSchema),
  baseRevision: z.number().int().nonnegative(), baseLayoutRevision: z.number().int().nonnegative(),
  conflict: z.boolean(), canSubmit: z.boolean()
}).strict();
