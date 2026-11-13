export type RoutingStatus =
  | "NOTIFIED"
  | "ENGAGED"
  | "IGNORED"
  | "DROPPED_STAGE_1"
  | "DROPPED_STAGE_2"
  | "DROPPED_STAGE_3"
  | "FAILED";

export interface AgentSummary {
  id: string;
  company_name: string;
  industry_category: string;
  webhook_url: string;
  interest_manifesto: string;
  embedding_model: string;
  embedding_dims: number;
  blocked_industries: string[];
  active: boolean;
  trust_score: number;
  vector_shift_count: number;
  notifications_received: number;
  engaged_count: number;
  ignored_count: number;
  comments_posted: number;
  engagement_rate: number;
  created_at: string;
}

export interface RoutingLogItem {
  id: string;
  post_id: string;
  target_agent_id: string;
  target_company_name: string;
  target_industry: string;
  target_webhook_url: string;
  stage1_passed: boolean;
  stage1_reason: string;
  vector_score: number;
  rerank_score: number;
  rerank_rationale: string;
  status: RoutingStatus;
  hmac_signature: string | null;
  webhook_payload: string | null;
  created_at: string;
}

export interface CommentItem {
  id: string;
  post_id: string;
  author_agent_id: string;
  author_company_name: string;
  author_industry: string;
  content: string;
  is_autonomous: boolean;
  created_at: string;
}

export interface PostItem {
  id: string;
  author_agent_id: string;
  author_company_name: string;
  author_industry: string;
  title: string;
  content: string;
  embedding_model: string;
  embedding_dims: number;
  sanitization_status: "CLEAN" | "BLOCKED_INJECTION";
  sanitization_reason: string;
  pipeline_metrics: {
    sanitization_ms: number;
    stage1_ms: number;
    stage2_ms: number;
    stage3_ms: number;
    total_ms: number;
    total_agents: number;
    stage1_eligible: number;
    stage2_candidates: number;
    stage3_notified: number;
  };
  expires_at: string | null;
  created_at: string;
  routing_logs: RoutingLogItem[];
  comments: CommentItem[];
}

export interface StreamEventItem {
  id: string;
  event_type:
    | "post.published"
    | "guardrail.blocked"
    | "routing.completed"
    | "webhook.dispatched"
    | "agent.commented"
    | "feedback.vector_shifted";
  entity_id: string;
  summary: string;
  latency_ms: number;
  created_at: string;
}

export interface NetworkSnapshot {
  agents: AgentSummary[];
  posts: PostItem[];
  stream_events: StreamEventItem[];
  config: {
    rerank_threshold: number;
    top_k_candidates: number;
  };
}

export interface ToolCapability {
  tool_name: string;
  binary_path: string;
  args: string[];
  available: boolean;
  privilege_mode: "unprivileged" | "privileged_with_fallback";
  fallback_source: string;
  description: string;
}

export interface HardwareCapabilitiesResponse {
  tools: ToolCapability[];
  kernel_interfaces: Array<{ path: string; readable: boolean }>;
  absent_binaries: string[];
}

export interface ExecutedToolTrace {
  tool_name: string;
  binary_executed: string;
  args: string[];
  shell_spawned: false;
  used_cache: boolean;
  fallback_used: boolean;
  latency_ms: number;
  status: "SUCCESS" | "FALLBACK_SUCCESS" | "REJECTED" | "ERROR";
  raw_stdout_preview: string;
  parsed_json: Record<string, unknown>;
}

export interface HardwareChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  tool_traces?: ExecutedToolTrace[];
  cached_tools?: string[];
  model_used?: string;
  timestamp: string;
}
