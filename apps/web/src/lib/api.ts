import type { Edge, Node } from "@xyflow/react";
import {accountHeaders} from "./auth-identity";

export type ConceptData = { label: string; subtitle: string; category: string; note: string; discovery_origins?: { node_id: string; release_id: string }[] };
export type ConceptNode = Node<ConceptData, "knowledge">;
export type GraphPayload = { nodes: ConceptNode[]; edges: Edge[] };
export type Snapshot = { revision: number; release_id: string; payload: GraphPayload; note: string; created_at: string; restored_from: number | null };
export type Version = Omit<Snapshot, "payload" | "release_id">;
export type Entity = { id: string; name: string; aliases: string[]; domain_ids: string[] };
export type Catalog = { release_id: string; version: string; status: string; entities: Entity[] };
export type Attempt = { id: string; created_at?: string; prediction_correct: boolean; explanation?: string; message: string; status: string; next_step: string };

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function request<T>(path: string, body?: unknown): Promise<T> {
  const signal = AbortSignal.timeout(8000);
  const response = await fetch(`/api/v1${path}`, body === undefined ? { cache: "no-store", headers:accountHeaders(),signal } : {
    method: "POST", headers: { "Content-Type": "application/json","X-LearnAI-Request":"1",...accountHeaders() }, body: JSON.stringify(body), signal,
  });
  if (!response.ok) {
    if(response.status===401&&typeof window!=="undefined")window.dispatchEvent(new Event("learnai-auth-expired"));
    const result = await response.json().catch(() => ({}));
    const detail = result.detail;
    throw new ApiError(response.status, typeof detail === "string" ? detail : detail?.message ?? "请求未完成，请稍后重试。你的草稿仍保留。");
  }
  return response.json();
}
