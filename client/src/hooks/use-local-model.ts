/**
 * useLocalModel — React hook for managing a local Gemma 4 model via @huggingface/transformers.
 *
 * Uses Gemma4ForConditionalGeneration + AutoProcessor (NOT pipeline()) since
 * the ONNX community models are multimodal conditional-generation models.
 *
 * - Lazy-loads @huggingface/transformers via dynamic import (never in main bundle)
 * - Manages model download, progress, localStorage persistence, and inference
 * - Exposes generateText (coach chat) and analyzeImage (photo logging)
 *
 * Fix (2026-04-07): WebGPU buffer crash on Windows (Invalid Buffer / mapAsync failure).
 * Root cause: ONNX Runtime WebGPU backend on Windows has a sequencing issue where
 * GPUBuffers can enter an invalid state mid-inference. The fix wraps model.generate()
 * in a try/catch that resets modelRef/processorRef on any OrtRun/GPUBuffer error so
 * the model reinitialises cleanly on the next call, rather than hanging in a broken
 * GPU state. Also fixes the outputs.slice() tensor slicing call and caps max_new_tokens.
 */
import { useState, useEffect, useRef, useCallback } from "react";

export type ModelVariant = "E2B" | "E4B";

interface LocalModelState {
  /** Which variant is installed (null = none) */
  variant: ModelVariant | null;
  /** Which variant is currently being downloaded (tracks in-flight download) */
  downloadingVariant: ModelVariant | null;
  /** Whether the model is ready for inference */
  ready: boolean;
  /** Whether the model is currently being downloaded/loaded */
  loading: boolean;
  /** Download progress (0-100) */
  downloadProgress: number;
  /** Bytes downloaded (per-file, for display) */
  downloadedBytes: number;
  /** Total bytes (per-file, for display) */
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
  /** Run image analysis (for photo logging) */
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
  const [downloadingVariant, setDownloadingVariant] = useState<ModelVariant | null>(null);
  const [ready, setReady] = useState(() => {
    return localStorage.getItem("localModelReady") === "true";
  });
  const [loading, setLoading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Detect WebGPU synchronously at init — no effect needed
  const [hasWebGPU] = useState(() => !!(navigator as any).gpu);

  // Hold the model + processor references
  const modelRef = useRef<any>(null);
  const processorRef = useRef<any>(null);
  const transformersRef = useRef<any>(null);

  // Track whether we're doing a background cache-reload (don't nuke localStorage on failure)
  const isReloadRef = useRef(false);

  // If a model variant was previously downloaded, try to reload from browser cache on mount.
  useEffect(() => {
    if (variant && !modelRef.current && !loading) {
      isReloadRef.current = true;
      loadModel(variant);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadTransformers = async () => {
    if (transformersRef.current) return transformersRef.current;
    console.log("[useLocalModel] Lazy-loading @huggingface/transformers...");
    const mod = await import("@huggingface/transformers");
    transformersRef.current = mod;
    console.log("[useLocalModel] @huggingface/transformers loaded successfully");
    return mod;
  };

  const handleProgress = (p: any) => {
    if (p.status === "progress_total") {
      const pct = Math.round(p.progress ?? 0);
      setDownloadProgress(pct);
      setStatusText(`Downloading model... ${pct}%`);
    } else if (p.status === "initiate") {
      setStatusText(`Preparing ${p.file ?? "model files"}...`);
    } else if (p.status === "progress") {
      if (p.loaded != null) setDownloadedBytes(p.loaded);
      if (p.total != null) setTotalBytes(p.total);
    } else if (p.status === "download") {
      setStatusText(`Downloading ${p.file ?? "model files"}...`);
    } else if (p.status === "done") {
      setStatusText("Loading model into memory...");
    } else if (p.status === "ready") {
      setStatusText("Model ready");
    }
  };

  const loadModel = async (v: ModelVariant) => {
    try {
      setLoading(true);
      setDownloadingVariant(v);
      setError(null);
      setStatusText("Initializing...");

      const transformers = await loadTransformers();
      const modelId = MODEL_IDS[v];
      const device = hasWebGPU ? "webgpu" : "wasm";

      console.log(`[useLocalModel] Loading ${modelId} on ${device}...`);

      setStatusText("Loading processor...");
      const processor = await transformers.AutoProcessor.from_pretrained(modelId, {
        progress_callback: handleProgress,
      });
      processorRef.current = processor;
      console.log("[useLocalModel] Processor loaded");

      setStatusText("Downloading model weights...");
      const model = await transformers.Gemma4ForConditionalGeneration.from_pretrained(modelId, {
        dtype: "q4f16",
        device,
        progress_callback: handleProgress,
      });
      modelRef.current = model;
      console.log("[useLocalModel] Model loaded");

      setReady(true);
      setVariant(v);
      localStorage.setItem("localModelVariant", v);
      localStorage.setItem("localModelReady", "true");
      setStatusText("Model ready");
    } catch (err: any) {
      console.error("[useLocalModel] load error:", err);

      if (isReloadRef.current) {
        console.warn("[useLocalModel] Cache reload failed — model may need re-download.");
        setError("Model needs to be reloaded. Tap the button to retry.");
        setStatusText("");
      } else {
        setError(err.message ?? "Failed to load model");
        setStatusText("");
        setReady(false);
        localStorage.setItem("localModelReady", "false");
      }
    } finally {
      setLoading(false);
      setDownloadingVariant(null);
      isReloadRef.current = false;
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
    const currentVariant = variant;
    modelRef.current = null;
    processorRef.current = null;
    setVariant(null);
    setReady(false);
    setDownloadProgress(0);
    setDownloadedBytes(0);
    setTotalBytes(0);
    setStatusText("");
    setError(null);
    localStorage.removeItem("localModelVariant");
    localStorage.setItem("localModelReady", "false");

    if (currentVariant) {
      try {
        const transformers = await loadTransformers();
        if (transformers.ModelRegistry?.clear_pipeline_cache) {
          await transformers.ModelRegistry.clear_pipeline_cache(
            "text-generation",
            MODEL_IDS[currentVariant],
            { dtype: "q4f16" }
          );
          console.log("[useLocalModel] Cache cleared via ModelRegistry");
          return;
        }
      } catch {
        // Fall through to manual cache clearing
      }
    }

    try {
      const cacheNames = await caches.keys();
      for (const name of cacheNames) {
        if (name.includes("transformers") || name.includes("onnx")) {
          await caches.delete(name);
        }
      }
      console.log("[useLocalModel] Cache cleared manually");
    } catch {
      // Cache API may not be available
    }
  }, [variant]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── generateText ────────────────────────────────────────────────────────────
  // Fix: wraps model.generate() in try/catch. On any WebGPU/OrtRun buffer error
  // (common on Windows due to ONNX WebGPU sequencing issues), the model and
  // processor refs are cleared and ready is set to false so the next call
  // triggers a clean reload rather than re-using a broken GPU context.
  const generateText = useCallback(async (messages: Array<{ role: string; content: string }>): Promise<string> => {
    const model = modelRef.current;
    const processor = processorRef.current;
    if (!model || !processor) {
      throw new Error("Local model not loaded");
    }

    const prompt = processor.apply_chat_template(messages, {
      enable_thinking: false,
      add_generation_prompt: true,
    });

    const inputs = await processor(prompt, null, null, { add_special_tokens: false });

    const inputLen = inputs.input_ids.dims[inputs.input_ids.dims.length - 1] as number;

    try {
      const outputs = await model.generate({
        ...inputs,
        max_new_tokens: 512,
        do_sample: true,
        temperature: 0.7,
      });

      // Slice only the newly generated tokens (skip the input prefix).
      // outputs is a 2D tensor [batch, seq_len]; we want columns [inputLen:]
      const newTokens = outputs.slice(null, [inputLen, null]);
      const decoded = processor.batch_decode(newTokens, { skip_special_tokens: true });
      return decoded[0] ?? "";
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      console.error("[useLocalModel] generate error:", msg);

      // WebGPU buffer corruption — reset model refs so next call gets a fresh context
      if (
        msg.includes("GPUBuffer") ||
        msg.includes("OrtRun") ||
        msg.includes("mapAsync") ||
        msg.includes("Invalid Buffer")
      ) {
        console.warn("[useLocalModel] WebGPU buffer error detected — resetting model refs for clean reload");
        modelRef.current = null;
        processorRef.current = null;
        setReady(false);
        localStorage.setItem("localModelReady", "false");
        throw new Error(
          "GPU buffer error during inference. The model will reload automatically — please try again."
        );
      }

      throw err;
    }
  }, []);

  // ── analyzeImage ────────────────────────────────────────────────────────────
  const analyzeImage = useCallback(async (imageData: string, prompt: string): Promise<string> => {
    const model = modelRef.current;
    const processor = processorRef.current;
    if (!model || !processor) {
      throw new Error("Local model not loaded");
    }

    const transformers = transformersRef.current;

    const messages = [
      {
        role: "user",
        content: [
          { type: "image" },
          { type: "text", text: prompt },
        ],
      },
    ];

    const chatPrompt = processor.apply_chat_template(messages, {
      enable_thinking: false,
      add_generation_prompt: true,
    });

    const image = await transformers.RawImage.read(imageData);
    const inputs = await processor(chatPrompt, image, null, { add_special_tokens: false });

    const inputLen = inputs.input_ids.dims[inputs.input_ids.dims.length - 1] as number;

    try {
      const outputs = await model.generate({
        ...inputs,
        max_new_tokens: 512,
        do_sample: false,
        temperature: 0.3,
      });

      const newTokens = outputs.slice(null, [inputLen, null]);
      const decoded = processor.batch_decode(newTokens, { skip_special_tokens: true });
      return decoded[0] ?? "";
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      console.error("[useLocalModel] analyzeImage generate error:", msg);

      if (
        msg.includes("GPUBuffer") ||
        msg.includes("OrtRun") ||
        msg.includes("mapAsync") ||
        msg.includes("Invalid Buffer")
      ) {
        console.warn("[useLocalModel] WebGPU buffer error in analyzeImage — resetting model refs");
        modelRef.current = null;
        processorRef.current = null;
        setReady(false);
        localStorage.setItem("localModelReady", "false");
        throw new Error(
          "GPU buffer error during image analysis. The model will reload automatically — please try again."
        );
      }

      throw err;
    }
  }, []);

  return {
    variant,
    downloadingVariant,
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
