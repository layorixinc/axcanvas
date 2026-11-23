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
export const openSchema = z.object({ sessionId: id, title: z.string().min(1).max(160) }).strict();
export const commitSchema = z.object({
  graphId: id,
  baseRevision: z.number().int().nonnegative(),
  requestId: id,
  answerId: id,
  nodes: z.array(nodeSchema).max(300),
  edges: z.array(edgeSchema).max(600),
  retireNodeIds: z.array(id).max(300).default([]),
  retireEdgeIds: z.array(id).max(600).default([])
}).strict();
export const positionSchema = z.object({ x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000) }).strict();
export const routeSchema = z.object({
  sections: z.array(z.array(positionSchema).min(2).max(1000)).min(1).max(50),
  label: positionSchema.extend({ width: z.number().finite().positive().max(10000), height: z.number().finite().positive().max(10000), text: z.string().max(160) }).strict()
}).strict();
export const layoutSchema = z.object({
  graphId: id, baseRevision: z.number().int().nonnegative(), baseLayoutRevision: z.number().int().nonnegative(),
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
};
export type CommitResult = { graphId: string; revision: number; answerId: string; changedNodeIds: string[]; changedEdgeIds: string[] };

export type Stroke = { points: Position[] };
export type Feedback = {
  id: string; sessionId: string; graphRevision: number; nodeIds: string[]; note: string; strokes: Stroke[];
  status: 'pending' | 'applied' | 'needs_clarification' | 'rejected'; resolution: string;
  createdAt: string; capture: Graph;
};
