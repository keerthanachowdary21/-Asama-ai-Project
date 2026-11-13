import "dotenv/config";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import {
  addCommentInternal,
  ensureNetworkState,
  getPublicNetworkSnapshot,
  publishPostInternal,
  recordRoutingFeedback,
  registerAgent,
  toggleAgentActive,
  triggerAutonomousAgentReply,
} from "./server/agentNetwork.ts";
import {
  askHardwareAssistant,
  clearHardwareSession,
  discoverSystemCapabilities,
  executeAllowListedTool,
  testSecurityGatekeeper,
} from "./server/hardwareAssistant.ts";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "1mb" }));

  // =========================================================================
  // PROBLEM 1: Social Network for AI Agents REST API (/api/v1/*)
  // =========================================================================

  app.get("/api/v1/network/snapshot", async (_req, res) => {
    try {
      const snapshot = await getPublicNetworkSnapshot();
      res.json(snapshot);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to load network snapshot",
      });
    }
  });

  app.post("/api/v1/agents/register", async (req, res) => {
    try {
      const {
        company_name,
        industry_category,
        webhook_url,
        interest_manifesto,
        blocked_industries,
      } = req.body ?? {};
      if (!company_name || !industry_category || !webhook_url || !interest_manifesto) {
        res.status(400).json({
          error:
            "company_name, industry_category, webhook_url, and interest_manifesto are required.",
        });
        return;
      }
      const created = await registerAgent({
        company_name,
        industry_category,
        webhook_url,
        interest_manifesto,
        blocked_industries: Array.isArray(blocked_industries) ? blocked_industries : [],
      });
      res.status(201).json(created);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to register agent",
      });
    }
  });

  app.patch("/api/v1/agents/:agentId/status", async (req, res) => {
    try {
      const { active } = req.body ?? {};
      const updated = await toggleAgentActive(req.params.agentId, Boolean(active));
      res.json(updated);
    } catch (err) {
      res.status(404).json({
        error: err instanceof Error ? err.message : "Failed to update agent status",
      });
    }
  });

  app.post("/api/v1/posts", async (req, res) => {
    try {
      const { author_agent_id, title, content, auto_respond } = req.body ?? {};
      if (!author_agent_id || !title || !content) {
        res.status(400).json({
          error: "author_agent_id, title, and content are required.",
        });
        return;
      }
      const result = await publishPostInternal({
        author_agent_id,
        title,
        content,
        auto_respond: Boolean(auto_respond),
      });
      res.status(201).json(result);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to publish post",
      });
    }
  });

  app.post("/api/v1/posts/:postId/comments", async (req, res) => {
    try {
      const { author_agent_id, content } = req.body ?? {};
      if (!author_agent_id || !content) {
        res.status(400).json({ error: "author_agent_id and content are required." });
        return;
      }
      const comment = await addCommentInternal({
        post_id: req.params.postId,
        author_agent_id,
        content,
        is_autonomous: false,
      });
      res.status(201).json(comment);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : "Failed to add comment",
      });
    }
  });

  app.post("/api/v1/posts/:postId/autonomous-reply", async (req, res) => {
    try {
      const { target_agent_id } = req.body ?? {};
      if (!target_agent_id) {
        res.status(400).json({ error: "target_agent_id is required." });
        return;
      }
      const comment = await triggerAutonomousAgentReply(
        req.params.postId,
        target_agent_id
      );
      res.status(201).json(comment);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : "Failed to trigger autonomous reply",
      });
    }
  });

  app.post("/api/v1/routing-logs/:logId/feedback", async (req, res) => {
    try {
      const { outcome } = req.body ?? {};
      if (outcome !== "ENGAGED" && outcome !== "IGNORED") {
        res.status(400).json({ error: "outcome must be 'ENGAGED' or 'IGNORED'." });
        return;
      }
      const result = await recordRoutingFeedback(req.params.logId, outcome);
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : "Failed to record feedback",
      });
    }
  });

  // =========================================================================
  // PROBLEM 2: Local Linux Hardware Q&A Assistant REST API (/api/v1/hardware/*)
  // =========================================================================

  app.get("/api/v1/hardware/capabilities", (_req, res) => {
    try {
      res.json(discoverSystemCapabilities());
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to discover capabilities",
      });
    }
  });

  app.post("/api/v1/hardware/execute-tool", async (req, res) => {
    try {
      const { tool_name, args } = req.body ?? {};
      if (!tool_name || typeof tool_name !== "string") {
        res.status(400).json({ error: "tool_name string is required." });
        return;
      }
      const trace = await executeAllowListedTool(tool_name, args ?? {});
      res.json(trace);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Tool execution failed",
      });
    }
  });

  app.post("/api/v1/hardware/test-security", (req, res) => {
    const { requested_command } = req.body ?? {};
    if (!requested_command || typeof requested_command !== "string") {
      res.status(400).json({ error: "requested_command string is required." });
      return;
    }
    res.json(testSecurityGatekeeper(requested_command));
  });

  app.post("/api/v1/hardware/chat", async (req, res) => {
    try {
      const { session_id, message } = req.body ?? {};
      if (!message || typeof message !== "string") {
        res.status(400).json({ error: "message string is required." });
        return;
      }
      const result = await askHardwareAssistant(
        typeof session_id === "string" && session_id ? session_id : "default-session",
        message
      );
      res.json(result);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Hardware Q&A failed",
      });
    }
  });

  app.post("/api/v1/hardware/session/reset", (req, res) => {
    const { session_id } = req.body ?? {};
    clearHardwareSession(
      typeof session_id === "string" && session_id ? session_id : "default-session"
    );
    res.json({ cleared: true });
  });

  // Warm up seeded network state in background
  ensureNetworkState().catch((err) => {
    console.error("Failed to seed initial network state:", err);
  });

  // Mount Vite middleware in dev, or serve dist in production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Asama.ai server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Fatal server startup error:", err);
  process.exit(1);
});
