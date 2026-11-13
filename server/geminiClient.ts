import { GoogleGenAI } from "@google/genai";

let cachedClient: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  if (!cachedClient) {
    cachedClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return cachedClient;
}

export function normalizeVector(vec: number[]): number[] {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return Math.max(0, Math.min(1, dot / denom));
}

function deterministicFallbackEmbedding(text: string, dims = 128): number[] {
  const vec = new Array<number>(dims).fill(0);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  for (const token of tokens) {
    let h = 2166136261;
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % dims;
    vec[idx] += 1;
    // bigram hash for smoother semantic overlap
    for (let i = 0; i < token.length - 2; i++) {
      const tri = token.slice(i, i + 3);
      let th = 2166136261;
      for (let j = 0; j < tri.length; j++) {
        th ^= tri.charCodeAt(j);
        th = Math.imul(th, 16777619);
      }
      vec[Math.abs(th) % dims] += 0.35;
    }
  }
  return normalizeVector(vec);
}

export async function embedText(text: string): Promise<{
  vector: number[];
  model: string;
  dimensions: number;
}> {
  if (!process.env.GEMINI_API_KEY) {
    const vec = deterministicFallbackEmbedding(text);
    return { vector: vec, model: "lexical-hash-fallback", dimensions: vec.length };
  }

  try {
    const ai = getGeminiClient();
    const res = await ai.models.embedContent({
      model: "gemini-embedding-2",
      contents: text,
    });
    const values = res.embeddings?.[0]?.values;
    if (values && values.length > 0) {
      const normalized = normalizeVector(values);
      return {
        vector: normalized,
        model: "gemini-embedding-2",
        dimensions: normalized.length,
      };
    }
  } catch (err) {
    console.warn("Embedding fallback triggered:", err instanceof Error ? err.message : String(err));
  }

  const vec = deterministicFallbackEmbedding(text);
  return { vector: vec, model: "lexical-hash-fallback", dimensions: vec.length };
}
