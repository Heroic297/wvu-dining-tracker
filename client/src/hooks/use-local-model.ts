/**
 * useLocalModel — React hook for managing a local Gemma 4 model via @huggingface/transformers.
 *
 * Uses Gemma4ForConditionalGeneration + AutoProcessor (NOT pipeline()) since
 * the ONNX community models are multimodal conditional-generation models.
 *
 * WebGPU is REQUIRED — there is no WASM/CPU fallback.
 * Root cause: Gemma 4 E2B/E4B use Per-Layer Embeddings (PLE). Every quantized
 * dtype variant (q4f16, q4, q8/_quantized) uses the com.microsoft.GatherBlockQuantized
 * ONNX op in the embed_tokens session. That op is only implemented in the WebGPU
 * execution provider — the browser WASM/CPU ORT build does not have it. The fp16/fp32
 * variants avoid GatherBlockQuantized but are 11–47 GB, which OOMs any browser tab.
 *
 * On WebGPU buffer crash (OrtRun ERROR_CODE:1 / mapAsync / GPUBuffer invalid):
 *   - Surface a clear "WebGPU failed — try refreshing or use a different GPU" message
 *   - Clear model refs so the hook is clean
 *   - Throw so the caller's onError handler clears the pending chat message
 *   - Do NOT set a wasm flag — there is no valid WASM recovery path for this model
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

const WEBGPU_CRASH_MSG =
  "GPU error during generation — try refreshing the page. If this keeps happening, use the cloud model instead.";

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

  // Clean up any stale forceWasm flag from previous versions — there is no WASM path
  useEffect(() => {
    localStorage.removeItem("localModelForceWasm");
    // If WebGPU is not available at all, mark model as not ready so the user
    // doesn't get stuck in an unrecoverable state from a previous session
    if (!hasWebGPU && localStorage.getItem("localModelReady") === "true") {
      localStorage.setItem("localModelReady", "false");
      setReady(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { variantRef.current = variant; }, [variant]);

  useEffect(() => {
    if (variant && !modelRef.current && !loading && hasWebGPU) {
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
   * Core loader. Always WebGPU + q4f16. No silent mode, no WASM path.
   */
  const loadModelInternal = async (v: ModelVariant) => {
    try {
      setLoading(true);
      setDownloadingVariant(v);
      setError(null);
      setStatusText("Initializing...");

      const transformers = await loadTransformers();
      const modelId = MODEL_IDS[v];

      console.log(`[useLocalModel] Loading ${modelId} on webgpu (dtype=q4f16)...`);

      const processor = await transformers.AutoProcessor.from_pretrained(modelId, {
        progress_callback: handleProgress,
      });
      processorRef.current = processor;

      const model = await transformers.Gemma4ForConditionalGeneration.from_pretrained(modelId, {
        dtype: "q4f16",
        device: "webgpu",
        progress_callback: handleProgress,
      });
      modelRef.current = model;

      console.log(`[useLocalModel] Model loaded on webgpu (dtype=q4f16)`);

      setReady(true);
      setVariant(v);
      setStatusText("Model ready");
      variantRef.current = v;
      localStorage.setItem("localModelVariant", v);
      localStorage.setItem("localModelReady", "true");
    } catch (err: any) {
      console.error(`[useLocalModel] load error:`, err);
      if (isReloadRef.current) {
        setError("Model needs to be reloaded. Tap Download to retry.");
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
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

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
   *   - Surface an actionable error message
   *   - Clear model refs (hook is clean for next attempt)
   *   - Throw so caller's onError clears the pending message
   *   There is no WASM fallback for this model architecture.
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
        console.warn("[useLocalModel] WebGPU buffer error — clearing model refs and surfacing error.");
        modelRef.current = null;
        processorRef.current = null;
        setReady(false);
        setError(WEBGPU_CRASH_MSG);
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
