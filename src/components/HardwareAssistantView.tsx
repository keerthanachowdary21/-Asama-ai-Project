import React, { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Play,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import type {
  ExecutedToolTrace,
  HardwareCapabilitiesResponse,
  HardwareChatTurn,
} from "../types";

const SAMPLE_QUESTIONS = [
  "Can I upgrade my RAM, and by how much?",
  "What CPU model, architecture, and core count does this Linux host have?",
  "List all block devices and mounted disk usage.",
  "And what about the GPU?",
];

const SECURITY_TESTS = [
  "dmidecode; rm -rf /",
  "lscpu && cat /etc/shadow",
  "get_cpu_info",
];

export const HardwareAssistantView: React.FC = () => {
  const [sessionId] = useState<string>(() =>
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : "hw-session-1"
  );
  const [capabilities, setCapabilities] =
    useState<HardwareCapabilitiesResponse | null>(null);
  const [loadingCaps, setLoadingCaps] = useState(true);

  const [turns, setTurns] = useState<HardwareChatTurn[]>([]);
  const [cachedTools, setCachedTools] = useState<string[]>([]);
  const [inputMsg, setInputMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const [expandedTraceKey, setExpandedTraceKey] = useState<string | null>(null);
  const [directTrace, setDirectTrace] = useState<ExecutedToolTrace | null>(null);
  const [runningTool, setRunningTool] = useState<string | null>(null);

  const [secInput, setSecInput] = useState("dmidecode; rm -rf /");
  const [secResult, setSecResult] = useState<{
    allowed: boolean;
    requested_input: string;
    decision: string;
    reason: string;
  } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/v1/hardware/capabilities");
        if (res.ok) {
          const data = (await res.json()) as HardwareCapabilitiesResponse;
          setCapabilities(data);
        }
      } finally {
        setLoadingCaps(false);
      }
    })();
  }, []);

  const sendQuestion = async (questionText: string) => {
    const trimmed = questionText.trim();
    if (!trimmed || sending) return;

    const userTurn: HardwareChatTurn = {
      id: `u-${Date.now()}`,
      role: "user",
      content: trimmed,
      timestamp: new Date().toISOString(),
    };
    setTurns((prev) => [...prev, userTurn]);
    setInputMsg("");
    setSending(true);
    setChatError(null);

    try {
      const res = await fetch("/api/v1/hardware/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          message: trimmed,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Hardware Q&A request failed");
      }

      const assistantTurn: HardwareChatTurn = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: data.answer,
        tool_traces: data.tool_traces ?? [],
        cached_tools: data.cached_tools ?? [],
        model_used: data.model_used,
        timestamp: new Date().toISOString(),
      };
      setTurns((prev) => [...prev, assistantTurn]);
      setCachedTools(data.cached_tools ?? []);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Failed to query assistant");
    } finally {
      setSending(false);
    }
  };

  const handleResetSession = async () => {
    await fetch("/api/v1/hardware/session/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId }),
    });
    setTurns([]);
    setCachedTools([]);
    setChatError(null);
  };

  const handleRunDirectTool = async (toolName: string) => {
    setRunningTool(toolName);
    try {
      const res = await fetch("/api/v1/hardware/execute-tool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool_name: toolName }),
      });
      if (res.ok) {
        const trace = (await res.json()) as ExecutedToolTrace;
        setDirectTrace(trace);
      }
    } finally {
      setRunningTool(null);
    }
  };

  const handleTestSecurity = async (cmdOverride?: string) => {
    const target = cmdOverride ?? secInput;
    if (cmdOverride) setSecInput(cmdOverride);
    const res = await fetch("/api/v1/hardware/test-security", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requested_command: target }),
    });
    if (res.ok) {
      setSecResult(await res.json());
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left Sidebar: Capability Discovery & Security Gatekeeper */}
      <aside className="lg:col-span-5 space-y-5">
        {/* Startup System Capability Discovery */}
        <section className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="pb-3 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-900">
              Host Capability Discovery &amp; Allow-List Registry
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Probed on this Linux host at runtime. Commands execute directly via execFile with shell=false.
            </p>
          </div>

          {loadingCaps ? (
            <div className="py-6 space-y-2">
              <div className="h-8 bg-slate-100 rounded animate-pulse" />
              <div className="h-8 bg-slate-100 rounded animate-pulse" />
              <div className="h-8 bg-slate-100 rounded animate-pulse" />
            </div>
          ) : capabilities ? (
            <div className="mt-3 divide-y divide-slate-100">
              {capabilities.tools.map((tool) => (
                <div
                  key={tool.tool_name}
                  className="py-2.5 flex items-start justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-slate-900">
                        {tool.tool_name}
                      </span>
                      <span
                        className={
                          tool.privilege_mode === "privileged_with_fallback"
                            ? "text-amber-700 font-medium"
                            : "text-emerald-700 font-medium"
                        }
                      >
                        {tool.privilege_mode === "privileged_with_fallback"
                          ? "Fallback Active"
                          : "Available"}
                      </span>
                    </div>
                    <div className="font-mono text-[11px] text-slate-500 mt-0.5 truncate">
                      {tool.binary_path} {tool.args.join(" ")}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Fallback: {tool.fallback_source}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={runningTool === tool.tool_name}
                    onClick={() => handleRunDirectTool(tool.tool_name)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors whitespace-nowrap shrink-0"
                  >
                    <Play className="w-3 h-3" />
                    {runningTool === tool.tool_name ? "Running..." : "Run"}
                  </button>
                </div>
              ))}

              {/* Kernel Interfaces */}
              <div className="pt-3 mt-1 text-xs">
                <div className="font-medium text-slate-700 mb-1.5">
                  Kernel Interfaces (/proc &amp; /sys)
                </div>
                <div className="grid grid-cols-2 gap-1.5 font-mono text-[11px]">
                  {capabilities.kernel_interfaces.map((ki) => (
                    <div
                      key={ki.path}
                      className="flex items-center justify-between px-2 py-1 bg-slate-50 border border-slate-200/70 rounded"
                    >
                      <span className="truncate text-slate-700">{ki.path}</span>
                      <span
                        className={
                          ki.readable ? "text-emerald-700" : "text-slate-400"
                        }
                      >
                        {ki.readable ? "R" : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </section>

        {/* Direct Tool Execution Output */}
        {directTrace && (
          <section className="bg-white border border-slate-200 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-mono font-semibold text-slate-900">
                {directTrace.tool_name} · {directTrace.status}
              </span>
              <span className="font-mono tabular-nums text-slate-500">
                {directTrace.latency_ms}ms · shell=false
              </span>
            </div>
            <div className="font-mono text-[11px] text-slate-500">
              execFile(&quot;{directTrace.binary_executed}&quot;,{" "}
              {JSON.stringify(directTrace.args)})
            </div>
            <pre className="bg-slate-950 text-slate-100 p-3 rounded font-mono text-[11px] max-h-60 overflow-auto">
              {JSON.stringify(directTrace.parsed_json, null, 2)}
            </pre>
          </section>
        )}

        {/* Allow-List Gatekeeper Tester */}
        <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Allow-List Security Gatekeeper
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Test how arbitrary shell strings or chained commands are blocked before execve.
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {SECURITY_TESTS.map((sample) => (
              <button
                key={sample}
                type="button"
                onClick={() => handleTestSecurity(sample)}
                className="px-2 py-1 font-mono text-[11px] text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
              >
                {sample}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={secInput}
              onChange={(e) => setSecInput(e.target.value)}
              className="flex-1 min-w-0 h-8 px-2.5 font-mono text-xs bg-white border border-slate-300 rounded-md"
              placeholder="Enter command or Tool ID..."
            />
            <button
              type="button"
              onClick={() => handleTestSecurity()}
              className="px-3 h-8 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md whitespace-nowrap shrink-0"
            >
              Verify
            </button>
          </div>

          {secResult && (
            <div
              className={`border rounded-md p-3 text-xs space-y-1 ${
                secResult.allowed
                  ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                  : "bg-red-50 border-red-200 text-red-900"
              }`}
            >
              <div className="flex items-center gap-1.5 font-semibold font-mono">
                {secResult.allowed ? (
                  <ShieldCheck className="w-3.5 h-3.5" />
                ) : (
                  <ShieldAlert className="w-3.5 h-3.5" />
                )}
                <span>{secResult.decision}</span>
              </div>
              <p>{secResult.reason}</p>
            </div>
          )}
        </section>
      </aside>

      {/* Right Main Panel: Conversational Hardware Q&A */}
      <section className="lg:col-span-7 bg-white border border-slate-200 rounded-lg flex flex-col min-h-[680px]">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Local Linux Hardware Q&amp;A Assistant
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Tool-calling pipeline with strict anti-hallucination grounding and session hardware caching.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="font-mono tabular-nums text-xs text-slate-500">
              Cached: {cachedTools.length} tools
            </span>
            <button
              type="button"
              onClick={handleResetSession}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Session
            </button>
          </div>
        </div>

        {/* Sample Prompts Strip */}
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-500 mr-1">Try:</span>
          {SAMPLE_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => sendQuestion(q)}
              disabled={sending}
              className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-100 rounded transition-colors"
            >
              {q}
            </button>
          ))}
        </div>

        {/* Conversation Body */}
        <div className="flex-1 p-5 space-y-4 overflow-y-auto max-h-[540px]">
          {turns.length === 0 ? (
            <div className="py-12 text-center max-w-md mx-auto space-y-2">
              <Terminal className="w-7 h-7 text-slate-400 mx-auto" />
              <p className="text-sm font-medium text-slate-800">
                Ask any hardware question about this Linux host
              </p>
              <p className="text-xs text-slate-500 leading-relaxed">
                Gemini selects only verified allow-listed tools, executes them directly without a subshell, normalizes stdout to JSON, and reports exact facts or explicitly states missing capabilities.
              </p>
            </div>
          ) : (
            turns.map((turn) => (
              <div
                key={turn.id}
                className={`space-y-2 ${
                  turn.role === "user"
                    ? "ml-auto max-w-xl bg-slate-900 text-white rounded-lg px-4 py-3"
                    : "bg-slate-50 border border-slate-200 rounded-lg px-4 py-3.5"
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span
                    className={`font-semibold ${
                      turn.role === "user" ? "text-slate-300" : "text-slate-600"
                    }`}
                  >
                    {turn.role === "user"
                      ? "User Query"
                      : `Hardware Assistant · ${turn.model_used ?? "gemini-4-hydrogen"}`}
                  </span>
                  <span
                    className={`font-mono tabular-nums ${
                      turn.role === "user" ? "text-slate-400" : "text-slate-400"
                    }`}
                  >
                    {new Date(turn.timestamp).toLocaleTimeString()}
                  </span>
                </div>

                <div
                  className={`text-sm leading-relaxed whitespace-pre-wrap ${
                    turn.role === "user" ? "text-white" : "text-slate-800"
                  }`}
                >
                  {turn.content}
                </div>

                {turn.role === "assistant" &&
                  turn.tool_traces &&
                  turn.tool_traces.length > 0 && (
                    <div className="pt-2 border-t border-slate-200/80 space-y-1.5">
                      <div className="text-[11px] font-medium text-slate-500">
                        Verified Tool Execution Traces ({turn.tool_traces.length})
                      </div>
                      {turn.tool_traces.map((trace, idx) => {
                        const key = `${turn.id}-${idx}`;
                        const isOpen = expandedTraceKey === key;
                        return (
                          <div
                            key={key}
                            className="bg-white border border-slate-200 rounded overflow-hidden"
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedTraceKey(isOpen ? null : key)
                              }
                              className="w-full px-3 py-2 flex items-center justify-between gap-2 text-xs hover:bg-slate-50 text-left"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="font-mono font-semibold text-slate-900">
                                  {trace.tool_name}
                                </span>
                                <span
                                  className={
                                    trace.status === "SUCCESS"
                                      ? "text-emerald-700"
                                      : trace.status === "FALLBACK_SUCCESS"
                                      ? "text-amber-700"
                                      : "text-red-700"
                                  }
                                >
                                  {trace.status}
                                </span>
                                <span className="text-slate-400">·</span>
                                <span className="text-slate-500 font-mono">
                                  {trace.used_cache ? "session cache" : "live execFile"}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0 font-mono tabular-nums text-slate-500">
                                <span>{trace.latency_ms}ms</span>
                                {isOpen ? (
                                  <ChevronUp className="w-3.5 h-3.5" />
                                ) : (
                                  <ChevronDown className="w-3.5 h-3.5" />
                                )}
                              </div>
                            </button>

                            {isOpen && (
                              <div className="border-t border-slate-200 bg-slate-950 text-slate-100 p-3 font-mono text-[11px] space-y-2">
                                <div className="text-slate-300">
                                  binary: {trace.binary_executed}{" "}
                                  {JSON.stringify(trace.args)} · shell_spawned:{" "}
                                  {String(trace.shell_spawned)}
                                </div>
                                {trace.raw_stdout_preview && (
                                  <div>
                                    <div className="text-slate-400 mb-1">
                                      raw_stdout_preview:
                                    </div>
                                    <pre className="bg-slate-900 p-2 rounded overflow-x-auto max-h-32 text-slate-300">
                                      {trace.raw_stdout_preview}
                                    </pre>
                                  </div>
                                )}
                                <div>
                                  <div className="text-slate-400 mb-1">
                                    normalized_json:
                                  </div>
                                  <pre className="bg-slate-900 p-2 rounded overflow-x-auto max-h-52 text-emerald-300">
                                    {JSON.stringify(trace.parsed_json, null, 2)}
                                  </pre>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
              </div>
            ))
          )}

          {sending && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-xs text-slate-500">
              Executing allow-listed Linux hardware tools and synthesizing verified answer...
            </div>
          )}

          {chatError && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-xs text-red-700">
              {chatError}
            </div>
          )}
        </div>

        {/* Input Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendQuestion(inputMsg);
          }}
          className="p-4 border-t border-slate-200 flex items-center gap-2"
        >
          <input
            type="text"
            value={inputMsg}
            onChange={(e) => setInputMsg(e.target.value)}
            placeholder="Ask about RAM capacity, CPU topology, disks, kernel, or GPU..."
            className="flex-1 min-w-0 h-10 px-3.5 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
          />
          <button
            type="submit"
            disabled={sending || !inputMsg.trim()}
            className="inline-flex items-center gap-2 h-10 px-4 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            Ask Assistant
          </button>
        </form>
      </section>
    </div>
  );
};
