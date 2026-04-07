/**
 * useLocalModel — React hook for managing a local Gemma 4 model via @huggingface/transformers.
 *
 * Uses Gemma4ForConditionalGeneration + AutoProcessor (NOT pipeline()) since
 * the ONNX community models are multimodal conditional-generation models.
 *
 * Fix (2026-04-07 v2): Auto-retry on WebGPU OrtRun/mapAsync buffer failure.
 * Root cause: ONNX Runtime WebGPU backend on Windows invalidates GPUBuffers on the
 * first inference call after model load. Previous fix reset refs and threw, requiring
 * manual retry. This version reloads the model silently then re-runs the same
 * inference automatically — user never sees a failure on the first call.
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

function isWebGpuBufferError(err: any): boolean {
  const msg: string = err?.message ?? "";
  return (
    msg.includes("GPUBuffer") ||
    msg.includes("OrtRun") ||
    msg.includes("mapAsync") ||
    msg.includes("Invalid Buffer")
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

  // Keep variantRef in sync so loadModelInternal can read it without stale closure
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
   * Core loader — can be called both for initial download and for silent reload
   * after a WebGPU buffer error. When silent=true it skips UI state updates so
   * the user doesn't see a loading screen mid-conversation.
   */
  const loadModelInternal = async (v: ModelVariant, silent = false) => {
    try {
      if (!silent) {
        setLoading(true);
        setDownloadingVariant(v);
        setError(null);
        setStatusText("Initializing...");
      }

      const transformers = await loadTransformers();
      const modelId = MODEL_IDS[v];
      const device = hasWebGPU ? "webgpu" : "wasm";

      console.log(`[useLocalModel] Loading ${modelId} on ${device} (silent=${silent})...`);

      const processor = await transformers.AutoProcessor.from_pretrained(modelId, {
        progress_callback: silent ? undefined : handleProgress,
      });
      processorRef.current = processor;

      const model = await transformers.Gemma4ForConditionalGeneration.from_pretrained(modelId, {
        dtype: "q4f16",
        device,
        progress_callback: silent ? undefined : handleProgress,
      });
      modelRef.current = model;

      console.log(`[useLocalModel] Model loaded (silent=${silent})`);

      if (!silent) {
        setReady(true);
        setVariant(v);
        setStatusText("Model ready");
      } else {
        // Restore ready state after silent reload
        setReady(true);
      }

      variantRef.current = v;
      localStorage.setItem("localModelVariant", v);
      localStorage.setItem("localModelReady", "true");
    } catch (err: any) {
      console.error(`[useLocalModel] load error (silent=${silent}):`, err);
      if (!silent) {
        if (isReloadRef.current) {
          setError("Model needs to be reloaded. Tap the button to retry.");
          setStatusText("");
        } else {
          setError(err.message ?? "Failed to load model");
          setStatusText("");
          setReady(false);
          localStorage.setItem("localModelReady", "false");
        }
      } else {
        // Silent reload failed — surface error now
        setError("GPU context lost and could not recover. Please refresh the page.");
        setReady(false);
        localStorage.setItem("localModelReady", "false");
        throw err;
      }
    } finally {
      if (!silent) {
        setLoading(false);
        setDownloadingVariant(null);
        isReloadRef.current = false;
      }
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
   * Run inference, with one automatic silent reload+retry on WebGPU buffer failure.
   * Pattern:
   *   1. Try generate()
   *   2. If OrtRun/GPUBuffer/mapAsync error → silently reload model from cache
   *   3. Re-run generate() with the fresh model
   *   4. If second attempt also fails → throw so caller can surface the error
   */
  async function runGenerate(
    buildInputs: (processor: any) => Promise<{ inputs: any; inputLen: number }>,
    genOptions: object,
    attempt = 0
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
      console.error(`[useLocalModel] generate error (attempt ${attempt}):`, err?.message);

      if (isWebGpuBufferError(err) && attempt === 0) {
        console.warn("[useLocalModel] WebGPU buffer error — silently reloading model and retrying...");
        modelRef.current = null;
        processorRef.current = null;

        const v = variantRef.current;
        if (!v) throw new Error("No model variant stored — cannot reload.");

        // Silent reload from browser cache (no UI loading state)
        await loadModelInternal(v, true);

        // Recursive retry with fresh refs
        return runGenerate(buildInputs, genOptions, 1);
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
