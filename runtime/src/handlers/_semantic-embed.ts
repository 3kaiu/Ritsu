import { createHash } from "node:crypto";
import { createRequire } from "node:module";

type Embedder = {
  model_id: string;
  embed: (text: string) => Promise<number[]>;
};

const DEFAULT_DIM = 384;

function normalize(vec: number[]): number[] {
  let sumSq = 0;
  for (const v of vec) sumSq += v * v;
  const norm = Math.sqrt(sumSq) || 1;
  return vec.map((v) => v / norm);
}

function hashEmbed(text: string, dim = DEFAULT_DIM): number[] {
  // Deterministic, local-only fallback embedder (NOT semantic).
  // Useful for offline/CI tests and as a last-resort backend.
  const h = createHash("sha256").update(text, "utf-8").digest();
  const out = new Array(dim).fill(0);
  for (let i = 0; i < dim; i++) {
    const b = h[i % h.length];
    out[i] = (b - 128) / 128;
  }
  return normalize(out);
}

let xenovaSingleton: Promise<Embedder> | null = null;

async function getXenovaEmbedder(): Promise<Embedder> {
  if (!xenovaSingleton) {
    xenovaSingleton = (async () => {
      // Optional dependency load.
      // Use createRequire to avoid TS module resolution/type errors when the package isn't installed yet.
      const require = createRequire(import.meta.url);
      let mod: any;
      try {
        mod = require("@xenova/transformers");
      } catch {
        throw new Error(
          "@xenova/transformers not installed. Run `npm i` in runtime/ or set RITSU_EMBEDDINGS_BACKEND=hash.",
        );
      }

      const pipeline: any = mod.pipeline;
      if (typeof pipeline !== "function") {
        throw new Error("@xenova/transformers pipeline() not found");
      }

      const modelId =
        process.env.RITSU_EMBEDDINGS_MODEL ?? "Xenova/all-MiniLM-L6-v2";
      const extractor = await pipeline("feature-extraction", modelId);

      return {
        model_id: modelId,
        embed: async (text: string) => {
          const t = text.length > 4000 ? text.slice(0, 4000) : text;
          const result = await extractor(t, {
            pooling: "mean",
            normalize: true,
          });
          // extractor returns a Tensor-like nested array; normalize:true should already normalize.
          const arr = Array.isArray(result) ? result : (result?.data ?? result);
          if (Array.isArray(arr) && Array.isArray(arr[0]))
            return arr[0] as number[];
          if (Array.isArray(arr)) return arr as number[];
          throw new Error("unexpected embeddings output shape");
        },
      };
    })();
  }

  return xenovaSingleton;
}

export async function getEmbedder(): Promise<Embedder> {
  const backend = String(
    process.env.RITSU_EMBEDDINGS_BACKEND ?? "xenova",
  ).toLowerCase();
  if (backend === "hash") {
    return {
      model_id: "hash-embed-v1",
      embed: async (text: string) => hashEmbed(text),
    };
  }

  return getXenovaEmbedder();
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let a2 = 0;
  let b2 = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    a2 += a[i] * a[i];
    b2 += b[i] * b[i];
  }
  const denom = Math.sqrt(a2) * Math.sqrt(b2);
  return denom ? dot / denom : 0;
}
