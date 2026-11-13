import { useCallback, useEffect, useRef, useState } from "react";
import { AgentRegistryView } from "./components/AgentRegistryView";
import { HardwareAssistantView } from "./components/HardwareAssistantView";
import { NetworkFeedView } from "./components/NetworkFeedView";
import { RoutingEngineView } from "./components/RoutingEngineView";
import type { NetworkSnapshot } from "./types";

type WorkspaceTab = "network" | "routing" | "registry" | "hardware";

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("network");
  const [snapshot, setSnapshot] = useState<NetworkSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);

  const composerTitleRef = useRef<HTMLInputElement | null>(null);

  const fetchSnapshot = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/network/snapshot");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as NetworkSnapshot;
      setSnapshot(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Failed to load network state"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSnapshot();
  }, [fetchSnapshot]);

  const handlePrimaryAction = () => {
    setActiveTab("network");
    setTimeout(() => {
      composerTitleRef.current?.focus();
    }, 50);
  };

  const handleInspectRouting = (postId: string) => {
    setSelectedPostId(postId);
    setActiveTab("routing");
  };

  const navItems: Array<{ id: WorkspaceTab; label: string }> = [
    { id: "network", label: "Agent Network" },
    { id: "routing", label: "Routing Engine" },
    { id: "registry", label: "Agent Registry" },
    { id: "hardware", label: "Hardware Q&A" },
  ];

  const isHardware = activeTab === "hardware";

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* 3-Zone Top Bar Contract */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-[1380px] mx-auto px-6 h-14 flex items-center justify-between gap-8">
          {/* Zone 1: Single-element wordmark */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab("network");
            }}
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            Asama.ai
          </a>

          {/* Zone 2: 4 concise single-line nav links */}
          <nav className="flex items-center gap-6 overflow-x-auto">
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`py-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                    isActive
                      ? "text-slate-900 border-slate-900"
                      : "text-slate-500 border-transparent hover:text-slate-900"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="shrink-0">
            <button
              type="button"
              onClick={handlePrimaryAction}
              className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              Publish Post
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 max-w-[1380px] w-full mx-auto px-6 py-6 space-y-6">
        {/* Contextual System Header */}
        <div className="flex flex-wrap items-end justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <div className="text-xs text-slate-500">
              {isHardware
                ? "Problem 2 · Local Linux Hardware Q&A Assistant"
                : "Problem 1 · B2B Social Network for AI Agents"}
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 mt-0.5 text-balance">
              {isHardware
                ? "Deterministic Allow-Listed Hardware Inspection & Tool Calling"
                : "Multi-Stage Semantic Relevance Routing & Signed Webhook Network"}
            </h1>
          </div>

          {!isHardware && snapshot && (
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 font-mono tabular-nums">
              <span>{snapshot.agents.length} Agents</span>
              <span aria-hidden="true">·</span>
              <span>{snapshot.posts.length} Posts</span>
              <span aria-hidden="true">·</span>
              <span>Threshold ≥ {snapshot.config.rerank_threshold}</span>
            </div>
          )}
        </div>

        {activeTab === "hardware" ? (
          <HardwareAssistantView />
        ) : loading ? (
          <div className="space-y-4">
            <div className="h-44 bg-white border border-slate-200 rounded-lg animate-pulse" />
            <div className="h-64 bg-white border border-slate-200 rounded-lg animate-pulse" />
          </div>
        ) : loadError || !snapshot ? (
          <div className="bg-white border border-red-200 rounded-lg p-6 text-sm text-red-700">
            {loadError || "Unable to load agent network state."}
          </div>
        ) : activeTab === "network" ? (
          <NetworkFeedView
            snapshot={snapshot}
            onRefresh={fetchSnapshot}
            onInspectRouting={handleInspectRouting}
            composerRef={composerTitleRef}
          />
        ) : activeTab === "routing" ? (
          <RoutingEngineView
            snapshot={snapshot}
            selectedPostId={selectedPostId}
            onSelectPost={setSelectedPostId}
            onRefresh={fetchSnapshot}
          />
        ) : (
          <AgentRegistryView snapshot={snapshot} onRefresh={fetchSnapshot} />
        )}
      </main>
    </div>
  );
}
