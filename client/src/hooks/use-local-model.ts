/**
 * useLocalModel — React hook for managing a local Gemma 4 model via @huggingface/transformers.
 *
 * Uses Gemma4ForConditionalGeneration + AutoProcessor (NOT pipeline()) since
 * the ONNX community models are multimodal conditional-generation models.
 *
 * - Lazy-loads @huggingface/transformers via dynamic import (never in main bundle)
 * - Manages model download, progress, localStorage persistence, and inference
 * - Exposes generateText (coach chat) and analyzeImage (photo logging)
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
  // We check `variant` (persisted in localStorage), NOT `ready` — because `ready` may have
  // been set to "false" by an earlier failed reload while the actual model files are still
  // in Cache Storage. The reload will either succeed (setting ready=true) or fail gracefully.
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

  /**
   * progress_callback handler for transformers.js v4.
   * - "progress_total": aggregate progress across all files (0-100)
   * - "initiate": a file download is starting
   * - "progress": per-file byte progress (loaded/total)
   * - "download": file download actively happening
   * - "done": a file finished downloading
   * - "ready": everything loaded
   */
  const handleProgress = (p: any) => {
    if (p.status === "progress_total") {
      const pct = Math.round(p.progress ?? 0);
      setDownloadProgress(pct);
      setStatusText(`Downloading model... ${pct}%`);
    } else if (p.status === "initiate") {
      setStatusText(`Preparing ${p.file ?? "model files"}...`);
    } else if (p.status === "progress") {
      // Per-file byte tracking for the MB counter
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

      // Load processor (tokenizer + image/audio processor)
      setStatusText("Loading processor...");
      const processor = await transformers.AutoProcessor.from_pretrained(modelId, {
        progress_callback: handleProgress,
      });
      processorRef.current = processor;
      console.log("[useLocalModel] Processor loaded");

      // Load the model itself — this is the big download
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
        // Cache reload failed — don't nuke localStorage.
        // Keep variant/ready so UI still shows "Installed" and user can retry.
        // Show a non-destructive error.
        console.warn("[useLocalModel] Cache reload failed — model may need re-download.");
        setError("Model needs to be reloaded. Tap the button to retry.");
        setStatusText("");
        // Don't touch ready/variant/localStorage — files may still be in Cache Storage
      } else {
        // Fresh download failed — reset everything
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

    // Use ModelRegistry API if available (transformers.js v4)
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

    // Fallback: manually clear Cache Storage
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

  const generateText = useCallback(async (messages: Array<{ role: string; content: string }>): Promise<string> => {
    const model = modelRef.current;
    const processor = processorRef.current;
    if (!model || !processor) {
      throw new Error("Local model not loaded");
    }

    // Build the prompt via the processor's chat template
    const prompt = processor.apply_chat_template(messages, {
      enable_thinking: false,
      add_generation_prompt: true,
    });

    // Tokenize (text-only, no image/audio)
    const inputs = await processor(prompt, null, null, { add_special_tokens: false });

    const outputs = await model.generate({
      ...inputs,
      max_new_tokens: 1024,
      do_sample: true,
      temperature: 0.7,
    });

    // Decode only the new tokens (skip the input prompt)
    const decoded = processor.batch_decode(
      outputs.slice(null, [inputs.input_ids.dims.at(-1), null]),
      { skip_special_tokens: true },
    );
    return decoded[0] ?? "";
  }, []);

  const analyzeImage = useCallback(async (imageData: string, prompt: string): Promise<string> => {
    const model = modelRef.current;
    const processor = processorRef.current;
    if (!model || !processor) {
      throw new Error("Local model not loaded");
    }

    const transformers = transformersRef.current;

    // Build multimodal message
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

    // Load the image via transformers.js helper
    const image = await transformers.RawImage.read(imageData);

    // Process text + image together
    const inputs = await processor(chatPrompt, image, null, { add_special_tokens: false });

    const outputs = await model.generate({
      ...inputs,
      max_new_tokens: 1024,
      do_sample: false,
      temperature: 0.3,
    });

    const decoded = processor.batch_decode(
      outputs.slice(null, [inputs.input_ids.dims.at(-1), null]),
      { skip_special_tokens: true },
    );
    return decoded[0] ?? "";
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
