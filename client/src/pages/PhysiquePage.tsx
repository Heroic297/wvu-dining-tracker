import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { kgToLbs } from "@/lib/api";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Camera,
  Trash2,
  Loader2,
  ImagePlus,
  ArrowLeftRight,
} from "lucide-react";

interface PhysiquePhoto {
  id: string;
  photo_url: string;
  photo_date: string;
  weight_kg: number | null;
  body_fat_pct: number | null;
  notes: string | null;
}

const LBS_PER_KG = 2.20462;

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function photoLabel(p: PhysiquePhoto): string {
  const dateStr = format(new Date(p.photo_date + "T12:00:00"), "MMM d, yyyy");
  const weightStr =
    p.weight_kg != null ? ` - ${kgToLbs(p.weight_kg)} lbs` : "";
  return `${dateStr}${weightStr}`;
}

export default function PhysiquePage() {
  const [activeTab, setActiveTab] = useState("timeline");

  // --- Shared photo query ---
  const {
    data: photos = [],
    isLoading: photosLoading,
  } = useQuery<PhysiquePhoto[]>({
    queryKey: ["/api/physique/photos"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/physique/photos");
      return res.json();
    },
  });

  const sortedPhotos = [...photos].sort(
    (a, b) =>
      new Date(b.photo_date).getTime() - new Date(a.photo_date).getTime(),
  );

  // --- Delete mutation ---
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/physique/photos/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/physique/photos"] });
    },
  });

  // --- Add Photo state ---
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [photoDate, setPhotoDate] = useState(todayISO());
  const [weightLbs, setWeightLbs] = useState("");
  const [bodyFatPct, setBodyFatPct] = useState("");
  const [notes, setNotes] = useState("");

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile) throw new Error("No file selected");

      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(selectedFile);
      });

      const weightKg =
        weightLbs.trim() !== ""
          ? parseFloat(weightLbs) / LBS_PER_KG
          : null;
      const bfPct =
        bodyFatPct.trim() !== "" ? parseFloat(bodyFatPct) : null;

      await apiRequest("POST", "/api/physique/photos", {
        photoUrl: dataUrl,
        photoDate,
        weightKg,
        bodyFatPct: bfPct,
        notes: notes.trim() || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/physique/photos"] });
      setSelectedFile(null);
      setPhotoDate(todayISO());
      setWeightLbs("");
      setBodyFatPct("");
      setNotes("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      setActiveTab("timeline");
    },
  });

  // --- Compare state ---
  const [photoId1, setPhotoId1] = useState("");
  const [photoId2, setPhotoId2] = useState("");
  const [compareResult, setCompareResult] = useState<{
    analysis: string;
    photo1: PhysiquePhoto;
    photo2: PhysiquePhoto;
  } | null>(null);

  const compareMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/physique/compare", {
        photoId1,
        photoId2,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      const p1 = photos.find((p) => p.id === photoId1);
      const p2 = photos.find((p) => p.id === photoId2);
      if (p1 && p2) {
        setCompareResult({
          analysis: data.analysis ?? data.text ?? JSON.stringify(data),
          photo1: p1,
          photo2: p2,
        });
      }
    },
  });

  return (
    <div className="p-4 md:p-6 max-w-2xl space-y-6">
      <h1 className="text-xl font-bold flex items-center gap-2">
        <Camera className="w-5 h-5 text-primary" />
        Physique Tracker
      </h1>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full">
          <TabsTrigger value="timeline" className="flex-1">
            Timeline
          </TabsTrigger>
          <TabsTrigger value="add" className="flex-1">
            Add Photo
          </TabsTrigger>
          <TabsTrigger value="compare" className="flex-1">
            Compare
          </TabsTrigger>
        </TabsList>

        {/* ===== Timeline Tab ===== */}
        <TabsContent value="timeline">
          <section className="bg-card border border-border rounded-xl p-4 space-y-4">
            <h2 className="text-sm font-semibold text-muted-foreground">
              Progress Photos
            </h2>

            {photosLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {!photosLoading && sortedPhotos.length === 0 && (
              <div className="text-center py-12">
                <Camera className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  No progress photos yet. Add your first photo to start
                  tracking.
                </p>
              </div>
            )}

            {!photosLoading && sortedPhotos.length > 0 && (
              <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                {sortedPhotos.map((photo) => (
                  <div
                    key={photo.id}
                    className="flex gap-3 bg-slate-950 border border-slate-800 rounded-lg p-3"
                  >
                    <img
                      src={photo.photo_url}
                      alt={`Progress photo ${photo.photo_date}`}
                      className="w-20 h-20 object-cover rounded-md flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0 space-y-1">
                      <p className="text-sm font-medium text-slate-100">
                        {format(
                          new Date(photo.photo_date + "T12:00:00"),
                          "MMMM d, yyyy",
                        )}
                      </p>
                      {photo.weight_kg != null && (
                        <p className="text-xs text-muted-foreground">
                          {kgToLbs(photo.weight_kg)} lbs
                        </p>
                      )}
                      {photo.body_fat_pct != null && (
                        <p className="text-xs text-muted-foreground">
                          {photo.body_fat_pct}% body fat
                        </p>
                      )}
                      {photo.notes && (
                        <p className="text-xs text-muted-foreground truncate">
                          {photo.notes}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive flex-shrink-0 self-start"
                      onClick={() => deleteMutation.mutate(photo.id)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </TabsContent>

        {/* ===== Add Photo Tab ===== */}
        <TabsContent value="add">
          <section className="bg-card border border-border rounded-xl p-4 space-y-4">
            <h2 className="text-sm font-semibold text-muted-foreground">
              New Progress Photo
            </h2>

            <div className="space-y-1">
              <Label className="text-xs">Photo</Label>
              <Input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(e) =>
                  setSelectedFile(e.target.files?.[0] ?? null)
                }
                className="h-9 text-sm file:text-sm file:font-medium"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Date</Label>
              <Input
                type="date"
                value={photoDate}
                onChange={(e) => setPhotoDate(e.target.value)}
                className="h-9 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Weight (lbs)</Label>
                <Input
                  type="number"
                  placeholder="Optional"
                  value={weightLbs}
                  onChange={(e) => setWeightLbs(e.target.value)}
                  className="h-9 text-sm"
                  step="0.1"
                  min="0"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Body Fat %</Label>
                <Input
                  type="number"
                  placeholder="Optional"
                  value={bodyFatPct}
                  onChange={(e) => setBodyFatPct(e.target.value)}
                  className="h-9 text-sm"
                  step="0.1"
                  min="0"
                  max="100"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Notes</Label>
              <Textarea
                placeholder="Optional notes about this photo..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="text-sm resize-none"
                rows={3}
              />
            </div>

            <Button
              className="w-full"
              onClick={() => uploadMutation.mutate()}
              disabled={!selectedFile || uploadMutation.isPending}
            >
              {uploadMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Uploading...
                </>
              ) : (
                <>
                  <ImagePlus className="w-4 h-4 mr-2" />
                  Save Photo
                </>
              )}
            </Button>

            {uploadMutation.isError && (
              <p className="text-xs text-destructive">
                {(uploadMutation.error as Error).message}
              </p>
            )}
          </section>
        </TabsContent>

        {/* ===== Compare Tab ===== */}
        <TabsContent value="compare">
          <section className="bg-card border border-border rounded-xl p-4 space-y-4">
            <h2 className="text-sm font-semibold text-muted-foreground">
              Compare Photos
            </h2>

            {sortedPhotos.length < 2 ? (
              <div className="text-center py-8">
                <ArrowLeftRight className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  You need at least two photos to compare. Add more photos
                  first.
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Photo 1</Label>
                    <Select value={photoId1} onValueChange={setPhotoId1}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Select photo..." />
                      </SelectTrigger>
                      <SelectContent>
                        {sortedPhotos.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {photoLabel(p)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Photo 2</Label>
                    <Select value={photoId2} onValueChange={setPhotoId2}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Select photo..." />
                      </SelectTrigger>
                      <SelectContent>
                        {sortedPhotos.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {photoLabel(p)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Button
                  className="w-full"
                  onClick={() => compareMutation.mutate()}
                  disabled={
                    !photoId1 ||
                    !photoId2 ||
                    photoId1 === photoId2 ||
                    compareMutation.isPending
                  }
                >
                  {compareMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <ArrowLeftRight className="w-4 h-4 mr-2" />
                      Compare with AI
                    </>
                  )}
                </Button>

                {compareMutation.isError && (
                  <p className="text-xs text-destructive">
                    {(compareMutation.error as Error).message}
                  </p>
                )}

                {compareResult && (
                  <div className="space-y-4 mt-2">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <img
                          src={compareResult.photo1.photo_url}
                          alt="Photo 1"
                          className="w-full aspect-square object-cover rounded-lg border border-slate-800"
                        />
                        <p className="text-xs text-center text-muted-foreground">
                          {format(
                            new Date(
                              compareResult.photo1.photo_date + "T12:00:00",
                            ),
                            "MMM d, yyyy",
                          )}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <img
                          src={compareResult.photo2.photo_url}
                          alt="Photo 2"
                          className="w-full aspect-square object-cover rounded-lg border border-slate-800"
                        />
                        <p className="text-xs text-center text-muted-foreground">
                          {format(
                            new Date(
                              compareResult.photo2.photo_date + "T12:00:00",
                            ),
                            "MMM d, yyyy",
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
                      <h3 className="text-sm font-semibold text-slate-100 mb-2">
                        AI Analysis
                      </h3>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                        {compareResult.analysis}
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
