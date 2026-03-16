/**
 * BarcodeScanner — camera overlay that decodes UPC/EAN barcodes in real time.
 *
 * Uses @zxing/browser (ZXing JS port) which handles:
 *   EAN-13, EAN-8, UPC-A, UPC-E, Code 128, QR Code
 *
 * Fires onDetected(code) exactly once, then auto-closes.
 * Caller is responsible for cleanup via onClose.
 */
import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, NotFoundException } from "@zxing/browser";
import { X, ScanBarcode, CameraOff } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BarcodeScannerProps {
  onDetected: (code: string) => void;
  onClose: () => void;
}

export default function BarcodeScanner({ onDetected, onClose }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const detectedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(true);

  useEffect(() => {
    let controlsRef: { stop: () => void } | null = null;

    async function startScanner() {
      if (!videoRef.current) return;

      try {
        const reader = new BrowserMultiFormatReader();
        readerRef.current = reader;

        // Pick the back (environment) camera on mobile; falls back to default
        const devices = await BrowserMultiFormatReader.listVideoInputDevices();
        const backCam = devices.find((d) =>
          /back|rear|environment/i.test(d.label)
        ) ?? devices[0];

        const deviceId = backCam?.deviceId ?? undefined;

        const controls = await reader.decodeFromVideoDevice(
          deviceId,
          videoRef.current,
          (result, err) => {
            if (result && !detectedRef.current) {
              detectedRef.current = true;
              setScanning(false);
              controls?.stop();
              onDetected(result.getText());
            }
            // NotFoundException fires every frame when no barcode is visible — ignore it
            if (err && !(err instanceof NotFoundException)) {
              console.warn("[BarcodeScanner]", err);
            }
          }
        );

        controlsRef = controls as any;
      } catch (e: any) {
        console.error("[BarcodeScanner] start error:", e);
        if (e?.name === "NotAllowedError" || e?.message?.includes("Permission")) {
          setError("Camera access denied. Please allow camera permissions and try again.");
        } else if (e?.name === "NotFoundError") {
          setError("No camera found on this device.");
        } else {
          setError("Could not start camera. Try using the manual search instead.");
        }
        setScanning(false);
      }
    }

    startScanner();

    return () => {
      controlsRef?.stop();
    };
  }, [onDetected]);

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="relative w-full max-w-md bg-card rounded-t-2xl md:rounded-2xl overflow-hidden shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <ScanBarcode className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold">Scan barcode</span>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close scanner"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Camera viewport */}
        <div className="relative bg-black" style={{ aspectRatio: "4/3" }}>
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            autoPlay
            muted
            playsInline
          />

          {/* Aiming reticle */}
          {scanning && !error && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              {/* Dimmed surround */}
              <div className="absolute inset-0 bg-black/30" />
              {/* Clear scan window */}
              <div
                className="relative z-10"
                style={{ width: "72%", height: "30%" }}
              >
                {/* Corner markers */}
                {["top-left", "top-right", "bottom-left", "bottom-right"].map((pos) => {
                  const isTop    = pos.includes("top");
                  const isLeft   = pos.includes("left");
                  return (
                    <div
                      key={pos}
                      className="absolute w-6 h-6"
                      style={{
                        top:    isTop    ? 0 : "auto",
                        bottom: !isTop   ? 0 : "auto",
                        left:   isLeft   ? 0 : "auto",
                        right:  !isLeft  ? 0 : "auto",
                        borderTop:    isTop    ? "3px solid hsl(var(--primary))" : "none",
                        borderBottom: !isTop   ? "3px solid hsl(var(--primary))" : "none",
                        borderLeft:   isLeft   ? "3px solid hsl(var(--primary))" : "none",
                        borderRight:  !isLeft  ? "3px solid hsl(var(--primary))" : "none",
                      }}
                    />
                  );
                })}
                {/* Scan line animation */}
                <div
                  className="absolute left-0 right-0 h-px bg-primary/70"
                  style={{ animation: "scan-line 1.8s ease-in-out infinite", top: "50%" }}
                />
              </div>
            </div>
          )}

          {/* Error state */}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 p-6 text-center">
              <CameraOff className="w-10 h-10 text-muted-foreground" />
              <p className="text-sm text-white">{error}</p>
              <Button size="sm" variant="outline" onClick={onClose}>Close</Button>
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-3 text-center">
          <p className="text-xs text-muted-foreground">
            {scanning
              ? "Point camera at a product barcode or QR code"
              : error
              ? ""
              : "Barcode detected — looking up nutrition…"}
          </p>
        </div>
      </div>

      {/* Scan line keyframe — injected once */}
      <style>{`
        @keyframes scan-line {
          0%   { top: 10%; }
          50%  { top: 90%; }
          100% { top: 10%; }
        }
      `}</style>
    </div>
  );
}
