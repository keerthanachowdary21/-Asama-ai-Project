import { execFile } from "child_process";
import fs from "fs";
import { promisify } from "util";
import { Content, FunctionDeclaration, Type } from "@google/genai";
import { getGeminiClient } from "./geminiClient.ts";

const execFileAsync = promisify(execFile);

export interface ToolCapability {
  tool_name: string;
  binary_path: string;
  args: string[];
  available: boolean;
  privilege_mode: "unprivileged" | "privileged_with_fallback";
  fallback_source: string;
  description: string;
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

interface AllowListedSpec {
  binary: string;
  args: string[];
  privilege_mode: "unprivileged" | "privileged_with_fallback";
  fallback_source: string;
  description: string;
}

const ALLOW_LISTED_TOOLS: Record<string, AllowListedSpec> = {
  get_cpu_info: {
    binary: "/usr/bin/lscpu",
    args: [],
    privilege_mode: "unprivileged",
    fallback_source: "/proc/cpuinfo",
    description:
      "Retrieves CPU architecture, model name, core/thread counts, sockets, and cache topology.",
  },
  get_block_devices: {
    binary: "/usr/bin/lsblk",
    args: ["-J", "-o", "NAME,SIZE,TYPE,MOUNTPOINT,MODEL,ROTA,TRAN"],
    privilege_mode: "unprivileged",
    fallback_source: "/proc/partitions",
    description:
      "Retrieves attached block storage devices, disk sizes, mountpoints, rotational status, and transport bus.",
  },
  get_memory_summary: {
    binary: "/usr/bin/free",
    args: ["-b"],
    privilege_mode: "unprivileged",
    fallback_source: "/proc/meminfo",
    description:
      "Retrieves live RAM and swap usage in bytes from free -b and /proc/meminfo.",
  },
  get_dmi_memory: {
    binary: "/usr/sbin/dmidecode",
    args: ["-t", "memory"],
    privilege_mode: "privileged_with_fallback",
    fallback_source: "/sys/class/dmi/id + /proc/meminfo",
    description:
      "Attempts SMBIOS/DMI physical RAM slot and maximum capacity inspection; falls back to /sys/class/dmi/id and /proc/meminfo when dmidecode is missing or unprivileged.",
  },
  get_os_kernel_info: {
    binary: "/usr/bin/uname",
    args: ["-a"],
    privilege_mode: "unprivileged",
    fallback_source: "/etc/os-release",
    description:
      "Retrieves Linux kernel version, hostname, architecture, and OS distribution details.",
  },
  get_disk_usage: {
    binary: "/usr/bin/df",
    args: ["-B1", "-T"],
    privilege_mode: "unprivileged",
    fallback_source: "/proc/mounts",
    description:
      "Retrieves mounted filesystem types, total capacity, used bytes, and available bytes.",
  },
};

function findBinary(preferredPath: string): string | null {
  const name = preferredPath.split("/").pop() ?? "";
  const candidates = [
    preferredPath,
    `/bin/${name}`,
    `/usr/bin/${name}`,
    `/sbin/${name}`,
    `/usr/sbin/${name}`,
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function discoverSystemCapabilities(): {
  tools: ToolCapability[];
  kernel_interfaces: Array<{ path: string; readable: boolean }>;
  absent_binaries: string[];
} {
  const tools: ToolCapability[] = [];
  const absent_binaries: string[] = [];

  for (const [tool_name, spec] of Object.entries(ALLOW_LISTED_TOOLS)) {
    const resolved = findBinary(spec.binary);
    const hasFallback = spec.privilege_mode === "privileged_with_fallback";
    if (!resolved) {
      absent_binaries.push(spec.binary);
    }
    tools.push({
      tool_name,
      binary_path: resolved ?? spec.binary,
      args: spec.args,
      available: Boolean(resolved) || hasFallback,
      privilege_mode: spec.privilege_mode,
      fallback_source: spec.fallback_source,
      description: spec.description,
    });
  }

  const probePaths = [
    "/proc/cpuinfo",
    "/proc/meminfo",
    "/etc/os-release",
    "/sys/class/dmi/id",
  ];
  const kernel_interfaces = probePaths.map((p) => {
    let readable = false;
    try {
      fs.accessSync(p, fs.constants.R_OK);
      readable = true;
    } catch {
      readable = false;
    }
    return { path: p, readable };
  });

  return { tools, kernel_interfaces, absent_binaries };
}

function parseProcMeminfo(): Record<string, unknown> {
  try {
    const raw = fs.readFileSync("/proc/meminfo", "utf-8");
    const parsed: Record<string, number> = {};
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([^:]+):\s+(\d+)\s*kB/i);
      if (m) {
        parsed[m[1].trim()] = Number(m[2]) * 1024;
      }
    }
    return {
      mem_total_bytes: parsed["MemTotal"] ?? null,
      mem_total_gb: parsed["MemTotal"]
        ? Number((parsed["MemTotal"] / 1024 ** 3).toFixed(2))
        : null,
      mem_available_bytes: parsed["MemAvailable"] ?? null,
      mem_available_gb: parsed["MemAvailable"]
        ? Number((parsed["MemAvailable"] / 1024 ** 3).toFixed(2))
        : null,
      mem_free_bytes: parsed["MemFree"] ?? null,
      swap_total_bytes: parsed["SwapTotal"] ?? null,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function parseDmiSysfsFallback(): Record<string, unknown> {
  const fields = [
    "sys_vendor",
    "product_name",
    "product_version",
    "board_vendor",
    "board_name",
    "bios_vendor",
    "bios_version",
    "chassis_type",
  ];
  const dmi: Record<string, string> = {};
  for (const field of fields) {
    try {
      const val = fs.readFileSync(`/sys/class/dmi/id/${field}`, "utf-8").trim();
      if (val) dmi[field] = val;
    } catch {
      // Field may not exist in container/VM environments
    }
  }
  const mem = parseProcMeminfo();
  return {
    source: "fallback_sysfs_and_proc_meminfo",
    dmidecode_status: "Unavailable (dmidecode binary not present or requires root privileges)",
    dmi_identity: Object.keys(dmi).length > 0 ? dmi : "Not exposed by container/hypervisor",
    installed_ram_from_proc: mem,
    maximum_capacity: "Unavailable without SMBIOS/DMI table access (requires scoped root dmidecode)",
    total_slots: "Unavailable without SMBIOS/DMI table access",
    used_slots: "Unavailable without SMBIOS/DMI table access",
    free_slots: "Unavailable without SMBIOS/DMI table access",
  };
}

function parseToolOutput(toolName: string, stdout: string): Record<string, unknown> {
  if (toolName === "get_block_devices") {
    try {
      return JSON.parse(stdout) as Record<string, unknown>;
    } catch {
      return { raw_output: stdout };
    }
  }

  if (toolName === "get_cpu_info") {
    const cpuData: Record<string, string> = {};
    for (const line of stdout.split(/\r?\n/)) {
      const idx = line.indexOf(":");
      if (idx > 0) {
        const key = line.slice(0, idx).trim();
        const val = line.slice(idx + 1).trim();
        cpuData[key] = val;
      }
    }
    return cpuData;
  }

  if (toolName === "get_memory_summary") {
    const lines = stdout.trim().split(/\r?\n/);
    const memLine = lines.find((l) => l.startsWith("Mem:"));
    const swapLine = lines.find((l) => l.startsWith("Swap:"));
    const memParts = memLine ? memLine.trim().split(/\s+/) : [];
    const swapParts = swapLine ? swapLine.trim().split(/\s+/) : [];
    const procMem = parseProcMeminfo();

    return {
      free_command_bytes: {
        total_bytes: memParts[1] ? Number(memParts[1]) : null,
        used_bytes: memParts[2] ? Number(memParts[2]) : null,
        free_bytes: memParts[3] ? Number(memParts[3]) : null,
        shared_bytes: memParts[4] ? Number(memParts[4]) : null,
        buff_cache_bytes: memParts[5] ? Number(memParts[5]) : null,
        available_bytes: memParts[6] ? Number(memParts[6]) : null,
      },
      swap_bytes: {
        total_bytes: swapParts[1] ? Number(swapParts[1]) : null,
        used_bytes: swapParts[2] ? Number(swapParts[2]) : null,
        free_bytes: swapParts[3] ? Number(swapParts[3]) : null,
      },
      proc_meminfo: procMem,
    };
  }

  if (toolName === "get_dmi_memory") {
    const maxCap = stdout.match(/Maximum Capacity:\s*(.+)/);
    const devices = [...stdout.matchAll(/Size:\s*(.+)/g)].map((m) => m[1].trim());
    const installed = devices.filter((d) => !d.includes("No Module Installed"));
    return {
      source: "dmidecode",
      maximum_capacity: maxCap ? maxCap[1].trim() : "Unknown",
      total_slots: devices.length,
      used_slots: installed.length,
      free_slots: devices.length - installed.length,
      installed_modules: installed,
    };
  }

  if (toolName === "get_os_kernel_info") {
    let osRelease: Record<string, string> = {};
    try {
      const rawOs = fs.readFileSync("/etc/os-release", "utf-8");
      for (const line of rawOs.split(/\r?\n/)) {
        const eq = line.indexOf("=");
        if (eq > 0) {
          const k = line.slice(0, eq).trim();
          const v = line.slice(eq + 1).trim().replace(/^"|"$/g, "");
          osRelease[k] = v;
        }
      }
    } catch {
      osRelease = {};
    }
    return {
      uname: stdout.trim(),
      os_release: {
        name: osRelease["PRETTY_NAME"] || osRelease["NAME"] || "Linux",
        version: osRelease["VERSION"] || "Unknown",
        id: osRelease["ID"] || "linux",
      },
    };
  }

  if (toolName === "get_disk_usage") {
    const lines = stdout.trim().split(/\r?\n/).slice(1);
    const filesystems = lines.map((line) => {
      const parts = line.trim().split(/\s+/);
      return {
        filesystem: parts[0],
        type: parts[1],
        total_bytes: Number(parts[2]) || 0,
        used_bytes: Number(parts[3]) || 0,
        available_bytes: Number(parts[4]) || 0,
        use_percent: parts[5],
        mounted_on: parts.slice(6).join(" "),
      };
    });
    return { filesystems };
  }

  return { raw_output: stdout };
}

export async function executeAllowListedTool(
  toolName: string,
  _args: Record<string, unknown> = {}
): Promise<ExecutedToolTrace> {
  const start = performance.now();

  if (!Object.prototype.hasOwnProperty.call(ALLOW_LISTED_TOOLS, toolName)) {
    return {
      tool_name: toolName,
      binary_executed: "REJECTED_BY_ALLOW_LIST",
      args: [],
      shell_spawned: false,
      used_cache: false,
      fallback_used: false,
      latency_ms: Number((performance.now() - start).toFixed(2)),
      status: "REJECTED",
      raw_stdout_preview: "",
      parsed_json: {
        error: `Unauthorized tool execution attempt: '${toolName}' is not in ALLOW_LISTED_TOOLS.`,
      },
    };
  }

  const spec = ALLOW_LISTED_TOOLS[toolName];
  const resolvedBin = findBinary(spec.binary);

  if (!resolvedBin) {
    if (toolName === "get_dmi_memory") {
      const fallbackData = parseDmiSysfsFallback();
      return {
        tool_name: toolName,
        binary_executed: "fallback:/sys/class/dmi/id + /proc/meminfo",
        args: [],
        shell_spawned: false,
        used_cache: false,
        fallback_used: true,
        latency_ms: Number((performance.now() - start).toFixed(2)),
        status: "FALLBACK_SUCCESS",
        raw_stdout_preview:
          "dmidecode binary not found; read kernel /sys/class/dmi/id and /proc/meminfo directly.",
        parsed_json: fallbackData,
      };
    }

    return {
      tool_name: toolName,
      binary_executed: spec.binary,
      args: spec.args,
      shell_spawned: false,
      used_cache: false,
      fallback_used: false,
      latency_ms: Number((performance.now() - start).toFixed(2)),
      status: "ERROR",
      raw_stdout_preview: "",
      parsed_json: {
        error: `Binary '${spec.binary}' is not installed on this host.`,
      },
    };
  }

  try {
    // execFile executes the binary directly without spawning /bin/sh (shell=false)
    const { stdout } = await execFileAsync(resolvedBin, spec.args, {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });

    const parsed = parseToolOutput(toolName, stdout);
    return {
      tool_name: toolName,
      binary_executed: resolvedBin,
      args: spec.args,
      shell_spawned: false,
      used_cache: false,
      fallback_used: false,
      latency_ms: Number((performance.now() - start).toFixed(2)),
      status: "SUCCESS",
      raw_stdout_preview: stdout.slice(0, 1200),
      parsed_json: parsed,
    };
  } catch (err) {
    if (toolName === "get_dmi_memory") {
      const fallbackData = parseDmiSysfsFallback();
      return {
        tool_name: toolName,
        binary_executed: "fallback:/sys/class/dmi/id + /proc/meminfo",
        args: [],
        shell_spawned: false,
        used_cache: false,
        fallback_used: true,
        latency_ms: Number((performance.now() - start).toFixed(2)),
        status: "FALLBACK_SUCCESS",
        raw_stdout_preview: `dmidecode failed (${err instanceof Error ? err.message : String(err)}); executed non-root fallback.`,
        parsed_json: fallbackData,
      };
    }
    return {
      tool_name: toolName,
      binary_executed: resolvedBin,
      args: spec.args,
      shell_spawned: false,
      used_cache: false,
      fallback_used: false,
      latency_ms: Number((performance.now() - start).toFixed(2)),
      status: "ERROR",
      raw_stdout_preview: "",
      parsed_json: {
        error: `Execution failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
}

export function testSecurityGatekeeper(requestedCommand: string) {
  const trimmed = requestedCommand.trim();
  const dangerousChars = /[;&|`$<>\\]/;
  if (Object.prototype.hasOwnProperty.call(ALLOW_LISTED_TOOLS, trimmed)) {
    const spec = ALLOW_LISTED_TOOLS[trimmed];
    return {
      allowed: true,
      requested_input: requestedCommand,
      decision: "ALLOWED_TOOL_ID",
      reason: `Mapped static Tool ID '${trimmed}' to fixed execve path ${spec.binary} with shell=false.`,
    };
  }

  return {
    allowed: false,
    requested_input: requestedCommand,
    decision: dangerousChars.test(trimmed)
      ? "REJECTED_SHELL_INJECTION"
      : "REJECTED_NOT_IN_ALLOW_LIST",
    reason: dangerousChars.test(trimmed)
      ? "Rejected: shell metacharacters or chaining operators detected; arbitrary shell strings are never passed to execve."
      : `Rejected: '${trimmed}' is not a registered allow-listed Tool ID.`,
  };
}

interface HardwareSession {
  history: Content[];
  cached_hardware: Record<string, ExecutedToolTrace>;
}

const sessions = new Map<string, HardwareSession>();

function getOrCreateSession(sessionId: string): HardwareSession {
  let sess = sessions.get(sessionId);
  if (!sess) {
    sess = { history: [], cached_hardware: {} };
    sessions.set(sessionId, sess);
  }
  return sess;
}

export function clearHardwareSession(sessionId: string) {
  sessions.delete(sessionId);
}

const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "get_cpu_info",
    description:
      "Retrieves CPU model, architecture, physical cores, threads, sockets, and cache specs via allow-listed lscpu.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        detail_level: {
          type: Type.STRING,
          description: "Optional scalar selector: 'summary' or 'full'.",
        },
      },
    },
  },
  {
    name: "get_memory_summary",
    description:
      "Retrieves installed physical RAM, available RAM, cached memory, and swap usage in bytes via free -b and /proc/meminfo.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        unit: {
          type: Type.STRING,
          description: "Optional scalar display preference: 'bytes' or 'gb'.",
        },
      },
    },
  },
  {
    name: "get_dmi_memory",
    description:
      "Inspects physical memory slot topology and maximum supported motherboard RAM capacity via dmidecode or /sys/class/dmi/id fallback.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        include_empty_slots: {
          type: Type.BOOLEAN,
          description: "Set to true to return details on unused memory slots.",
        },
      },
    },
  },
  {
    name: "get_block_devices",
    description:
      "Retrieves physical disks, partitions, sizes, mountpoints, rotational flags, and transport types via lsblk -J.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        include_partitions: {
          type: Type.BOOLEAN,
          description: "Whether to include partition children.",
        },
      },
    },
  },
  {
    name: "get_disk_usage",
    description:
      "Retrieves mounted filesystem space usage in bytes via df -B1 -T.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        only_local: {
          type: Type.BOOLEAN,
          description: "Optional flag.",
        },
      },
    },
  },
  {
    name: "get_os_kernel_info",
    description:
      "Retrieves Linux kernel release, architecture, and OS distribution details via uname -a and /etc/os-release.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        verbose: {
          type: Type.BOOLEAN,
          description: "Optional flag.",
        },
      },
    },
  },
];

export async function askHardwareAssistant(
  sessionId: string,
  userMessage: string
): Promise<{
  answer: string;
  tool_traces: ExecutedToolTrace[];
  cached_tools: string[];
  model_used: string;
}> {
  const session = getOrCreateSession(sessionId);
  const capabilities = discoverSystemCapabilities();
  const toolTraces: ExecutedToolTrace[] = [];

  const cachedKeys = Object.keys(session.cached_hardware);
  const cachedSummaryText =
    cachedKeys.length > 0
      ? `Previously gathered and cached hardware JSON in this session: ${JSON.stringify(
          Object.fromEntries(
            cachedKeys.map((k) => [k, session.cached_hardware[k].parsed_json])
          )
        )}`
      : "No hardware tools have been cached yet in this session.";

  const systemInstruction = `You are a Local Linux Hardware Q&A Assistant operating on a deterministic allow-listed tool-calling engine.

STRICT ANTI-HALLUCINATION RULES:
1. Base your response SOLELY on the provided JSON tool outputs (either newly called tools or cached session hardware JSON).
2. NEVER guess, extrapolate, or invent hardware specs (like GPU model, motherboard max RAM, or DIMM slot count) if they are missing or marked "Unavailable" in the JSON output.
3. If the JSON tool output states a field is "Unavailable" (for example, dmidecode requires root privileges or is absent in this container), explicitly state: "I cannot determine this hardware detail from system data" and list the missing binary/privilege (e.g., dmidecode / root SMBIOS access) alongside what WAS verified from fallback interfaces (/proc/meminfo, /sys/class/dmi/id).
4. Discovered host capabilities at startup: ${JSON.stringify(
    capabilities.tools.map((t) => ({
      tool: t.tool_name,
      available: t.available,
      privilege: t.privilege_mode,
      fallback: t.fallback_source,
    }))
  )}.
5. ${cachedSummaryText}`;

  if (!process.env.GEMINI_API_KEY) {
    // Deterministic fallback if no Gemini key is configured
    const lower = userMessage.toLowerCase();
    const toRun: string[] = [];
    if (lower.includes("ram") || lower.includes("memory") || lower.includes("upgrade")) {
      toRun.push("get_memory_summary", "get_dmi_memory");
    }
    if (lower.includes("cpu") || lower.includes("core") || lower.includes("processor")) {
      toRun.push("get_cpu_info");
    }
    if (lower.includes("disk") || lower.includes("storage") || lower.includes("drive")) {
      toRun.push("get_block_devices", "get_disk_usage");
    }
    if (toRun.length === 0) {
      toRun.push("get_os_kernel_info", "get_cpu_info", "get_memory_summary");
    }

    for (const t of toRun) {
      const trace = await executeAllowListedTool(t);
      session.cached_hardware[t] = trace;
      toolTraces.push(trace);
    }

    return {
      answer: `Executed ${toRun.join(", ")} directly on the Linux host. See the structured JSON tool traces for exact verified hardware values.`,
      tool_traces: toolTraces,
      cached_tools: Object.keys(session.cached_hardware),
      model_used: "deterministic-tool-router (no API key)",
    };
  }

  const ai = getGeminiClient();
  const contents: Content[] = [
    ...session.history,
    { role: "user", parts: [{ text: userMessage }] },
  ];

  let finalText = "";
  let loops = 0;
  const maxLoops = 4;

  while (loops < maxLoops) {
    loops += 1;
    const response = await ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents,
      config: {
        systemInstruction,
        tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
      },
    });

    const candidateContent = response.candidates?.[0]?.content;
    const functionCalls = response.functionCalls;

    if (functionCalls && functionCalls.length > 0 && candidateContent) {
      // Preserve model turn including toolCall & thoughtSignature
      contents.push(candidateContent);

      const responseParts = [];
      for (const call of functionCalls) {
        const toolName = call.name ?? "";
        let trace: ExecutedToolTrace;

        if (session.cached_hardware[toolName]) {
          trace = {
            ...session.cached_hardware[toolName],
            used_cache: true,
            latency_ms: 0.05,
          };
        } else {
          trace = await executeAllowListedTool(
            toolName,
            (call.args as Record<string, unknown>) ?? {}
          );
          if (trace.status === "SUCCESS" || trace.status === "FALLBACK_SUCCESS") {
            session.cached_hardware[toolName] = trace;
          }
        }

        toolTraces.push(trace);
        responseParts.push({
          functionResponse: {
            id: call.id,
            name: toolName,
            response: { result: trace.parsed_json },
          },
        });
      }

      contents.push({
        role: "user",
        parts: responseParts,
      });
    } else {
      finalText = response.text ?? "No response generated.";
      if (candidateContent) {
        contents.push(candidateContent);
      }
      break;
    }
  }

  session.history = contents.slice(-12);

  return {
    answer: finalText,
    tool_traces: toolTraces,
    cached_tools: Object.keys(session.cached_hardware),
    model_used: "gemini-4-hydrogen",
  };
}
