import { createHash } from "node:crypto";
import { createRequire } from "node:module";

type Embedder = {
  model_id: string;
  embed: (text: string) => Promise<number[]>;
  embedBatch: (texts: string[]) => Promise<number[][]>;
};

const DEFAULT_DIM = 384;

/**
 * Normalizes a vector to unit length.
 */
function normalize(vec: number[] | Float32Array): Float32Array {
  const arr = vec instanceof Float32Array ? vec : new Float32Array(vec);
  let sumSq = 0;
  for (let i = 0; i < arr.length; i++) sumSq += arr[i] * arr[i];
  const norm = Math.sqrt(sumSq) || 1;
  for (let i = 0; i < arr.length; i++) arr[i] /= norm;
  return arr;
}

/**
 * Deterministic, local-only fallback embedder (NOT semantic).
 */
function hashEmbed(text: string, dim = DEFAULT_DIM): number[] {
  const h = createHash("sha256").update(text, "utf-8").digest();
  const out = new Array(dim).fill(0);
  for (let i = 0; i < dim; i++) {
    const b = h[i % h.length];
    out[i] = (b - 128) / 128;
  }
  const norm = normalize(out);
  return Array.from(norm);
}

let xenovaSingleton: Promise<Embedder> | null = null;

async function getXenovaEmbedder(): Promise<Embedder> {
  if (!xenovaSingleton) {
    xenovaSingleton = (async () => {
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

      const embedFunc = async (text: string) => {
        const t = text.length > 4000 ? text.slice(0, 4000) : text;
        const result = await extractor(t, {
          pooling: "mean",
          normalize: true,
        });
        const arr = Array.isArray(result) ? result : (result?.data ?? result);
        if (Array.isArray(arr) && Array.isArray(arr[0]))
          return arr[0] as number[];
        if (Array.isArray(arr)) return arr as number[];
        if (arr instanceof Float32Array) return Array.from(arr);
        throw new Error("unexpected embeddings output shape");
      };

      return {
        model_id: modelId,
        embed: embedFunc,
        embedBatch: async (texts: string[]) => {
          if (texts.length === 0) return [];
          const processed = texts.map((t) => (t.length > 4000 ? t.slice(0, 4000) : t));
          const results = await extractor(processed, {
            pooling: "mean",
            normalize: true,
          });
          
          // transformers.js batch output can be a single Tensor or array of Tensors
          if (results.dims && results.data) {
             const dim = results.dims[1];
             const out: number[][] = [];
             for (let i = 0; i < results.dims[0]; i++) {
               out.push(Array.from(results.data.slice(i * dim, (i + 1) * dim)));
             }
             return out;
          }
          
          if (Array.isArray(results)) {
            return results.map(r => Array.from(Array.isArray(r) ? r : (r?.data ?? r)));
          }
          
          throw new Error("unexpected batch embeddings output shape");
        }
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
      embedBatch: async (texts: string[]) => texts.map(t => hashEmbed(t)),
    };
  }

  return getXenovaEmbedder();
}

/**
 * Calculates cosine similarity between two vectors.
 * Uses Float32Array for performance.
 */
export function cosineSimilarity(a: number[] | Float32Array, b: number[] | Float32Array): number {
  const arrA = a instanceof Float32Array ? a : new Float32Array(a);
  const arrB = b instanceof Float32Array ? b : new Float32Array(b);
  const n = Math.min(arrA.length, arrB.length);
  
  let dot = 0;
  for (let i = 0; i < n; i++) {
    dot += arrA[i] * arrB[i];
  }
  
  // Assuming vectors are already normalized (standard for most embedders)
  // If not normalized, this would need to divide by (normA * normB)
  return dot;
}
