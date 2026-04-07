/**
 * useLocalModel — React hook for managing a local Gemma 4 model via @huggingface/transformers.
 *
 * - Lazy-loads @huggingface/transformers via dynamic import (never in main bundle)
 * - Manages model download, progress, localStorage persistence, and inference
 * - Exposes pipeline for use by coach chat and photo logging
 */
import { useState, useEffect, useRef, useCallback } from "react";

export type ModelVariant = "E2B" | "E4B";

interface DownloadProgress {
  status: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

interface LocalModelState {
  /** Which variant is installed (null = none) */
  variant: ModelVariant | null;
  /** Whether the model pipeline is ready for inference */
  ready: boolean;
  /** Whether the model is currently being downloaded/loaded */
  loading: boolean;
  /** Download progress (0-100) */
  downloadProgress: number;
  /** Bytes downloaded */
  downloadedBytes: number;
  /** Total bytes to download */
  totalBytes: number;
  /** Current status text */
  statusText: string;
  /** Whether WebGPU is available */
  hasWebGPU: boolean;
  /** Error message if something went wrong */
  error: string | null;
  /** Start downloading/loading a model variant */
  downloadModel: (variant: ModelVariant) => Promise<void>;
  /** Remove the installed model from cache and reset state */
  removeModel: () => Promise<void>;
  /** Run text generation (for coach chat) */
  generateText: (messages: Array<{ role: string; content: string }>) => Promise<string>;
  /** Run image-to-text (for photo logging) */
  analyzeImage: (imageData: string, prompt: string) => Promise<string>;
}

const MODEL_IDS: Record<ModelVariant, string> = {
  E2B: "onnx-community/gemma-4-E2B-it-ONNX",
  E4B: "onnx-community/gemma-4-E4B-it-ONNX",
};

export function useLocalModel(): LocalModelState {
  const [variant, setVariant] = useState<ModelVariant | null>(() => {
    return (localStorage.getItem("localModelVariant") as ModelVariant) || null;
  });
  const [ready, setReady] = useState(() => {
    return localStorage.getItem("localModelReady") === "true";
  });
  const [loading, setLoading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hasWebGPU, setHasWebGPU] = useState(false);

  // Hold the pipeline reference
  const pipelineRef = useRef<any>(null);
  const transformersRef = useRef<any>(null);

  // Check WebGPU availability
  useEffect(() => {
    setHasWebGPU(!!(navigator as any).gpu);
  }, []);

  // If model was previously downloaded, try to load on mount
  useEffect(() => {
    if (variant && ready && !pipelineRef.current && !loading) {
      loadModel(variant);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadTransformers = async () => {
    if (transformersRef.current) return transformersRef.current;
    // Lazy-load @huggingface/transformers — never bundled, loaded at runtime from CDN/npm
    const modName = "@huggingface/transformers";
    const mod = await import(/* @vite-ignore */ modName);
    transformersRef.current = mod;
    return mod;
  };

  const loadModel = async (v: ModelVariant) => {
    try {
      setLoading(true);
      setError(null);
      setStatusText("Loading model...");

      const transformers = await loadTransformers();
      const modelId = MODEL_IDS[v];
      const device = hasWebGPU ? "webgpu" : "wasm";

      const pipe = await transformers.pipeline("text-generation", modelId, {
        dtype: "q4f16",
        device,
        progress_callback: (p: DownloadProgress) => {
          if (p.progress != null) {
            setDownloadProgress(Math.round(p.progress));
          }
          if (p.loaded != null) setDownloadedBytes(p.loaded);
          if (p.total != null) setTotalBytes(p.total);
          if (p.status === "download") {
            setStatusText(`Downloading ${p.file ?? "model files"}...`);
          } else if (p.status === "progress") {
            setStatusText(`Downloading... ${Math.round(p.progress ?? 0)}%`);
          } else if (p.status === "done") {
            setStatusText("Loading model into memory...");
          }
        },
      });

      pipelineRef.current = pipe;
      setReady(true);
      setVariant(v);
      localStorage.setItem("localModelVariant", v);
      localStorage.setItem("localModelReady", "true");
      setStatusText("Model ready");
    } catch (err: any) {
      console.error("[useLocalModel] load error:", err);
      setError(err.message ?? "Failed to load model");
      setStatusText("");
      setReady(false);
      localStorage.setItem("localModelReady", "false");
    } finally {
      setLoading(false);
    }
  };

  const downloadModel = useCallback(async (v: ModelVariant) => {
    if (loading) return;
    setDownloadProgress(0);
    setDownloadedBytes(0);
    setTotalBytes(0);
    await loadModel(v);
  }, [loading, hasWebGPU]); // eslint-disable-line react-hooks/exhaustive-deps

  const removeModel = useCallback(async () => {
    pipelineRef.current = null;
    setVariant(null);
    setReady(false);
    setDownloadProgress(0);
    setDownloadedBytes(0);
    setTotalBytes(0);
    setStatusText("");
    setError(null);
    localStorage.removeItem("localModelVariant");
    localStorage.setItem("localModelReady", "false");

    // Try to clear the cached model from Cache Storage
    try {
      const cacheNames = await caches.keys();
      for (const name of cacheNames) {
        if (name.includes("transformers") || name.includes("onnx")) {
          await caches.delete(name);
        }
      }
    } catch {
      // Cache API may not be available
    }
  }, []);

  const generateText = useCallback(async (messages: Array<{ role: string; content: string }>): Promise<string> => {
    if (!pipelineRef.current) {
      throw new Error("Local model not loaded");
    }
    const output = await pipelineRef.current(messages, {
      max_new_tokens: 1024,
      temperature: 0.7,
      do_sample: true,
    });
    // Pipeline returns array of generated outputs
    const result = output?.[0]?.generated_text;
    if (Array.isArray(result)) {
      // Chat-style output: array of messages, get the last assistant message
      const lastMsg = result[result.length - 1];
      return lastMsg?.content ?? "";
    }
    return typeof result === "string" ? result : JSON.stringify(result);
  }, []);

  const analyzeImage = useCallback(async (imageData: string, prompt: string): Promise<string> => {
    if (!pipelineRef.current) {
      throw new Error("Local model not loaded");
    }
    const messages = [
      {
        role: "user",
        content: [
          { type: "image", image: imageData },
          { type: "text", text: prompt },
        ],
      },
    ];
    const output = await pipelineRef.current(messages, {
      max_new_tokens: 1024,
      temperature: 0.3,
      do_sample: true,
    });
    const result = output?.[0]?.generated_text;
    if (Array.isArray(result)) {
      const lastMsg = result[result.length - 1];
      return lastMsg?.content ?? "";
    }
    return typeof result === "string" ? result : JSON.stringify(result);
  }, []);

  return {
    variant,
    ready,
    loading,
    downloadProgress,
    downloadedBytes,
    totalBytes,
    statusText,
    hasWebGPU,
    error,
    downloadModel,
    removeModel,
    generateText,
    analyzeImage,
  };
}
