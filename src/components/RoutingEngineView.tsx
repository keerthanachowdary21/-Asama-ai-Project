import React, { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, XCircle } from "lucide-react";
import type { NetworkSnapshot, PostItem } from "../types";

interface RoutingEngineViewProps {
  snapshot: NetworkSnapshot;
  selectedPostId: string | null;
  onSelectPost: (postId: string) => void;
  onRefresh: () => Promise<void>;
}

export const RoutingEngineView: React.FC<RoutingEngineViewProps> = ({
  snapshot,
  selectedPostId,
  onSelectPost,
  onRefresh,
}) => {
  const cleanPosts = snapshot.posts.filter(
    (p) => p.sanitization_status === "CLEAN"
  );
  const activePost: PostItem | undefined =
    cleanPosts.find((p) => p.id === selectedPostId) ?? cleanPosts[0];

  const [busyId, setBusyId] = useState<string | null>(null);
  const [shiftFeedback, setShiftFeedback] = useState<{
    agentName: string;
    before: number;
    after: number;
  } | null>(null);

  useEffect(() => {
    if (!selectedPostId && cleanPosts[0]) {
      onSelectPost(cleanPosts[0].id);
    }
  }, [selectedPostId, cleanPosts, onSelectPost]);

  const handleNegativeShift = async (logId: string, agentName: string) => {
    setBusyId(logId);
    setShiftFeedback(null);
    try {
      const res = await fetch(`/api/v1/routing-logs/${logId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome: "IGNORED" }),
      });
      const data = await res.json();
      if (res.ok) {
        setShiftFeedback({
          agentName,
          before: data.similarity_before,
          after: data.similarity_after,
        });
        await onRefresh();
      }
    } finally {
      setBusyId(null);
    }
  };

  if (!activePost) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-8 text-center">
        <p className="text-sm font-medium text-slate-700">
          No routed posts available yet.
        </p>
        <p className="text-xs text-slate-500 mt-1">
          Publish a post in the Agent Network feed to inspect the 3-stage semantic relevance pipeline.
        </p>
      </div>
    );
  }

  const stage1Logs = activePost.routing_logs;
  const stage2Logs = activePost.routing_logs.filter((l) => l.stage1_passed);
  const stage3Notified = stage2Logs.filter(
    (l) => l.rerank_score >= snapshot.config.rerank_threshold
  );

  return (
    <div className="space-y-6">
      {/* Post Selector */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            3-Stage Semantic Relevance Routing Trace
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Inspect Stage 1 SQL filters, Stage 2 ANN Cosine Similarity, and Stage 3 LLM Reranker cutoff (≥{" "}
            <span className="font-mono tabular-nums">
              {snapshot.config.rerank_threshold}
            </span>
            ).
          </p>
        </div>

        <select
          value={activePost.id}
          onChange={(e) => onSelectPost(e.target.value)}
          className="h-9 px-3 text-sm bg-white border border-slate-300 rounded-md max-w-md"
        >
          {cleanPosts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.author_company_name}: {p.title}
            </option>
          ))}
        </select>
      </div>

      {/* Funnel Summary Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Stage 1 · SQL Metadata Guardrails</span>
            <span className="font-mono tabular-nums">
              {activePost.pipeline_metrics.stage1_ms} ms
            </span>
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-2">
            {activePost.pipeline_metrics.stage1_eligible}{" "}
            <span className="text-sm font-normal text-slate-500">
              / {activePost.pipeline_metrics.total_agents} agents
            </span>
          </div>
          <p className="text-xs text-slate-600 mt-1">
            Excludes author agent, deactivated profiles, and blocked industry categories.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Stage 2 · Dense Vector ANN Search</span>
            <span className="font-mono tabular-nums">
              {activePost.pipeline_metrics.stage2_ms} ms
            </span>
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-2">
            {activePost.pipeline_metrics.stage2_candidates}{" "}
            <span className="text-sm font-normal text-slate-500">
              top-K candidates
            </span>
          </div>
          <p className="text-xs text-slate-600 mt-1">
            Cosine similarity S_dense using {activePost.embedding_model} ({activePost.embedding_dims}d).
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Stage 3 · Reranker / LLM Judge</span>
            <span className="font-mono tabular-nums">
              {activePost.pipeline_metrics.stage3_ms} ms
            </span>
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-emerald-700 mt-2">
            {stage3Notified.length}{" "}
            <span className="text-sm font-normal text-slate-500">
              notified (≥ {snapshot.config.rerank_threshold})
            </span>
          </div>
          <p className="text-xs text-slate-600 mt-1">
            Joint relevance evaluation passes strictly structured JSON post data.
          </p>
        </div>
      </div>

      {shiftFeedback && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-900 flex items-center justify-between gap-4">
          <span>
            <span className="font-semibold">Closed-Loop Vector Shift Applied:</span>{" "}
            {shiftFeedback.agentName}&apos;s dynamic preference embedding shifted away from this topic (cosine similarity{" "}
            <span className="font-mono tabular-nums font-semibold">
              {shiftFeedback.before.toFixed(4)}
            </span>{" "}
            <ArrowRight className="inline w-3 h-3" />{" "}
            <span className="font-mono tabular-nums font-semibold">
              {shiftFeedback.after.toFixed(4)}
            </span>
            ).
          </span>
          <button
            type="button"
            onClick={() => setShiftFeedback(null)}
            className="text-amber-800 underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Stage-by-Stage Scoring Comparison Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70">
          <h3 className="text-sm font-semibold text-slate-900">
            Candidate Scoring &amp; Closed-Loop Feedback Breakdown
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600 bg-slate-50">
                <th className="py-2.5 px-4 font-medium">Agent</th>
                <th className="py-2.5 px-4 font-medium">Stage 1 Guardrail</th>
                <th className="py-2.5 px-4 font-medium">Stage 2 S_dense</th>
                <th className="py-2.5 px-4 font-medium">Stage 3 S_final</th>
                <th className="py-2.5 px-4 font-medium">Judge Rationale</th>
                <th className="py-2.5 px-4 font-medium text-right">
                  Feedback Loop
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {stage1Logs.map((log) => {
                const passedS3 =
                  log.stage1_passed &&
                  log.rerank_score >= snapshot.config.rerank_threshold;
                return (
                  <tr key={log.id} className="hover:bg-slate-50/60">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">
                        {log.target_company_name}
                      </div>
                      <div className="text-slate-500">{log.target_industry}</div>
                    </td>
                    <td className="py-3 px-4">
                      {log.stage1_passed ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Pass
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-slate-500">
                          <XCircle className="w-3.5 h-3.5" />
                          {log.stage1_reason}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 w-40">
                      {log.stage1_passed ? (
                        <div className="space-y-1">
                          <div className="font-mono tabular-nums text-slate-800">
                            {log.vector_score.toFixed(4)}
                          </div>
                          <div className="w-full h-1.5 bg-slate-100 rounded overflow-hidden">
                            <div
                              className="h-full bg-slate-600"
                              style={{
                                width: `${Math.round(log.vector_score * 100)}%`,
                              }}
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-400 font-mono">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 w-40">
                      {log.stage1_passed ? (
                        <div className="space-y-1">
                          <div
                            className={`font-mono tabular-nums font-semibold ${
                              passedS3 ? "text-emerald-700" : "text-slate-500"
                            }`}
                          >
                            {log.rerank_score.toFixed(4)}
                          </div>
                          <div className="w-full h-1.5 bg-slate-100 rounded overflow-hidden">
                            <div
                              className={`h-full ${
                                passedS3 ? "bg-emerald-600" : "bg-slate-400"
                              }`}
                              style={{
                                width: `${Math.round(log.rerank_score * 100)}%`,
                              }}
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-400 font-mono">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-700 max-w-sm">
                      {log.rerank_rationale}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      {passedS3 ? (
                        <button
                          type="button"
                          disabled={busyId === log.id}
                          onClick={() =>
                            handleNegativeShift(log.id, log.target_company_name)
                          }
                          className="px-2.5 py-1 text-xs font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 rounded transition-colors disabled:opacity-50"
                        >
                          Simulate Ignored (Shift Vector)
                        </button>
                      ) : (
                        <span className="text-slate-400">Not Notified</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
