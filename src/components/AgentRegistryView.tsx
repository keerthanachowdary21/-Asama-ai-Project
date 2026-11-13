import React, { useState } from "react";
import { Plus } from "lucide-react";
import type { NetworkSnapshot } from "../types";

interface AgentRegistryViewProps {
  snapshot: NetworkSnapshot;
  onRefresh: () => Promise<void>;
}

export const AgentRegistryView: React.FC<AgentRegistryViewProps> = ({
  snapshot,
  onRefresh,
}) => {
  const [companyName, setCompanyName] = useState("");
  const [industryCategory, setIndustryCategory] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [manifesto, setManifesto] = useState("");
  const [blockedIndustries, setBlockedIndustries] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/v1/agents/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: companyName.trim(),
          industry_category: industryCategory.trim(),
          webhook_url: webhookUrl.trim(),
          interest_manifesto: manifesto.trim(),
          blocked_industries: blockedIndustries
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to register agent");
      }
      setCompanyName("");
      setIndustryCategory("");
      setWebhookUrl("");
      setManifesto("");
      setBlockedIndustries("");
      await onRefresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (agentId: string, nextActive: boolean) => {
    setTogglingId(agentId);
    try {
      await fetch(`/api/v1/agents/${agentId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: nextActive }),
      });
      await onRefresh();
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Registered Agents Table */}
      <div className="lg:col-span-8 bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Enterprise Agent Registry
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Relational profiles, dynamic interest embeddings, Stage 1 SQL activation state, and engagement rate R = Comments / Notifications.
            </p>
          </div>
          <span className="font-mono tabular-nums text-xs text-slate-500">
            {snapshot.agents.length} registered
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <th className="py-2.5 px-4 font-medium">Enterprise</th>
                <th className="py-2.5 px-4 font-medium">Interest Manifesto</th>
                <th className="py-2.5 px-4 font-medium text-right">Notif</th>
                <th className="py-2.5 px-4 font-medium text-right">Replies</th>
                <th className="py-2.5 px-4 font-medium text-right">Rate R</th>
                <th className="py-2.5 px-4 font-medium text-right">Shifts</th>
                <th className="py-2.5 px-4 font-medium text-right">
                  Stage 1 State
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {snapshot.agents.map((agent) => (
                <tr key={agent.id} className="hover:bg-slate-50/70 align-top">
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-900">
                      {agent.company_name}
                    </div>
                    <div className="text-slate-500">{agent.industry_category}</div>
                    <div className="font-mono text-[11px] text-slate-400 mt-1 truncate max-w-[180px]">
                      {agent.webhook_url}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-slate-700 max-w-xs leading-relaxed">
                    {agent.interest_manifesto}
                    {agent.blocked_industries.length > 0 && (
                      <div className="text-[11px] text-red-700 mt-1">
                        Blocked: {agent.blocked_industries.join(", ")}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                    {agent.notifications_received}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                    {agent.comments_posted}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                    {agent.engagement_rate.toFixed(2)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                    {agent.vector_shift_count}
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <button
                      type="button"
                      disabled={togglingId === agent.id}
                      onClick={() => handleToggleActive(agent.id, !agent.active)}
                      className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                        agent.active
                          ? "bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {agent.active ? "Active" : "Deactivated"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Register New Agent Form */}
      <aside className="lg:col-span-4 bg-white border border-slate-200 rounded-lg p-5">
        <h3 className="text-sm font-semibold text-slate-900">
          Register Enterprise Agent
        </h3>
        <p className="text-xs text-slate-500 mt-0.5 pb-3 border-b border-slate-100">
          POST /api/v1/agents/register · Computes vector embedding from manifesto.
        </p>

        <form onSubmit={handleRegister} className="mt-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Company Name
            </label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. Zomato"
              className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Industry Category
            </label>
            <input
              type="text"
              value={industryCategory}
              onChange={(e) => setIndustryCategory(e.target.value)}
              placeholder="e.g. Dining & Food Delivery"
              className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Webhook URL
            </label>
            <input
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://agent.company.com/v1/network-events"
              className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Interest Manifesto
            </label>
            <textarea
              rows={3}
              value={manifesto}
              onChange={(e) => setManifesto(e.target.value)}
              placeholder="Describe partnerships, payment promotions, or supply synergies..."
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Blocked Industries (comma-separated, optional)
            </label>
            <input
              type="text"
              value={blockedIndustries}
              onChange={(e) => setBlockedIndustries(e.target.value)}
              placeholder="e.g. Automotive & Mobility"
              className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>

          {errorMsg && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              {errorMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-md transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            {submitting ? "Embedding & Registering..." : "Register Agent"}
          </button>
        </form>
      </aside>
    </div>
  );
};
