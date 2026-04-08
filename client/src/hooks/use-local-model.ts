/**
 * useLocalModel — React hook for managing a local Gemma 4 model via @huggingface/transformers.
 *
 * Uses Gemma4ForConditionalGeneration + AutoProcessor (NOT pipeline()) since
 * the ONNX community models are multimodal conditional-generation models.
 *
 * Fix (2026-04-07 v6): Remove the silent WASM fallback reload entirely.
 *
 * Root cause of the infinite spinner in v3–v5:
 *   The silent wasm reload downloads a completely different set of ONNX files
 *   (different dtype suffix = different filenames = cache miss). For a ~4B model
 *   this means downloading 1–2 GB in the background with zero UI feedback, which
 *   either hangs indefinitely, OOMs the browser tab, or (for q4/q4f16) hits a
 *   GatherBlockQuantized kernel-not-found error anyway.
 *
 * Correct behavior on WebGPU buffer crash:
 *   1. Mark forceWasmRef = true so subsequent page loads use wasm from the start.
 *   2. Surface an explicit, actionable error to the user immediately.
 *   3. Do NOT attempt a silent background reload — there is no valid recovery path
 *      that doesn't require a full page refresh with wasm pre-selected.
 *
 * Users on WebGPU-broken browsers will see: "Your GPU ran into an issue. The
 * model has been set to CPU mode — please refresh the page to reload it."
 * On next load, forceWasmRef is re-initialised from localStorage("localModelWasm")
 * and loadModelInternal picks wasm from the start, with full progress UI.
 */
import { useState, useEffect, useRef, useCallback } from "react";

export type ModelVariant = "E2B" | "E4B";

interface LocalModelState {
  variant: ModelVariant | null;
  downloadingVariant: ModelVariant | null;
  ready: boolean;
  loading: boolean;
  downloadProgress: number;
  downloadedBytes: number;
  totalBytes: number;
  statusText: string;
  hasWebGPU: boolean;
  error: string | null;
  downloadModel: (variant: ModelVariant) => Promise<void>;
  removeModel: () => Promise<void>;
  generateText: (messages: Array<{ role: string; content: string }>) => Promise<string>;
  analyzeImage: (imageData: string, prompt: string) => Promise<string>;
}

const MODEL_IDS: Record<ModelVariant, string> = {
  E2B: "onnx-community/gemma-4-E2B-it-ONNX",
  E4B: "onnx-community/gemma-4-E4B-it-ONNX",
};

const WEBGPU_ERROR_MSG =
  "Your GPU ran into an issue. The model has been set to CPU mode — please refresh the page to reload it.";

function isWebGpuBufferError(err: any): boolean {
  const msg: string = err?.message ?? "";
  return (
    msg.includes("GPUBuffer") ||
    msg.includes("OrtRun") ||
    msg.includes("mapAsync") ||
    msg.includes("Invalid Buffer") ||
    msg.includes("buffer_manager") ||
    msg.includes("GatherBlockQuantized") ||
    msg.includes("Kernel not found")
  );
}

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
  const [hasWebGPU] = useState(() => !!(navigator as any).gpu);

  const modelRef = useRef<any>(null);
  const processorRef = useRef<any>(null);
  const transformersRef = useRef<any>(null);
  const variantRef = useRef<ModelVariant | null>(null);
  const isReloadRef = useRef(false);
  // Persisted across page loads via localStorage — once a WebGPU crash is seen,
  // all future loads in the same browser use wasm from the start (full progress UI).
  const forceWasmRef = useRef(
    localStorage.getItem("localModelForceWasm") === "true"
  );

  useEffect(() => { variantRef.current = variant; }, [variant]);

  useEffect(() => {
    if (variant && !modelRef.current && !loading) {
      isReloadRef.current = true;
      loadModelInternal(variant);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadTransformers = async () => {
    if (transformersRef.current) return transformersRef.current;
    const mod = await import("@huggingface/transformers");
    transformersRef.current = mod;
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

  /**
   * Core loader. Always runs with full UI feedback (no silent mode).
   * Device priority: forceWasm flag → WebGPU capability check.
   * dtype: "q4f16" on webgpu, "q8" on wasm (q4/q4f16 use GatherBlockQuantized,
   * a WebGPU-only kernel not present in the browser WASM ORT build).
   */
  const loadModelInternal = async (
    v: ModelVariant,
    overrideDevice?: "webgpu" | "wasm"
  ) => {
    try {
      setLoading(true);
      setDownloadingVariant(v);
      setError(null);
      setStatusText("Initializing...");

      const transformers = await loadTransformers();
      const modelId = MODEL_IDS[v];

      // Device priority: explicit override → forceWasm flag → capability check
      const device: "webgpu" | "wasm" =
        overrideDevice ?? (forceWasmRef.current ? "wasm" : hasWebGPU ? "webgpu" : "wasm");

      // q4f16 uses GatherBlockQuantized (WebGPU-only); q8 maps to _quantized
      // files that use standard INT8 ops supported by the WASM execution provider.
      const dtype = device === "wasm" ? "q8" : "q4f16";

      console.log(`[useLocalModel] Loading ${modelId} on ${device} (dtype=${dtype})...`);

      const processor = await transformers.AutoProcessor.from_pretrained(modelId, {
        progress_callback: handleProgress,
      });
      processorRef.current = processor;

      const model = await transformers.Gemma4ForConditionalGeneration.from_pretrained(modelId, {
        dtype,
        device,
        progress_callback: handleProgress,
      });
      modelRef.current = model;

      console.log(`[useLocalModel] Model loaded on ${device} (dtype=${dtype})`);

      setReady(true);
      setVariant(v);
      setStatusText("Model ready");
      variantRef.current = v;
      localStorage.setItem("localModelVariant", v);
      localStorage.setItem("localModelReady", "true");
    } catch (err: any) {
      console.error(`[useLocalModel] load error:`, err);
      if (isReloadRef.current) {
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
    await loadModelInternal(v);
  }, [loading, hasWebGPU]); // eslint-disable-line react-hooks/exhaustive-deps

  const removeModel = useCallback(async () => {
    const currentVariant = variantRef.current;
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
          return;
        }
      } catch { /* fall through */ }
    }

    try {
      const cacheNames = await caches.keys();
      for (const name of cacheNames) {
        if (name.includes("transformers") || name.includes("onnx")) {
          await caches.delete(name);
        }
      }
    } catch { /* Cache API may not be available */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Run inference. On WebGPU buffer crash:
   *   1. Persist the wasm preference to localStorage (survives page reload).
   *   2. Mark the model as not ready and surface an actionable error.
   *   3. Throw so the caller's onError handler clears the pending message.
   *   Do NOT attempt a silent background reload — the wasm fallback requires
   *   downloading different ONNX files (q8/_quantized suffix) which takes
   *   minutes with no UI feedback and will hang the tab.
   */
  async function runGenerate(
    buildInputs: (processor: any) => Promise<{ inputs: any; inputLen: number }>,
    genOptions: object
  ): Promise<string> {
    const model = modelRef.current;
    const processor = processorRef.current;
    if (!model || !processor) throw new Error("Local model not loaded");

    const { inputs, inputLen } = await buildInputs(processor);

    try {
      const outputs = await model.generate({ ...inputs, ...genOptions });
      const newTokens = outputs.slice(null, [inputLen, null]);
      const decoded = processor.batch_decode(newTokens, { skip_special_tokens: true });
      return decoded[0] ?? "";
    } catch (err: any) {
      console.error(`[useLocalModel] generate error:`, err?.message);

      if (isWebGpuBufferError(err)) {
        console.warn(
          "[useLocalModel] WebGPU buffer/kernel error — marking wasm preference and prompting refresh."
        );
        // Persist so the NEXT page load auto-selects wasm with full download UI
        forceWasmRef.current = true;
        localStorage.setItem("localModelForceWasm", "true");
        // Mark model as unavailable so the UI doesn't try to use it again
        modelRef.current = null;
        processorRef.current = null;
        setReady(false);
        setError(WEBGPU_ERROR_MSG);
        localStorage.setItem("localModelReady", "false");
      }

      throw err;
    }
  }

  const generateText = useCallback(async (
    messages: Array<{ role: string; content: string }>
  ): Promise<string> => {
    return runGenerate(
      async (processor) => {
        const prompt = processor.apply_chat_template(messages, {
          enable_thinking: false,
          add_generation_prompt: true,
        });
        const inputs = await processor(prompt, null, null, { add_special_tokens: false });
        const inputLen = inputs.input_ids.dims[inputs.input_ids.dims.length - 1] as number;
        return { inputs, inputLen };
      },
      { max_new_tokens: 512, do_sample: true, temperature: 0.7 }
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const analyzeImage = useCallback(async (
    imageData: string,
    prompt: string
  ): Promise<string> => {
    return runGenerate(
      async (processor) => {
        const transformers = transformersRef.current;
        const messages = [{
          role: "user",
          content: [
            { type: "image" },
            { type: "text", text: prompt },
          ],
        }];
        const chatPrompt = processor.apply_chat_template(messages, {
          enable_thinking: false,
          add_generation_prompt: true,
        });
        const image = await transformers.RawImage.read(imageData);
        const inputs = await processor(chatPrompt, image, null, { add_special_tokens: false });
        const inputLen = inputs.input_ids.dims[inputs.input_ids.dims.length - 1] as number;
        return { inputs, inputLen };
      },
      { max_new_tokens: 512, do_sample: false, temperature: 0.3 }
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
