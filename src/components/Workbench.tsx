import React, { useState, useRef, useEffect } from "react";
import * as xlsx from "xlsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/src/components/ui/card";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Button } from "@/src/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";
import { Switch } from "@/src/components/ui/switch";
import {
  fileToBase64,
  createThumbnailBase64,
  stitchImagesVertically,
  blobToThumbnailBase64,
} from "@/src/lib/file-utils";
import {
  FolderUp,
  FileUp,
  Settings,
  Play,
  Pause,
  Image as ImageIcon,
  Loader2,
  ArrowLeft,
  Download,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Settings2,
  CheckSquare,
  Square,
  Link2,
  Maximize2,
  ShieldAlert,
  Sparkles,
  CheckCircle2,
  XCircle,
  SlidersHorizontal,
  FileText,
  AlertTriangle,
} from "lucide-react";

import * as CryptoJS from "crypto-js";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { useCachedImage, fetchLocalBlobUrl } from "@/src/lib/useCachedImage";
import {
  getImageFromCache,
  fetchUrlToBlobAndCache,
} from "@/src/lib/imageCache";
import { MetricRadarChart } from "@/src/components/MetricRadarChart";
import { exportToPsd } from "@/src/lib/psd-export";
import { SettingsPanel } from "@/src/components/SettingsPanel";
import {
  setLovartMode,
  saveLovartProject,
  uploadFileToLovart,
  submitLovartChat,
  getLovartChatStatus,
  getLovartChatResult,
  fetchProxyDownload,
  fetchImageBlob,
  saveTasksToServerState,
  loadTasksFromServerState,
  fetchAuditStatus,
} from "@/src/lib/api";

type FilterTab = "all" | "success" | "error" | "running";

// Lovart Direct API Helper
const signLovartRequest = (
  method: string,
  apiPath: string,
  accessKey: string,
  secretKey: string,
) => {
  const ts = Math.floor(Date.now() / 1000).toString();
  const payload = `${method.toUpperCase()}\n${apiPath}\n${ts}`;
  const sig = CryptoJS.HmacSHA256(payload, secretKey).toString(
    CryptoJS.enc.Hex,
  );
  return {
    "X-Access-Key": accessKey,
    "X-Timestamp": ts,
    "X-Signature": sig,
    "X-Signed-Method": method.toUpperCase(),
    "X-Signed-Path": apiPath,
  };
};

const convertGoogleDriveUrl = (url: string) => {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "drive.google.com") {
      let fileId = "";
      if (parsed.pathname.startsWith("/file/d/")) {
        fileId = parsed.pathname.split("/")[3];
      } else if (parsed.pathname === "/open" || parsed.pathname === "/uc") {
        fileId = parsed.searchParams.get("id") || "";
      }
      if (fileId) {
        return `https://drive.google.com/uc?export=view&id=${fileId}`;
      }
    }
    return url;
  } catch (e) {
    return url;
  }
};

interface GeneratedTask {
  id: string;
  prompt: string;
  referenceImage?: string; // Base64 or URL
  referenceImages?: string[]; // Multiple reference images
  referenceFiles?: File[]; // To defer fileToBase64 reading
  referenceFileKeys?: string[]; // Keys in imageCache for full-res survival across reloads
  fixedImage?: string; // Base64
  fixedImageKey?: string; // Key in imageCache for full-res fixed image template
  status: "pending" | "running" | "success" | "error";
  resultUrl?: string;
  errorMsg?: string;
  originalFilename?: string;
  originalPrompt?: string;
  tableImageUrl?: string;
  originalRow?: any;
  relativePath?: string; // For ZIP structure preserving
  retryCount?: number;
  reviewStatus?: "approved" | "rejected" | "none";
  progressMsg?: string;
  roundIndex?: number;
  groupId?: string;
  uploadedFixedImage?: string;
  uploadedReferenceImages?: string[];

  // Consistency Audit state
  auditStatus?: "none" | "pending" | "running" | "success" | "error";
  auditResult?: {
    scores: {
      structure: number;
      color: number;
      pattern: number;
      text: number;
      lighting: number;
    };
    pass: boolean;
    issues: Array<{
      type:
        | "text_error"
        | "structure_mismatch"
        | "color_mismatch"
        | "pattern_error";
      desc: string;
      bbox: [number, number, number, number];
    }>;
    reason: string;
  };
  auditError?: string;
}

export const exportTaskToPsdHelper = async (
  task: GeneratedTask,
  issues: any[],
  auto: boolean = false,
) => {
  let refUrls: string[] = [];
  let urlsToRevoke: string[] = [];

  if (task.referenceFiles && task.referenceFiles.length > 0) {
    refUrls = task.referenceFiles.map((f) => {
      const url = URL.createObjectURL(f);
      urlsToRevoke.push(url);
      return url;
    });
  } else if (task.referenceFileKeys && task.referenceFileKeys.length > 0) {
    try {
      const { getImageFromCache } = await import("@/src/lib/imageCache");
      for (const key of task.referenceFileKeys) {
        const blob = await getImageFromCache(key);
        if (blob) {
          const url = URL.createObjectURL(blob);
          urlsToRevoke.push(url);
          refUrls.push(url);
        }
      }
    } catch (e) {}
  }

  // Fallback if the above failed
  if (refUrls.length === 0) {
    if (
      task.uploadedReferenceImages &&
      task.uploadedReferenceImages.length > 0
    ) {
      refUrls = task.uploadedReferenceImages;
    } else if (task.referenceImages && task.referenceImages.length > 0) {
      refUrls = task.referenceImages;
    } else if (task.referenceImage) {
      refUrls = [task.referenceImage];
    }
  }

  const psdName = task.originalFilename
    ? `${task.originalFilename.replace(/\.[^/.]+$/, "")}.psd`
    : `audit_${task.id.slice(0, 8)}.psd`;
  try {
    if (!task.resultUrl) throw new Error("Result image is missing.");
    await exportToPsd(task.resultUrl, issues, refUrls, psdName);
  } catch (e: any) {
    console.error("PSD export failed", e);
    if (!auto) {
      alert("PSD导出失败: " + e.message);
    }
  } finally {
    urlsToRevoke.forEach((url) => URL.revokeObjectURL(url));
  }
};

const OriginalImageMagnifier = ({
  thumbnailUrl,
  file,
  className,
  imgClassName,
}: {
  thumbnailUrl: string;
  file?: File;
  className?: string;
  imgClassName?: string;
}) => {
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);

  useEffect(() => {
    if (file) {
      const tempUrl = URL.createObjectURL(file);
      setOriginalUrl(tempUrl);
      // Cleanup on unmount or file change
      return () => URL.revokeObjectURL(tempUrl);
    }
  }, [file]);

  return (
    <ImageMagnifier
      src={originalUrl || thumbnailUrl}
      className={className}
      imgClassName={imgClassName}
    />
  );
};

const HighResReferenceImage = ({
  file,
  fallbackUrl,
  className,
}: {
  file?: File;
  fallbackUrl: string;
  className?: string;
}) => {
  const [url, setUrl] = useState<string>(fallbackUrl);

  useEffect(() => {
    if (file) {
      const objectUrl = URL.createObjectURL(file);
      setUrl(objectUrl);
      return () => {
        URL.revokeObjectURL(objectUrl);
      };
    } else {
      setUrl(fallbackUrl);
    }
  }, [file, fallbackUrl]);

  return (
    <img
      src={url}
      className={className}
      alt="standard reference with original quality"
    />
  );
};

const ImageMagnifier = ({
  src,
  className,
  imgClassName,
  magnifierSize = 560,
  zoomLevel = 3,
}: {
  src: string;
  className?: string;
  imgClassName?: string;
  magnifierSize?: number;
  zoomLevel?: number;
}) => {
  const { url: cachedSrc, releaseBlob } = useCachedImage(src);
  const [show, setShow] = useState(false);
  const [magnifierUrl, setMagnifierUrl] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const magnifierRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    let urlToRevoke: string | null = null;
    if (show && src) {
      if (src.startsWith("blob:") || src.startsWith("data:")) {
        setMagnifierUrl(src);
      } else {
        fetchLocalBlobUrl(src).then((res) => {
          if (active) setMagnifierUrl(res);
          urlToRevoke = res;
        });
      }
    } else {
      setMagnifierUrl(null);
    }
    return () => {
      active = false;
      if (urlToRevoke && urlToRevoke.startsWith("blob:"))
        URL.revokeObjectURL(urlToRevoke);
    };
  }, [show, src]);

  return (
    <div
      className={`relative w-full h-full ${className || ""}`}
      onContextMenu={(e) => e.preventDefault()}
      onMouseEnter={() => setShow(true)}
      onMouseMove={(e) => {
        if (!imgRef.current || !magnifierRef.current || !show) return;

        const imgRect = imgRef.current.getBoundingClientRect();
        const { naturalWidth, naturalHeight } = imgRef.current;

        if (naturalWidth && naturalHeight) {
          const clientX = e.clientX;
          const clientY = e.clientY;
          const boxRatio = imgRect.width / imgRect.height;
          const imgRatio = naturalWidth / naturalHeight;

          let renderW = imgRect.width;
          let renderH = imgRect.height;
          let offsetX = 0;
          let offsetY = 0;

          if (imgClassName?.includes("object-contain")) {
            if (boxRatio > imgRatio) {
              renderH = imgRect.height;
              renderW = imgRect.height * imgRatio;
              offsetX = (imgRect.width - renderW) / 2;
            } else {
              renderW = imgRect.width;
              renderH = imgRect.width / imgRatio;
              offsetY = (imgRect.height - renderH) / 2;
            }
          } else if (imgClassName?.includes("object-cover")) {
            if (boxRatio > imgRatio) {
              renderW = imgRect.width;
              renderH = imgRect.width / imgRatio;
              offsetY = (imgRect.height - renderH) / 2;
            } else {
              renderH = imgRect.height;
              renderW = imgRect.height * imgRatio;
              offsetX = (imgRect.width - renderW) / 2;
            }
          }

          const imgX = clientX - imgRect.left - offsetX;
          const imgY = clientY - imgRect.top - offsetY;

          const rect = e.currentTarget.getBoundingClientRect();
          const localX = e.clientX - rect.left;
          const localY = e.clientY - rect.top;

          const el = magnifierRef.current;
          el.style.top = `${localY - magnifierSize / 2}px`;
          el.style.left = `${localX - magnifierSize / 2}px`;
          el.style.backgroundSize = `${renderW * zoomLevel}px ${renderH * zoomLevel}px`;
          el.style.backgroundPositionX = `${-(imgX * zoomLevel) + (magnifierSize - 8) / 2}px`;
          el.style.backgroundPositionY = `${-(imgY * zoomLevel) + (magnifierSize - 8) / 2}px`;
        }
      }}
      onMouseLeave={() => {
        setShow(false);
      }}
    >
      {cachedSrc ? (
        <img
          ref={imgRef}
          src={cachedSrc}
          className={imgClassName}
          alt="ref"
          decoding="async"
          loading="lazy"
          onLoad={releaseBlob}
        />
      ) : null}
      {show && magnifierUrl && (
        <div
          ref={magnifierRef}
          className="pointer-events-none absolute border-4 border-white shadow-xl z-50 rounded-full bg-white transition-opacity will-change-[top,left]"
          style={{
            height: magnifierSize,
            width: magnifierSize,
            backgroundImage: `url('${magnifierUrl}')`,
            backgroundRepeat: "no-repeat",
          }}
        />
      )}
    </div>
  );
};

const ResultImageRenderer = ({
  task,
  className,
}: {
  task: GeneratedTask;
  className?: string;
}) => {
  const { url: cachedSrc, releaseBlob } = useCachedImage(
    task.resultUrl,
    task.id,
  );
  if (!cachedSrc) return null;
  return (
    <img
      src={cachedSrc}
      loading="lazy"
      decoding="async"
      className={className}
      alt="Result"
      onLoad={releaseBlob}
    />
  );
};

const CachedThumbnail = ({
  url,
  cacheKey,
  className,
  alt,
  title,
}: {
  url: string;
  cacheKey?: string;
  className?: string;
  alt?: string;
  title?: string;
}) => {
  const { url: cachedSrc, releaseBlob } = useCachedImage(url, cacheKey);
  if (!cachedSrc) return null;
  return (
    <img
      src={cachedSrc}
      decoding="async"
      loading="lazy"
      className={className}
      alt={alt}
      title={title}
      onLoad={releaseBlob}
    />
  );
};

const TagCollectionPanel = ({
  type,
  tasks,
  onClose,
  onChangeStatus,
  onReview,
}: {
  type: "approved" | "rejected" | "none";
  tasks: GeneratedTask[];
  onClose: () => void;
  onChangeStatus: (
    indices: number[],
    newStatus: "approved" | "rejected" | "none",
  ) => void;
  onReview: (index: number) => void;
}) => {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pageIndex, setPageIndex] = useState(1);
  const PAGE_SIZE = 50;

  const filteredTasks = tasks
    .map((task, idx) => ({ task, idx }))
    .filter((item) =>
      type === "none"
        ? !item.task.reviewStatus || item.task.reviewStatus === "none"
        : item.task.reviewStatus === type,
    );
  const totalPages = Math.ceil(filteredTasks.length / PAGE_SIZE);
  const currentGrid = filteredTasks.slice(
    (pageIndex - 1) * PAGE_SIZE,
    pageIndex * PAGE_SIZE,
  );

  const isAllSelected =
    filteredTasks.length > 0 && selected.size === filteredTasks.length;

  const toggleAll = () => {
    if (isAllSelected) setSelected(new Set());
    else setSelected(new Set(filteredTasks.map((x) => x.idx)));
  };

  const toggleOne = (idx: number) => {
    const next = new Set(selected);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    setSelected(next);
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#eef0f2] flex flex-col font-sans animate-in fade-in zoom-in-95 duration-200 w-[70%] max-h-[90vh] rounded-[2rem] overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-16 bg-white px-6 flex flex-shrink-0 items-center justify-between border-b">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-bold text-gray-800">
              {type === "approved"
                ? "已通过的任务"
                : type === "rejected"
                  ? "已打回的任务"
                  : "未审核的任务"}{" "}
              ({filteredTasks.length})
            </h2>
          </div>
          <div className="flex items-center gap-3">
            {selected.size > 0 && (
              <>
                <span className="text-sm text-gray-500 font-bold">
                  已选 {selected.size} 项
                </span>
                <Button
                  size="sm"
                  onClick={() => {
                    onChangeStatus(Array.from(selected), "none");
                    setSelected(new Set());
                  }}
                  className="bg-gray-100 text-gray-800 hover:bg-gray-200 shadow-none font-bold rounded-xl h-9"
                >
                  移出当前标签
                </Button>
                {type === "approved" && (
                  <Button
                    size="sm"
                    onClick={() => {
                      onChangeStatus(Array.from(selected), "rejected");
                      setSelected(new Set());
                    }}
                    className="bg-red-500 text-white hover:bg-red-600 shadow-none font-bold rounded-xl h-9"
                  >
                    批量设为"不通过"
                  </Button>
                )}
                {type === "rejected" && (
                  <Button
                    size="sm"
                    onClick={() => {
                      onChangeStatus(Array.from(selected), "approved");
                      setSelected(new Set());
                    }}
                    className="bg-[#ccff00] text-black hover:bg-[#b8e600] shadow-none font-bold rounded-xl h-9"
                  >
                    批量设为"通过"
                  </Button>
                )}
                {type === "none" && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => {
                        onChangeStatus(Array.from(selected), "approved");
                        setSelected(new Set());
                      }}
                      className="bg-[#ccff00] text-black hover:bg-[#b8e600] shadow-none font-bold rounded-xl h-9"
                    >
                      批量设为"通过"
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        onChangeStatus(Array.from(selected), "rejected");
                        setSelected(new Set());
                      }}
                      className="bg-red-500 text-white hover:bg-red-600 shadow-none font-bold rounded-xl h-9"
                    >
                      批量设为"不通过"
                    </Button>
                  </>
                )}
              </>
            )}
            <div className="w-[1px] h-6 bg-gray-200 mx-2"></div>
            <Button
              variant="ghost"
              onClick={onClose}
              className="px-2 hover:bg-gray-100 rounded-xl bg-gray-50 text-gray-700"
            >
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6">
          {filteredTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
              <CheckSquare className="w-10 h-10 text-gray-300" />
              <p className="font-bold">该标签下暂无任务</p>
            </div>
          ) : (
            <>
              <div
                className="flex items-center mb-4 cursor-pointer w-max bg-white px-4 py-2 rounded-xl shadow-sm border border-gray-100 hover:bg-gray-50 transition-colors"
                onClick={toggleAll}
              >
                {isAllSelected ? (
                  <CheckSquare className="w-5 h-5 text-black mr-2" />
                ) : (
                  <Square className="w-5 h-5 text-gray-400 mr-2" />
                )}
                <span className="text-sm font-bold select-none text-gray-700">
                  全选
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-6 gap-4">
                {currentGrid.map(({ task, idx }) => {
                  const isSel = selected.has(idx);
                  return (
                    <div
                      key={task.id}
                      className={`bg-white rounded-[2rem] p-3 relative transition-all border-[3px] ${isSel ? "border-[#ccff00] shadow-md scale-[1.02]" : "border-transparent hover:border-gray-200"}`}
                    >
                      <div
                        className="absolute top-5 left-5 z-10 cursor-pointer bg-white/80 backdrop-blur rounded p-0.5"
                        onClick={() => toggleOne(idx)}
                      >
                        {isSel ? (
                          <CheckSquare className="w-5 h-5 text-black" />
                        ) : (
                          <Square className="w-5 h-5 text-gray-400" />
                        )}
                      </div>
                      <div
                        className="aspect-square bg-gray-100 rounded-3xl overflow-hidden cursor-pointer mb-3 relative group"
                        onClick={() => onReview(idx)}
                      >
                        {task.status === "success" && task.resultUrl ? (
                          <ResultImageRenderer
                            task={task}
                            className="w-full h-full object-cover"
                          />
                        ) : task.referenceImage ? (
                          task.referenceImage.startsWith("http") &&
                          !task.referenceImage.startsWith("blob:") ? (
                            <CachedThumbnail
                              url={task.referenceImage}
                              className="w-full h-full object-cover rounded-xl"
                            />
                          ) : (
                            <CachedThumbnail
                              url={task.referenceImage}
                              className="w-full h-full object-cover opacity-50 "
                              alt="Pending"
                            />
                          )
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-400 flex-col gap-1">
                            <ImageIcon className="w-6 h-6" />
                            <span className="text-xs font-bold">无图</span>
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/5 hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                          <span className="bg-black text-[#ccff00] text-xs px-3 py-1.5 rounded-full font-bold shadow-lg">
                            快速审阅
                          </span>
                        </div>
                      </div>
                      <div
                        className="text-xs text-gray-600 truncate px-2 font-bold"
                        title={task.prompt}
                      >
                        {task.prompt || "暂无提示词"}
                      </div>
                    </div>
                  );
                })}
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-4 mt-8 pb-4">
                  <Button
                    variant="outline"
                    disabled={pageIndex === 1}
                    onClick={() => setPageIndex((p) => Math.max(1, p - 1))}
                    className="rounded-full font-bold shadow-sm"
                  >
                    上一页
                  </Button>
                  <span className="text-sm font-bold text-gray-500">
                    {pageIndex} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    disabled={pageIndex === totalPages}
                    onClick={() =>
                      setPageIndex((p) => Math.min(totalPages, p + 1))
                    }
                    className="rounded-full font-bold shadow-sm"
                  >
                    下一页
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const GridGroupCard: React.FC<{
  groupItems: { t: GeneratedTask; idx: number }[];
  isProcessing: boolean;
  setCurrentReviewIndex: (i: number) => void;
  openRetweakModal: (i: number) => void;
}> = ({
  groupItems,
  isProcessing,
  setCurrentReviewIndex,
  openRetweakModal,
}) => {
  const [activeIdx, setActiveIdx] = useState(0);
  const { t: task, idx: originalIndex } =
    groupItems[activeIdx] || groupItems[0];
  const hasMultiple = groupItems.length > 1;

  return (
    <div
      className="bg-[#f7f8f9] rounded-2xl border-0 overflow-hidden flex flex-col cursor-pointer hover:bg-gray-100/80 transition-all hover:-translate-y-2 relative group"
      onClick={() => setCurrentReviewIndex(originalIndex)}
    >
      {/* Status overlay badges */}
      {hasMultiple && (
        <div className="absolute top-3 left-3 z-20 flex flex-col gap-1">
          <span className="bg-[#ccff00] text-black text-[10px] font-bold px-3 py-1.5 rounded-full shadow-sm border-none">
            共 {groupItems.length} 轮结果
          </span>
        </div>
      )}
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-1 items-end">
        {task.reviewStatus === "approved" && (
          <span className="bg-[#ccff00] text-gray-900 p-1.5 rounded-full shadow-sm">
            <Check className="w-3 h-3 stroke-[3]" />
          </span>
        )}
        {task.reviewStatus === "rejected" && (
          <span className="bg-gray-900 text-white p-1.5 rounded-full shadow-sm">
            <X className="w-3 h-3 stroke-[3]" />
          </span>
        )}

        {(task.status === "error" || task.status === "success") &&
          !isProcessing && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                openRetweakModal(originalIndex);
              }}
              className="bg-white/90 backdrop-blur text-gray-600 p-1.5 rounded-full shadow-sm hover:text-black opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Settings2 className="w-3 h-3 stroke-[2.5]" />
            </button>
          )}
      </div>

      {/* Main Image Area */}
      <div className="aspect-square bg-transparent relative flex items-center justify-center p-0">
        <div className="w-full h-full rounded-2xl overflow-hidden bg-white relative border-0">
          {task.status === "success" && task.resultUrl ? (
            <ResultImageRenderer
              task={task}
              className="w-full h-full object-cover"
            />
          ) : task.status === "running" ? (
            <div className="flex flex-col items-center justify-center absolute inset-0 bg-blue-50/80 backdrop-blur-sm text-blue-500 z-10 px-2">
              <Loader2 className="w-6 h-6 animate-spin mb-1" />
              <span className="text-xs font-bold text-center">
                {task.progressMsg || "执行中"}
              </span>
              {task.errorMsg && (
                <span className="text-[9px] text-blue-600 mt-1 max-w-[90%] text-center px-2">
                  {task.errorMsg}
                </span>
              )}
            </div>
          ) : task.status === "error" ? (
            <div className="flex flex-col items-center justify-center absolute inset-0 bg-red-50/80 backdrop-blur-sm text-red-500 z-10">
              <X className="w-6 h-6 mb-1" />
              <span className="text-xs font-bold">失败</span>
              {task.errorMsg && (
                <span
                  className="text-[9px] text-red-600 mt-1 max-w-[90%] p-1 line-clamp-2"
                  title={task.errorMsg}
                >
                  {task.errorMsg}
                </span>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center w-full h-full text-gray-400 absolute inset-0">
              {task.referenceImage ? (
                task.referenceImage.startsWith("http") &&
                !task.referenceImage.startsWith("blob:") ? (
                  <CachedThumbnail
                    url={task.referenceImage}
                    className="w-full h-full opacity-50 object-cover"
                  />
                ) : (
                  <CachedThumbnail
                    url={task.referenceImage}
                    className="w-full h-full object-cover opacity-30"
                    alt="Pending"
                  />
                )
              ) : (
                <span className="w-2 h-2 rounded-full bg-gray-200 mb-0.5"></span>
              )}
            </div>
          )}
          {hasMultiple && (
            <div className="absolute bottom-3 inset-x-0 flex justify-center z-20">
              <div
                className="bg-black/50 backdrop-blur-md px-2.5 py-1.5 rounded-full flex gap-1.5 items-center"
                onClick={(e) => e.stopPropagation()}
              >
                {groupItems.map((_, i) => (
                  <div
                    key={i}
                    onClick={() => setActiveIdx(i)}
                    className={`w-2 h-2 rounded-full cursor-pointer hover:scale-125 transition-transform ${i === activeIdx ? "bg-[#ccff00]" : "bg-white/50"}`}
                  ></div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer info */}
      <div className="px-4 py-4 pt-3 flex items-center justify-between gap-2 bg-transparent">
        <div
          className="text-[11px] font-bold text-gray-500 truncate flex-1"
          title={task.prompt}
        >
          {task.prompt || "暂无提示词"}
        </div>
        <div className="flex -space-x-1 shrink-0">
          {task.fixedImage && (
            <CachedThumbnail
              url={task.fixedImage}
              className="w-7 h-7 rounded-full border-2 border-white object-cover shadow-sm bg-gray-200"
              alt="1"
              title="图一"
            />
          )}
          {task.referenceImage && task.referenceImage !== task.fixedImage && (
            <div className="relative">
              <CachedThumbnail
                url={task.referenceImage}
                className="w-7 h-7 rounded-full border-2 border-white object-cover shadow-sm bg-gray-200 relative z-10"
                alt="2"
                title="图二"
              />
              {task.referenceImages && task.referenceImages.length > 1 && (
                <div className="absolute -top-1.5 -right-1.5 bg-gray-900 text-[#ccff00] text-[8px] font-black px-1.5 py-0.5 rounded-full border-2 border-white z-20">
                  {task.referenceImages.length}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default function Workbench() {
  const [accessKey, setAccessKey] = useState(
    () => localStorage.getItem("access_key") || "",
  );
  const [secretKey, setSecretKey] = useState(
    () => localStorage.getItem("secret_key") || "",
  );

  useEffect(() => {
    localStorage.setItem("access_key", accessKey);
  }, [accessKey]);

  useEffect(() => {
    localStorage.setItem("secret_key", secretKey);
  }, [secretKey]);

  const [auditApiKey, setAuditApiKey] = useState(
    () => localStorage.getItem("audit_api_key") || "",
  );
  const [auditBaseUrl, setAuditBaseUrl] = useState(
    () =>
      localStorage.getItem("audit_base_url") || "https://api.xiaomimimo.com/v1",
  );
  const [auditModel, setAuditModel] = useState(
    () => localStorage.getItem("audit_model") || "mimo-v2.5",
  );

  useEffect(() => {
    localStorage.setItem("audit_api_key", auditApiKey);
  }, [auditApiKey]);

  useEffect(() => {
    localStorage.setItem("audit_base_url", auditBaseUrl);
  }, [auditBaseUrl]);

  useEffect(() => {
    localStorage.setItem("audit_model", auditModel);
  }, [auditModel]);

  const [isAuditSettingsOpen, setIsAuditSettingsOpen] = useState(false);
  const [modelType, setModelType] = useState("Nano Banana Pro");
  const [resolution, setResolution] = useState("2K");
  const [ratio, setRatio] = useState("3:4");
  const [concurrency, setConcurrency] = useState(3);
  const [fastTrack, setFastTrack] = useState(false);
  const [useThinkingMode, setUseThinkingMode] = useState(true);
  const [useExecutionPrefix, setUseExecutionPrefix] = useState(true);
  const [bypassProxy, setBypassProxy] = useState(() => {
    return localStorage.getItem("bypass_proxy") !== "false";
  });
  const [roundCount, setRoundCount] = useState(1);
  const [globalCategory, setGlobalCategory] = useState<
    "shoes" | "apparel" | "accessories" | "sets"
  >("shoes");
  const [activeIssueIndex, setActiveIssueIndex] = useState<number | null>(null);
  const [isBatchAuditing, setIsBatchAuditing] = useState(false);
  const [autoAuditEnabled, setAutoAuditEnabled] = useState(false);
  const autoAuditEnabledRef = useRef(autoAuditEnabled);
  autoAuditEnabledRef.current = autoAuditEnabled;

  const [autoPsdDownloadEnabled, setAutoPsdDownloadEnabled] = useState(false);
  const autoPsdDownloadEnabledRef = useRef(autoPsdDownloadEnabled);
  autoPsdDownloadEnabledRef.current = autoPsdDownloadEnabled;

  const handleBatchAudit = async () => {
    setIsBatchAuditing(true);
    const unAuditedTasks = tasksRef.current
      .map((t, i) => ({ task: t, index: i }))
      .filter(
        ({ task }) =>
          task.status === "success" &&
          !["running", "success"].includes(task.auditStatus as any),
      );

    for (let i = 0; i < unAuditedTasks.length; i++) {
      const { task, index } = unAuditedTasks[i];
      const refImg =
        task.referenceImage ||
        (task.referenceImages && task.referenceImages[0]);
      if (refImg && task.resultUrl) {
        triggerAutoAudit(index, task.id, refImg, task.resultUrl);
        await new Promise((resolve) => setTimeout(resolve, 800)); // Rate limit
      }
    }
    setIsBatchAuditing(false);
  };

  // Custom Consistency Audit Threshold and One-Strike (一票否决) Rules States
  const [auditPassThreshold, setAuditPassThreshold] = useState(() => {
    const saved = localStorage.getItem("audit_pass_threshold");
    return saved ? parseInt(saved) : 85;
  });
  const [rejectOnText, setRejectOnText] = useState(() => {
    const saved = localStorage.getItem("audit_reject_on_text");
    return saved === "true"; // default to false
  });
  const [rejectOnStructure, setRejectOnStructure] = useState(() => {
    const saved = localStorage.getItem("audit_reject_on_structure");
    return saved === "true"; // default to false
  });
  const [rejectOnPattern, setRejectOnPattern] = useState(() => {
    const saved = localStorage.getItem("audit_reject_on_pattern");
    return saved === "true"; // default to false
  });

  useEffect(() => {
    localStorage.setItem("bypass_proxy", String(bypassProxy));
  }, [bypassProxy]);

  useEffect(() => {
    localStorage.setItem("audit_pass_threshold", String(auditPassThreshold));
  }, [auditPassThreshold]);

  useEffect(() => {
    localStorage.setItem("audit_reject_on_text", String(rejectOnText));
  }, [rejectOnText]);

  useEffect(() => {
    localStorage.setItem(
      "audit_reject_on_structure",
      String(rejectOnStructure),
    );
  }, [rejectOnStructure]);

  useEffect(() => {
    localStorage.setItem("audit_reject_on_pattern", String(rejectOnPattern));
  }, [rejectOnPattern]);

  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 50;

  const [tableFile, setTableFile] = useState<File | null>(null);
  const [tableData, setTableData] = useState<any[]>([]);

  const [globalProjectId, setGlobalProjectId] = useState<string>("");

  // Folder Mode State with Reference Collection support
  const [refCollectionFiles, setRefCollectionFiles] = useState<File[]>([]);
  const [refCollectionPreviews, setRefCollectionPreviews] = useState<string[]>(
    [],
  );
  const [isRefCollectionModalOpen, setIsRefCollectionModalOpen] =
    useState(false);
  const fixedImageFile = refCollectionFiles[0] || null;
  const fixedImagePreview = refCollectionPreviews[0] || null;

  const [fixedPrompt, setFixedPrompt] = useState(
    "参考图一 ，鞋子替换为图二的单只鞋子；图一的背景色相替换为图二鞋子的一个相近色的浅色版本；保持图一的鞋子角度、投影位置不变。--neg 产品环境光,多重投影，深色投影；",
  );
  const [folderFiles, setFolderFiles] = useState<File[]>([]);

  // Tasks
  const [tasks, setTasks] = useState<GeneratedTask[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const [isDownloadingFailedZip, setIsDownloadingFailedZip] = useState(false);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const abortRef = useRef(false);
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;

  // Single Task Retweak Modal State
  const [retweakModalConfig, setRetweakModalConfig] = useState<{
    isOpen: boolean;
    taskIndex: number;
    availableImages: string[];
    selectedIndices: number[]; // Ordered indices of selected images
    prompt: string;
  } | null>(null);

  // Review states
  const [fullscreenImage, setFullscreenImage] = useState<{
    url: string;
    isTemp: boolean;
  } | null>(null);

  const openFullscreen = (url: string, file?: File) => {
    if (file) {
      const tempUrl = URL.createObjectURL(file);
      setFullscreenImage({ url: tempUrl, isTemp: true });
    } else {
      setFullscreenImage({ url, isTemp: false });
    }
  };

  const closeFullscreen = () => {
    setFullscreenImage((prev) => {
      if (prev?.isTemp) {
        URL.revokeObjectURL(prev.url);
      }
      return null;
    });
  };
  const [currentReviewIndex, setCurrentReviewIndex] = useState<number | null>(
    null,
  );
  const [activeRefImageIndex, setActiveRefImageIndex] = useState(0);
  const [taskCategory, setTaskCategory] = useState<
    "shoes" | "apparel" | "accessories" | "sets"
  >("shoes");
  const [zoomState, setZoomState] = useState({ scale: 1, x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  useEffect(() => {
    setTaskCategory(globalCategory);
  }, [globalCategory]);

  useEffect(() => {
    setZoomState({ scale: 1, x: 0, y: 0 });
    setIsDragging(false);
    setDragStart({ x: 0, y: 0 });
    setActiveRefImageIndex(0);
  }, [currentReviewIndex]);
  const [tagPanelType, setTagPanelType] = useState<
    "approved" | "rejected" | "none" | null
  >(null);

  const startExecutionRef = useRef<() => void>();

  // Persistence helpers
  const saveTasksToServer = (newTasks: GeneratedTask[]) => {
    saveTasksToServerState(newTasks);
  };

  // Restoring tasks on mount
  useEffect(() => {
    loadTasksFromServerState()
      .then((data) => {
        if (data.success && data.tasks && data.tasks.length > 0) {
          setTasks(data.tasks);
          tasksRef.current = data.tasks;

          // Auto resume polling for any task that was auditing
          data.tasks.forEach((task: GeneratedTask, idx: number) => {
            if (
              task.status === "success" &&
              task.auditStatus === "running" &&
              task.resultUrl
            ) {
              pollAuditStatus(idx, task.id);
            }
          });
        }
      })
      .catch((err) => console.error("Error restoring tasks:", err));
  }, []);

  // Debounced auto-save tasks
  useEffect(() => {
    if (tasks.length === 0) return;
    const timer = setTimeout(() => {
      saveTasksToServer(tasks);
    }, 1000);
    return () => clearTimeout(timer);
  }, [tasks]);

  // Dynamic audit polling
  const pollAuditStatus = (index: number, taskId: string) => {
    let attempts = 0;
    const maxAttempts = 60; // 60 * 3s = 180s (Mimo is slow so we allow 3 minutes max)
    const interval = 3000;

    const runPoll = async () => {
      try {
        const data = await fetchAuditStatus(taskId);

        if (data.status === "success") {
          const auditResult = data.result;
          const autoReviewStatus = auditResult.pass ? "approved" : "rejected";

          const currentTask = tasksRef.current[index];
          if (!currentTask) return;

          const ut: GeneratedTask = {
            ...currentTask,
            auditStatus: "success" as const,
            auditResult,
            reviewStatus: autoReviewStatus as any,
          };

          setTasks((prev) => {
            const next = [...prev];
            if (next[index]) {
              next[index] = { ...next[index], ...ut };
            }
            tasksRef.current = next;
            return next;
          });

          if (ut.resultUrl) {
            const filenameStr = ut.originalFilename
              ? String(ut.originalFilename)
              : "";
            const baseName = filenameStr
              ? filenameStr.replace(/\.[^/.]+$/, "")
              : `result_${ut.id}`;
            const extMatch = filenameStr
              ? filenameStr.match(/\.([^/.]+)$/)
              : null;
            const ext = extMatch ? extMatch[1] : "png";

            if (autoPsdDownloadEnabledRef.current) {
              exportTaskToPsdHelper(ut, auditResult.issues || [], true);
            }
            if (auditResult.pass) {
              const downloadFilename = `${baseName}.${ext}`;
              autoDownloadImage(ut.resultUrl, downloadFilename);
            } else {
              const downloadFilename = `${baseName}_不合格.${ext}`;
              autoDownloadImage(ut.resultUrl, downloadFilename);
            }
          }
          return;
        } else if (data.status === "error") {
          setTasks((prev) => {
            const next = prev.map((t, idx) =>
              idx === index
                ? {
                    ...t,
                    auditStatus: "error" as const,
                    auditError: data.error || "Audit failed on server",
                  }
                : t,
            );
            tasksRef.current = next;
            return next;
          });
          return;
        } else if (data.status === "none") {
          setTasks((prev) => {
            const next = prev.map((t, idx) =>
              idx === index
                ? {
                    ...t,
                    auditStatus: "error" as const,
                    auditError:
                      "Audit task not found on server (may have been lost during redeploy or cold start)",
                  }
                : t,
            );
            tasksRef.current = next;
            return next;
          });
          return;
        }

        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(runPoll, interval);
        } else {
          setTasks((prev) => {
            const next = prev.map((t, idx) =>
              idx === index
                ? {
                    ...t,
                    auditStatus: "error" as const,
                    auditError: "Audit timeout",
                  }
                : t,
            );
            tasksRef.current = next;
            return next;
          });
        }
      } catch (err: any) {
        console.error(`Error polling audit for ${taskId}:`, err);
        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(runPoll, interval);
        }
      }
    };

    setTimeout(runPoll, interval);
  };

  // Triggers the auto consistency audit API on the backend
  const triggerAutoAudit = async (
    index: number,
    taskId: string,
    referenceImage: string | undefined,
    resultUrl: string,
    customCategory?: "shoes" | "apparel" | "accessories" | "sets",
    retryCount: number = 0,
  ) => {
    if (!referenceImage || !resultUrl) return;

    let task = tasksRef.current[index];
    if (
      retryCount === 0 &&
      (task?.auditStatus === "running" || task?.auditStatus === "success")
    ) {
      console.log(
        `Task ${taskId} is already auditing or succeeded, skip duplicate trigger.`,
      );
      return;
    }

    // Synchronously update to prevent race conditions if multiple triggers happen in the same tick
    tasksRef.current = tasksRef.current.map((t, idx) =>
      idx === index
        ? { ...t, auditStatus: "running" as const, auditError: undefined }
        : t,
    );
    setTasks(tasksRef.current);

    const targetCategory = customCategory || globalCategory;
    const referenceImages =
      task?.referenceImages && task.referenceImages.length > 0
        ? task.referenceImages
        : [referenceImage];

    try {
      // Import dynamically or ensure it's imported at the top
      const { runAuditOnClient } = await import("@/src/lib/audit");

      // Stitch images together with max width 1080 to save tokens and avoid payload limit
      let stitchedReference = await stitchImagesVertically(
        referenceImages,
        1080,
      );

      let finalRefUrl = stitchedReference;
      if (stitchedReference.startsWith("data:") && accessKey && secretKey) {
        try {
          const arr = stitchedReference.split(",");
          const bstr = atob(arr[1]);
          const u8arr = new Uint8Array(bstr.length);
          for (let i = 0; i < bstr.length; i++) {
            u8arr[i] = bstr.charCodeAt(i);
          }
          const blob = new Blob([u8arr], { type: "image/jpeg" });

          const upData = await uploadFileToLovart(
            blob,
            "stitched_ref.jpg",
            accessKey,
            secretKey,
          );
          if (upData.code === 0 && upData.data?.url) {
            finalRefUrl = upData.data.url;
          }
        } catch (e) {
          console.warn(
            "Failed to upload stitched image, falling back to data URL",
            e,
          );
        }
      }

      const auditResult = await runAuditOnClient(
        taskId,
        finalRefUrl,
        resultUrl,
        targetCategory,
        auditApiKey,
        auditBaseUrl,
        auditModel,
        {
          passThreshold: auditPassThreshold,
          rejectOnText,
          rejectOnStructure,
          rejectOnPattern,
        },
      );

      const autoReviewStatus = auditResult.pass ? "approved" : "rejected";
      const currentTask = tasksRef.current[index];
      if (!currentTask) return;

      const ut: GeneratedTask = {
        ...currentTask,
        auditStatus: "success" as const,
        auditResult,
        reviewStatus: autoReviewStatus as any,
      };

      setTasks((prev) => {
        const next = [...prev];
        if (next[index]) {
          next[index] = { ...next[index], ...ut };
        }
        tasksRef.current = next;
        return next;
      });

      if (ut.resultUrl) {
        const filenameStr = ut.originalFilename
          ? String(ut.originalFilename)
          : "";
        const baseName = filenameStr
          ? filenameStr.replace(/\.[^/.]+$/, "")
          : `result_${ut.id}`;
        const extMatch = filenameStr ? filenameStr.match(/\.([^/.]+)$/) : null;
        const ext = extMatch ? extMatch[1] : "png";

        if (autoPsdDownloadEnabledRef.current) {
          exportTaskToPsdHelper(ut, auditResult.issues || [], true);
        }
        if (auditResult.pass) {
          const downloadFilename = `${baseName}.${ext}`;
          autoDownloadImage(ut.resultUrl, downloadFilename);
        } else {
          const downloadFilename = `${baseName}_不合格.${ext}`;
          autoDownloadImage(ut.resultUrl, downloadFilename);
        }
      }
    } catch (err: any) {
      if (retryCount < 3) {
        console.warn(
          `Audit failed for task ${taskId}, retrying (${retryCount + 1}/3)...`,
          err,
        );
        setTimeout(() => {
          triggerAutoAudit(
            index,
            taskId,
            referenceImage,
            resultUrl,
            customCategory,
            retryCount + 1,
          );
        }, 2000);
        return;
      }
      let errText = err.message || "Failed to initiate audit";
      setTasks((prev) => {
        const next = prev.map((t, idx) =>
          idx === index
            ? { ...t, auditStatus: "error" as const, auditError: errText }
            : t,
        );
        tasksRef.current = next;
        return next;
      });
    }
  };

  const [dialogConfig, setDialogConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string | string[];
    type: "alert" | "confirm";
    onConfirm?: () => void;
    onCancel?: () => void;
  }>({ isOpen: false, title: "", message: "", type: "alert" });

  const customAlert = (message: string, title: string = "提示") => {
    setDialogConfig({
      isOpen: true,
      title,
      message: message.split("\n"),
      type: "alert",
      onCancel: () => setDialogConfig((prev) => ({ ...prev, isOpen: false })),
    });
  };

  const customConfirm = (
    message: string,
    onConfirm: () => void,
    title: string = "确认",
  ) => {
    setDialogConfig({
      isOpen: true,
      title,
      message: message.split("\n"),
      type: "confirm",
      onConfirm: () => {
        setDialogConfig((prev) => ({ ...prev, isOpen: false }));
        // Ensure onConfirm executes after dialog closes to prevent any focus issues
        setTimeout(onConfirm, 50);
      },
      onCancel: () => setDialogConfig((prev) => ({ ...prev, isOpen: false })),
    });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (currentReviewIndex !== null && fullscreenImage === null) {
        if (e.key === "ArrowDown" && currentReviewIndex < tasks.length - 1) {
          setCurrentReviewIndex(currentReviewIndex + 1);
        } else if (e.key === "ArrowUp" && currentReviewIndex > 0) {
          setCurrentReviewIndex(currentReviewIndex - 1);
        } else if (e.key === "ArrowLeft") {
          const task = tasks[currentReviewIndex];
          if (!task) return;
          const isRejecting = task.reviewStatus !== "rejected";
          setTasks((prev) => {
            const next = [...prev];
            next[currentReviewIndex] = {
              ...task,
              reviewStatus: isRejecting ? "rejected" : "none",
            };
            return next;
          });
          if (isRejecting && currentReviewIndex < tasks.length - 1) {
            setCurrentReviewIndex(currentReviewIndex + 1);
          }
        } else if (e.key === "ArrowRight") {
          const task = tasks[currentReviewIndex];
          if (!task) return;
          const isApproving = task.reviewStatus !== "approved";
          setTasks((prev) => {
            const next = [...prev];
            next[currentReviewIndex] = {
              ...task,
              reviewStatus: isApproving ? "approved" : "none",
            };
            return next;
          });
          if (isApproving && currentReviewIndex < tasks.length - 1) {
            setCurrentReviewIndex(currentReviewIndex + 1);
          }
        }
      } else if (fullscreenImage !== null) {
        if (e.key === "Escape") closeFullscreen();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentReviewIndex, tasks, fullscreenImage]);

  const handleStop = () => {
    abortRef.current = true;
    setIsProcessing(false);
  };

  const findMatchingReferenceFile = (
    row: any,
    refFiles: File[],
  ): { file: File } | null => {
    if (!refFiles || refFiles.length === 0) return null;

    // 1. Try to match from row.refImageName or row.imageUrl
    const targetCellVal = (row.refImageName || row.imageUrl || "").trim();
    if (targetCellVal) {
      const baseTargetVal =
        targetCellVal
          .split("/")
          .pop()
          ?.replace(/\.[^/.]+$/, "")
          .trim()
          .toLowerCase() || "";
      if (baseTargetVal) {
        // First try: exact match on filename (without extension)
        for (const file of refFiles) {
          const baseFileName = file.name
            .replace(/\.[^/.]+$/, "")
            .trim()
            .toLowerCase();
          if (
            baseFileName === baseTargetVal ||
            file.name.toLowerCase() === targetCellVal.toLowerCase()
          ) {
            return { file };
          }
        }
        // Second try: partial contains match
        for (const file of refFiles) {
          const baseFileName = file.name
            .replace(/\.[^/.]+$/, "")
            .trim()
            .toLowerCase();
          if (
            baseTargetVal.includes(baseFileName) ||
            baseFileName.includes(baseTargetVal)
          ) {
            return { file };
          }
        }
      }
    }

    // 2. Try to match based on row.name
    if (row.name) {
      const baseTargetVal = String(row.name).trim().toLowerCase();
      for (const file of refFiles) {
        const baseFileName = file.name
          .replace(/\.[^/.]+$/, "")
          .trim()
          .toLowerCase();
        if (
          baseFileName === baseTargetVal ||
          baseFileName.includes(baseTargetVal) ||
          baseTargetVal.includes(baseFileName)
        ) {
          return { file };
        }
      }
    }

    // 3. Fallback: Intelligent prompt-based matching (e.g. if prompt contains "参考图一" and file name has "图一")
    if (row.prompt) {
      const promptStr = String(row.prompt).toLowerCase();
      const sortedRefFiles = [...refFiles].sort(
        (a, b) => b.name.length - a.name.length,
      );
      for (const file of sortedRefFiles) {
        const baseFileName = file.name
          .replace(/\.[^/.]+$/, "")
          .trim()
          .toLowerCase();
        if (baseFileName.length >= 2) {
          if (promptStr.includes(baseFileName)) {
            return { file };
          }
        }
      }
    }

    return null;
  };

  const rebuildTasks = async (
    table: any[],
    folders: File[],
    currentRefCollection: File[],
    currFixedPrompt: string,
    overrideRoundCount?: number,
  ) => {
    const targetRoundCount = overrideRoundCount ?? roundCount;
    let fixedImageBase64 = "";
    const currentFixedImage = currentRefCollection[0] || null;

    if (currentFixedImage && currentRefCollection.length === 1) {
      // Use createThumbnailBase64 to generate a lightweight 300px compressed thumbnail to keep payload tiny
      fixedImageBase64 = await createThumbnailBase64(currentFixedImage, 300);
      try {
        const { saveImageToCache } = await import("@/src/lib/imageCache");
        await saveImageToCache("fixed_image_original", currentFixedImage);
      } catch (err) {
        console.error("Failed to cache original fixed image:", err);
      }
    }

    // Group folder files
    const rootFiles: File[] = [];
    const subFolderMap: Record<string, File[]> = {};
    for (const file of folders) {
      if (!file.type.startsWith("image/")) continue;
      const pathParts = file.webkitRelativePath
        ? file.webkitRelativePath.split("/")
        : [];
      if (pathParts.length === 2) {
        rootFiles.push(file);
      } else if (pathParts.length > 2) {
        const subfolderName = pathParts[1];
        if (!subFolderMap[subfolderName]) {
          subFolderMap[subfolderName] = [];
        }
        subFolderMap[subfolderName].push(file);
      } else {
        rootFiles.push(file);
      }
    }
    const folderGroups = [
      ...rootFiles.map((file) => ({
        files: [file],
        name: file.name.replace(/\.[^/.]+$/, ""),
        relativePath: file.webkitRelativePath || file.name,
      })),
      ...Object.entries(subFolderMap).map(([name, files]) => ({
        files,
        name,
        relativePath: files[0]?.webkitRelativePath
          ? files[0].webkitRelativePath.replace(/\/[^/]+$/, "")
          : name,
      })),
    ];

    const objectUrlCache: Record<string, string[]> = {};
    for (const t of tasksRef.current) {
      if (t.referenceFiles && t.referenceImages && t.originalFilename) {
        const key =
          String(t.originalFilename).trim() + "_" + (t.relativePath || "");
        if (
          !objectUrlCache[key] ||
          objectUrlCache[key].length !== t.referenceFiles.length
        ) {
          objectUrlCache[key] = t.referenceImages;
        }
      }
    }

    const availableExistingTasks = [...tasksRef.current];
    const mergeTask = (taskProps: Partial<GeneratedTask>): GeneratedTask => {
      const existingIndex = availableExistingTasks.findIndex(
        (t) =>
          String(t.originalFilename).trim() ===
            String(taskProps.originalFilename).trim() &&
          t.relativePath === taskProps.relativePath &&
          t.roundIndex === taskProps.roundIndex &&
          String(t.prompt).trim() === String(taskProps.prompt).trim(),
      );
      let existing = null;
      if (existingIndex !== -1) {
        existing = availableExistingTasks[existingIndex];
        availableExistingTasks.splice(existingIndex, 1);
      } else {
        const fallbackIndex = availableExistingTasks.findIndex(
          (t) =>
            String(t.originalFilename).trim() ===
              String(taskProps.originalFilename).trim() &&
            t.relativePath === taskProps.relativePath &&
            t.roundIndex === taskProps.roundIndex,
        );
        if (fallbackIndex !== -1) {
          existing = availableExistingTasks[fallbackIndex];
          availableExistingTasks.splice(fallbackIndex, 1);
        }
      }

      if (existing) {
        let finalRefImage = taskProps.referenceImage;
        let finalRefImages = taskProps.referenceImages;
        // Avoid creating new object urls if we already have them for the same files length
        if (
          existing.referenceFiles &&
          taskProps.referenceFiles &&
          existing.referenceFiles.length === taskProps.referenceFiles.length
        ) {
          finalRefImage = existing.referenceImage;
          finalRefImages = existing.referenceImages;
        } else if (!taskProps.referenceFiles && !existing.referenceFiles) {
          finalRefImage = taskProps.referenceImage || existing.referenceImage;
        }

        return {
          ...taskProps,
          id: existing.id,
          status: existing.status,
          resultUrl: existing.resultUrl,
          errorMsg: existing.errorMsg,
          retryCount: existing.retryCount,
          reviewStatus: existing.reviewStatus,
          progressMsg: existing.progressMsg,
          referenceImage: finalRefImage,
          referenceImages: finalRefImages,
        } as GeneratedTask;
      }
      return {
        ...taskProps,
        id: taskProps.id || `task-${Date.now()}-${Math.random()}`,
      } as GeneratedTask;
    };

    const generateRounds = (baseTaskProps: any, idx: number) => {
      const results: GeneratedTask[] = [];
      const groupId = baseTaskProps.id;
      for (let r = 0; r < targetRoundCount; r++) {
        const id = `${baseTaskProps.id}-r${r}`;
        results.push(
          mergeTask({ ...baseTaskProps, id, roundIndex: r, groupId }),
        );
      }
      return results;
    };

    let newTasks: GeneratedTask[] = [];

    // Helper to cache a matched reference file and get its info
    const getMatchedReferenceInfo = async (row: any) => {
      if (currentRefCollection.length === 0) return null;
      const matched = findMatchingReferenceFile(row, currentRefCollection);
      if (matched) {
        const file = matched.file;
        const refKey = `ref_collection_${file.name}_${Date.now()}`;
        try {
          const { saveImageToCache } = await import("@/src/lib/imageCache");
          await saveImageToCache(refKey, file);
        } catch (e) {}
        (file as any)._cacheKey = refKey;

        const b64 = await createThumbnailBase64(file, 300);
        return { b64, file };
      }
      return null;
    };

    if (table.length > 0) {
      // Table exists
      const hasTableImageUrl = table.some((r) => r.imageUrl);
      if (hasTableImageUrl && folders.length > 0) {
        customAlert("请清空表格图片url/清空上传文件夹");
        setTasks([]);
        return;
      }

      // Perform verification on missing reference files before starting tasks to guide user
      if (currentRefCollection.length > 1) {
        const unmatchedList = table.filter(
          (r) =>
            r.refImageName &&
            !findMatchingReferenceFile(r, currentRefCollection),
        );
        if (unmatchedList.length > 0) {
          const sampleNames = unmatchedList
            .slice(0, 5)
            .map((r) => r.refImageName || r.name)
            .join(", ");
          customAlert(
            `表格参考图匹配提示：有 ${unmatchedList.length} 个项目在参考图集文件夹里未找到匹配的图片（示例: ${sampleNames}），系统将在生成任务时显示默认或留白，请确认文件名一致。`,
          );
        }
      }

      if (folders.length > 0) {
        // We have both Table and Folder
        // Check if names match exactly
        const tableNames = table.map((r) => String(r.name).trim());
        const folderNames = new Set(folderGroups.map((g) => g.name.trim()));

        const missingInFolder = tableNames.filter((n) => !folderNames.has(n));
        const extraInFolder = Array.from(folderNames).filter(
          (n) => !tableNames.includes(n),
        );

        if (missingInFolder.length > 0 || extraInFolder.length > 0) {
          let msg = "任务运行前核对发现，表格与文件夹名称不一致：\n";
          if (missingInFolder.length > 0)
            msg += `表格内存在，但文件夹未找到: ${missingInFolder.join(", ")}\n`;
          if (extraInFolder.length > 0)
            msg += `文件夹存在，但表格未找到: ${extraInFolder.join(", ")}\n`;
          customAlert(msg);
          setTasks([]);
          return;
        }

        // Pre-calculate thumbnails asynchronously
        for (const row of table) {
          const folderGroup = folderGroups.find(
            (g) => g.name.trim() === String(row.name).trim(),
          );
          if (folderGroup) {
            const sortedFiles = [...folderGroup.files].sort((a, b) =>
              a.name.localeCompare(b.name),
            );
            const cacheKey =
              String(row.name).trim() + "_" + (folderGroup.relativePath || "");
            if (
              !objectUrlCache[cacheKey] ||
              objectUrlCache[cacheKey].length !== sortedFiles.length
            ) {
              objectUrlCache[cacheKey] = await Promise.all(
                sortedFiles.map(async (f, fIdx) => {
                  const refKey = `ref_${cacheKey}_${fIdx}_${Date.now()}`;
                  try {
                    const { saveImageToCache } =
                      await import("@/src/lib/imageCache");
                    await saveImageToCache(refKey, f);
                  } catch (e) {}
                  (f as any)._cacheKey = refKey;
                  return createThumbnailBase64(f, 300);
                }),
              );
            }
          }
        }

        // Generate tasks by matching Table Row -> Folder Group (incorporating matched reference collection)
        const tempTasks: GeneratedTask[] = [];
        for (let idx = 0; idx < table.length; idx++) {
          const row = table[idx];
          const folderGroup = folderGroups.find(
            (g) => g.name.trim() === String(row.name).trim(),
          );
          // Folder files sorted by name ascending
          const sortedFiles = folderGroup
            ? [...folderGroup.files].sort((a, b) =>
                a.name.localeCompare(b.name),
              )
            : [];

          // Use cache to avoid Blob memory leak and URL regeneration
          const cacheKey =
            String(row.name).trim() + "_" + (folderGroup?.relativePath || "");
          let refImagesUrls = objectUrlCache[cacheKey] || [];

          // Try to match reference collections first
          const matchedInfo = await getMatchedReferenceInfo(row);

          const finalPrompt = currFixedPrompt
            ? row.prompt
              ? `${currFixedPrompt} ${row.prompt}`
              : currFixedPrompt
            : row.prompt || "";

          const taskProps = {
            id: `merged-${Date.now()}-${idx}`,
            originalPrompt: row.prompt || "",
            tableImageUrl: row.imageUrl || "",
            originalRow: row.rawRow || row,
            prompt: finalPrompt,
            referenceImage:
              refImagesUrls[0] || (matchedInfo ? matchedInfo.b64 : ""),
            referenceImages:
              refImagesUrls.length > 0
                ? refImagesUrls
                : matchedInfo
                  ? [matchedInfo.b64]
                  : [],
            referenceFiles:
              sortedFiles.length > 0
                ? sortedFiles
                : matchedInfo
                  ? [matchedInfo.file]
                  : [],
            referenceFileKeys:
              sortedFiles.length > 0
                ? sortedFiles.map((f: any) => f._cacheKey).filter(Boolean)
                : matchedInfo
                  ? [(matchedInfo.file as any)._cacheKey]
                  : [],
            fixedImage: matchedInfo?.b64 || fixedImageBase64,
            fixedImageKey: matchedInfo ? (matchedInfo.file as any)._cacheKey : "fixed_image_original",
            status: "pending" as const,
            originalFilename: row.name,
            relativePath: folderGroup?.relativePath,
            reviewStatus: "none" as const,
          };
          tempTasks.push(...generateRounds(taskProps, idx));
        }
        newTasks = tempTasks;
      } else {
        // Only Table (incorporating matched reference collection)
        const tempTasks: GeneratedTask[] = [];
        for (let idx = 0; idx < table.length; idx++) {
          const row = table[idx];
          const matchedInfo = await getMatchedReferenceInfo(row);

          const finalPrompt = currFixedPrompt
            ? row.prompt
              ? `${currFixedPrompt} ${row.prompt}`
              : currFixedPrompt
            : row.prompt || "";
          const taskProps = {
            id: `table-${Date.now()}-${idx}`,
            originalPrompt: row.prompt || "",
            tableImageUrl: row.imageUrl || "",
            originalRow: row.rawRow || row,
            prompt: finalPrompt,
            referenceImage:
              row.imageUrl || (matchedInfo ? matchedInfo.b64 : ""),
            referenceImages: row.imageUrl
              ? [row.imageUrl]
              : matchedInfo
                ? [matchedInfo.b64]
                : [],
            referenceFiles: matchedInfo ? [matchedInfo.file] : undefined,
            referenceFileKeys: matchedInfo
              ? [(matchedInfo.file as any)._cacheKey]
              : undefined,
            fixedImage: matchedInfo?.b64 || fixedImageBase64,
            fixedImageKey: matchedInfo ? (matchedInfo.file as any)._cacheKey : "fixed_image_original",
            status: "pending" as const,
            originalFilename: row.name || `table-result-${idx}.png`,
            reviewStatus: "none" as const,
          };
          tempTasks.push(...generateRounds(taskProps, idx));
        }
        newTasks = tempTasks;
      }
    } else if (folders.length > 0) {
      // Only Folder + fixedPrompt
      folderGroups.sort((a, b) => a.name.localeCompare(b.name));

      // Pre-calculate thumbnails asynchronously
      for (const group of folderGroups) {
        const sortedFiles = [...group.files].sort((a, b) =>
          a.name.localeCompare(b.name),
        );
        const cacheKey =
          String(group.name).trim() + "_" + (group.relativePath || "");
        if (
          !objectUrlCache[cacheKey] ||
          objectUrlCache[cacheKey].length !== sortedFiles.length
        ) {
          objectUrlCache[cacheKey] = await Promise.all(
            sortedFiles.map(async (f, fIdx) => {
              const refKey = `ref_${cacheKey}_${fIdx}_${Date.now()}`;
              try {
                const { saveImageToCache } =
                  await import("@/src/lib/imageCache");
                await saveImageToCache(refKey, f);
              } catch (e) {}
              // attach the refKey to the file object as a dirty hack, or we can use a separate map.
              (f as any)._cacheKey = refKey;
              return createThumbnailBase64(f, 300);
            }),
          );
        }
      }

      newTasks = folderGroups.flatMap((group, idx) => {
        const sortedFiles = [...group.files].sort((a, b) =>
          a.name.localeCompare(b.name),
        );

        const cacheKey =
          String(group.name).trim() + "_" + (group.relativePath || "");
        let refImagesUrls = objectUrlCache[cacheKey] || [];

        const taskProps = {
          id: `folder-${Date.now()}-${idx}`,
          prompt: currFixedPrompt,
          referenceImage: refImagesUrls[0],
          referenceImages: refImagesUrls,
          referenceFiles: sortedFiles,
          referenceFileKeys: sortedFiles
            .map((f: any) => f._cacheKey)
            .filter(Boolean),
          fixedImage: fixedImageBase64,
          fixedImageKey: "fixed_image_original",
          status: "pending" as const,
          originalFilename: group.name,
          relativePath: group.relativePath,
          reviewStatus: "none" as const,
        };
        return generateRounds(taskProps, idx);
      });
    }

    setTasks(newTasks);
    tasksRef.current = newTasks;
  };

  const handleRefCollectionFilesChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    if (e.target.files) {
      const filesArr = Array.from(e.target.files) as File[];
      const imageFiles = filesArr.filter((f) => f.type.startsWith("image/"));
      if (imageFiles.length === 0) return;

      const newFiles = [...imageFiles];
      const newPreviews = newFiles
        .slice(0, 5)
        .map((f) => URL.createObjectURL(f));

      setRefCollectionFiles(newFiles);
      setRefCollectionPreviews(newPreviews);

      rebuildTasks(tableData, folderFiles, newFiles, fixedPrompt);
    }
  };

  const handleRefCollectionFolderChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    if (e.target.files) {
      const filesArr = Array.from(e.target.files) as File[];
      const imageFiles = filesArr.filter((f) => f.type.startsWith("image/"));
      if (imageFiles.length === 0) return;

      const newFiles = [...imageFiles];
      const newPreviews = newFiles
        .slice(0, 5)
        .map((f) => URL.createObjectURL(f));

      setRefCollectionFiles(newFiles);
      setRefCollectionPreviews(newPreviews);

      rebuildTasks(tableData, folderFiles, newFiles, fixedPrompt);
    }
  };

  const handleClearRefCollection = (e: React.MouseEvent) => {
    e.stopPropagation();
    refCollectionPreviews.forEach((p) => URL.revokeObjectURL(p));
    setRefCollectionFiles([]);
    setRefCollectionPreviews([]);
    rebuildTasks(tableData, folderFiles, [], fixedPrompt);
  };

  const handleTableUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setTableFile(file);

    try {
      const data = await file.arrayBuffer();
      const workbook = xlsx.read(data);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const json = xlsx.utils.sheet_to_json<any>(worksheet);

      const newTableData = json
        .map((row) => {
          const rawName =
            row["名称"] ?? row["任务名称"] ?? row.Name ?? row.name;
          const rawPrompt =
            row["提示词"] ?? row["任务提示词"] ?? row.Prompt ?? row.prompt;
          const rawRefName =
            row["参考图"] ??
            row["参考"] ??
            row["背景"] ??
            row["背景图"] ??
            row["模板"] ??
            row["模板图"] ??
            row["参考图集"] ??
            row["参考图项"] ??
            row["参考图片"] ??
            row["图片"] ??
            row["图"] ??
            row["图片URL"] ??
            row.imageUrl ??
            row.referenceImage;
          return {
            name:
              rawName !== undefined && rawName !== null
                ? String(rawName).trim()
                : "",
            prompt:
              rawPrompt !== undefined && rawPrompt !== null
                ? String(rawPrompt).trim()
                : "",
            imageUrl: convertGoogleDriveUrl(
              row["图片URL"] || row.imageUrl || row.Image || "",
            ).trim(),
            refImageName:
              rawRefName !== undefined && rawRefName !== null
                ? String(rawRefName).trim()
                : "",
            rawRow: row,
          };
        })
        .filter((r) => r.name || r.prompt || r.imageUrl || r.refImageName);

      setTableData(newTableData);
      rebuildTasks(newTableData, folderFiles, refCollectionFiles, fixedPrompt);
    } catch (err) {
      console.error("Error parsing table", err);
      customAlert("解析表格失败，请确保包含 名称 / 提示词 / 图片URL 列。");
    }
  };

  const handleFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const filesArr = Array.from(e.target.files) as File[];
      const files = filesArr.filter((f) => f.type.startsWith("image/"));
      setFolderFiles(files);
      rebuildTasks(tableData, files, refCollectionFiles, fixedPrompt);
    }
  };

  const handleFixedPromptChange = (val: string) => {
    setFixedPrompt(val);
    setTasks((prev) => {
      const nextTasks = prev.map((t) => {
        let rowPrompt = "";
        if (tableData.length > 0) {
          const row = tableData.find(
            (r) =>
              String(r.name).trim() === String(t.originalFilename).trim() ||
              (r.name === undefined && r.imageUrl === t.referenceImage),
          );
          if (row) {
            rowPrompt = row.prompt || "";
          }
        }
        const finalPrompt = val
          ? rowPrompt
            ? `${val} ${rowPrompt}`
            : val
          : rowPrompt || "";
        return { ...t, prompt: finalPrompt };
      });
      tasksRef.current = nextTasks;
      return nextTasks;
    });
  };

  // --- Download Queue to mitigate browser multiple-download blocking ---
  const downloadQueueRef = useRef<{ url: string; filename: string }[]>([]);
  const isDownloadingRef = useRef(false);

  const processDownloadQueue = async () => {
    if (isDownloadingRef.current || downloadQueueRef.current.length === 0)
      return;
    isDownloadingRef.current = true;

    while (downloadQueueRef.current.length > 0) {
      const item = downloadQueueRef.current.shift();
      if (!item) continue;

      try {
        if (item.url.startsWith("blob:") || item.url.startsWith("data:")) {
          const a = document.createElement("a");
          a.href = item.url;
          a.download = item.filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
        } else {
          const blob = await fetchUrlToBlobAndCache(item.url);
          if (blob) {
            const localBlobUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = localBlobUrl;
            a.download = item.filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(localBlobUrl), 60000);
          } else {
            const a = document.createElement("a");
            a.href = bypassProxy
              ? item.url
              : `/api/download-file?url=${encodeURIComponent(item.url)}&filename=${encodeURIComponent(item.filename)}`;
            a.download = item.filename;
            if (bypassProxy) a.target = "_blank";
            document.body.appendChild(a);
            a.click();
            a.remove();
          }
        }
      } catch (e) {
        console.warn("Auto download failed for", item.filename, e);
      }

      // Wait a short time between downloads to help browser heuristics and let user click 'Allow' if prompted
      await new Promise((res) => setTimeout(res, 1200));
    }

    isDownloadingRef.current = false;
  };

  const autoDownloadImage = (url: string, filename: string) => {
    downloadQueueRef.current.push({ url, filename });
    if (!isDownloadingRef.current) {
      processDownloadQueue();
    }
  };

  const handleDownloadAllZip = async () => {
    setIsDownloadingZip(true);
    try {
      const successTasks = tasks.filter(
        (t) => t.status === "success" && t.resultUrl,
      );

      const groupMap = new Map<string, GeneratedTask[]>();
      successTasks.forEach((t) => {
        const k = t.groupId || t.id;
        if (!groupMap.has(k)) groupMap.set(k, []);
        groupMap.get(k)!.push(t);
      });

      let exportTasks: GeneratedTask[] = [];
      groupMap.forEach((groupTasks) => {
        const approved = groupTasks.filter(
          (t) => t.reviewStatus === "approved",
        );
        if (approved.length > 0) {
          exportTasks.push(...approved);
        } else {
          exportTasks.push(...groupTasks);
        }
      });

      if (exportTasks.length === 0) {
        customAlert("没有成功生成的任务可下载");
        return;
      }

      const zip = new JSZip();
      const usedPaths = new Map<string, number>();
      const rowsForExcel: Array<{
        task: GeneratedTask;
        fullZipPath: string;
        blob?: Blob;
      }> = [];

      for (let i = 0; i < exportTasks.length; i++) {
        const task = exportTasks[i];
        if (!task.resultUrl) continue;

        const filenameStr = task.originalFilename
          ? String(task.originalFilename)
          : "";
        let ext = "png";
        const match = filenameStr.match(/\.([^.]+)$/);
        if (match) ext = match[1];

        const safeRelativePath =
          (task.relativePath ? String(task.relativePath) : filenameStr) ||
          `result_${i}`;
        const pathParts = safeRelativePath.split("/");
        let folders =
          pathParts.length > 1 ? pathParts.slice(0, -1).join("/") + "/" : "";

        let baseName = filenameStr
          ? filenameStr.replace(/\.[^/.]+$/, "")
          : `result_${i}`;

        const rawZipPath = `${folders}${baseName}.${ext}`;
        let fullZipPath = rawZipPath;

        const count = usedPaths.get(rawZipPath) || 0;
        if (count > 0) {
          fullZipPath = `${folders}${baseName}_${count}.${ext}`;
        }
        usedPaths.set(rawZipPath, count + 1);

        // Fetch directly from localforage if available
        let blob = await getImageFromCache(task.id);
        if (!blob) {
          // Fallback to fetch using central API helper
          try {
            blob = await fetchImageBlob(task.resultUrl, bypassProxy);
          } catch (e) {
            console.error("Failed to fetch image for zip:", e);
          }
        }

        if (blob) {
          zip.file(fullZipPath, blob);
          rowsForExcel.push({ task, fullZipPath, blob });
        }
      }

      const isUsingTable = tableFile !== null || tableData.length > 0;
      if (isUsingTable && rowsForExcel.length > 0) {
        let originalKeys: string[] = [];
        rowsForExcel.forEach((item) => {
          if (item.task.originalRow) {
            const keys = Object.keys(item.task.originalRow).filter(
              (k) => k !== "rawRow",
            );
            keys.forEach((k) => {
              if (!originalKeys.includes(k)) {
                originalKeys.push(k);
              }
            });
          }
        });

        if (originalKeys.length === 0) {
          originalKeys = ["名称", "提示词", "图片URL"];
        }

        const promptColumnKeywords = ["提示词", "Prompt", "prompt", "PROMPT"];
        let promptColIdx = -1;
        for (let k = 0; k < originalKeys.length; k++) {
          if (promptColumnKeywords.includes(originalKeys[k])) {
            promptColIdx = k;
            break;
          }
        }

        const finalHeaders: string[] = [];
        for (let k = 0; k < originalKeys.length; k++) {
          finalHeaders.push(originalKeys[k]);
          if (k === promptColIdx) {
            finalHeaders.push("生成图片快速预览");
          }
        }

        if (promptColIdx === -1) {
          finalHeaders.push("生成图片快速预览");
        }

        const gridRows = rowsForExcel.map((item) => {
          const rowObj: Record<string, any> = {};

          originalKeys.forEach((k) => {
            if (item.task.originalRow) {
              rowObj[k] = item.task.originalRow[k] ?? "";
            } else if (k === "名称") {
              rowObj[k] = item.task.originalFilename || "";
            } else if (k === "提示词") {
              rowObj[k] = item.task.originalPrompt || item.task.prompt || "";
            } else if (k === "图片URL") {
              rowObj[k] =
                item.task.tableImageUrl || item.task.referenceImage || "";
            } else {
              rowObj[k] = "";
            }
          });

          rowObj["生成图片快速预览"] = "";

          return finalHeaders.map((h) => {
            if (h === "生成图片快速预览") return "";
            return rowObj[h];
          });
        });

        // Use exceljs to build a worksheet with embedded images!
        const ExcelJS = (await import("exceljs")).default;
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet("生成结果对照");

        // Set custom column widths to make things spacious and professional
        worksheet.columns = finalHeaders.map((h) => {
          const isPreview = h === "生成图片快速预览";
          return {
            header: h,
            key: h,
            width: isPreview ? 58 : 18,
          };
        });

        // Style header row
        const headerRowObj = worksheet.getRow(1);
        headerRowObj.height = 28;
        headerRowObj.font = { bold: true, size: 11, name: "Microsoft YaHei" };
        headerRowObj.alignment = { vertical: "middle", horizontal: "center" };

        const previewColIdx = finalHeaders.indexOf("生成图片快速预览");

        for (let rowIdx = 0; rowIdx < rowsForExcel.length; rowIdx++) {
          const item = rowsForExcel[rowIdx];
          const excelRowIdx = rowIdx + 2;

          const rowObj: Record<string, any> = {};
          originalKeys.forEach((k) => {
            if (item.task.originalRow) {
              rowObj[k] = item.task.originalRow[k] ?? "";
            } else if (k === "名称") {
              rowObj[k] = item.task.originalFilename || "";
            } else if (k === "提示词") {
              rowObj[k] = item.task.originalPrompt || item.task.prompt || "";
            } else if (k === "图片URL") {
              rowObj[k] =
                item.task.tableImageUrl || item.task.referenceImage || "";
            } else {
              rowObj[k] = "";
            }
          });

          rowObj["生成图片快速预览"] = "";

          const rowValues = finalHeaders.map((h) => rowObj[h]);
          const addedRow = worksheet.addRow(rowValues);
          addedRow.height = 110; // Fallback height
          addedRow.alignment = { vertical: "middle" };

          // Embed real image with width 400 as requested
          if (previewColIdx !== -1) {
            try {
              if (item.blob) {
                // Resize blob to a width of 400 thumbnail and get its dimensions
                const imgData = await new Promise<{ base64: string; width: number; height: number }>((resolve, reject) => {
                  const url = URL.createObjectURL(item.blob!);
                  const img = new Image();
                  img.onload = () => {
                    const canvas = document.createElement("canvas");
                    let width = img.width;
                    let height = img.height;
                    const maxWidth = 400; // Force 400px width as requested
                    if (width > maxWidth) {
                      height = Math.round((height * maxWidth) / width);
                      width = maxWidth;
                    }
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext("2d");
                    if (ctx) {
                      ctx.drawImage(img, 0, 0, width, height);
                      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
                      canvas.width = 0;
                      canvas.height = 0;
                      resolve({ base64: dataUrl, width, height });
                    } else {
                      reject(new Error("Canvas context error"));
                    }
                    URL.revokeObjectURL(url);
                  };
                  img.onerror = () => {
                    URL.revokeObjectURL(url);
                    reject(new Error("Image loading error"));
                  };
                  img.src = url;
                });

                // Add image using exceljs
                const imageId = workbook.addImage({
                  base64: imgData.base64.split(",")[1] || imgData.base64,
                  extension: "jpeg",
                });

                // Dynamic row height fitting (height in points: 1 pixel = 0.75 points) + margin
                const paddedRowHeight = Math.min(Math.max(imgData.height * 0.75 + 15, 60), 400);
                addedRow.height = paddedRowHeight;

                // Anchor the image inside the worksheet
                worksheet.addImage(imageId, {
                  tl: { col: previewColIdx, row: rowIdx + 1, colOff: 10 * 9525, rowOff: 8 * 9525 } as any,
                  ext: { width: imgData.width, height: imgData.height },
                  editAs: "oneCell"
                });

                // Provide a click-to-open link on the cell itself
                const cell = worksheet.getCell(excelRowIdx, previewColIdx + 1);
                cell.value = {
                  text: " ", // Transparent text overlay
                  hyperlink: item.fullZipPath,
                  tooltip: "🔍 点击在 ZIP 内查看高质原图",
                };
              } else {
                throw new Error("No image blob available for row " + rowIdx);
              }
            } catch (imgErr) {
              console.error("Embedding image failed, falling back to link:", imgErr);
              const cell = worksheet.getCell(excelRowIdx, previewColIdx + 1);
              cell.value = {
                text: "🔍 打开原始大图",
                hyperlink: item.fullZipPath,
                tooltip: "点击在 ZIP 内查看原图",
              };
              cell.font = {
                name: "Microsoft YaHei",
                size: 10,
                color: { argb: "FF0000FF" },
                underline: true,
              };
              cell.alignment = { vertical: "middle", horizontal: "center" };
            }
          }
        }
        const excelBuffer = await workbook.xlsx.writeBuffer();
        const originalImportName = tableFile
          ? tableFile.name.replace(/\.[^/.]+$/, "")
          : "表格";
        zip.file(`${originalImportName}_生成结果对齐表.xlsx`, excelBuffer);
      }

      const content = await zip.generateAsync({ type: "blob" });
      saveAs(content, "batch_results.zip");
    } finally {
      setIsDownloadingZip(false);
    }
  };

  const handleDownloadFailedZip = async () => {
    setIsDownloadingFailedZip(true);
    try {
      const zip = new JSZip();
      const failedTasks = tasks.filter(
        (t) => t.status === "error" || t.reviewStatus === "rejected",
      );
      if (failedTasks.length === 0) {
        customAlert("没有失败或不通过的任务可下载");
        return;
      }

      const uniqueFailedGroups = new Map<string, GeneratedTask>();
      failedTasks.forEach((t) => {
        const key = t.groupId || t.originalFilename || t.id;
        if (!uniqueFailedGroups.has(key)) {
          uniqueFailedGroups.set(key, t);
        }
      });

      const failedList = Array.from(uniqueFailedGroups.values());
      const rows = failedList.map((t) => {
        let originalPrompt = t.prompt || "";
        if (fixedPrompt && originalPrompt.startsWith(fixedPrompt)) {
          originalPrompt = originalPrompt.slice(fixedPrompt.length).trim();
        }
        let imageUrl = "";
        if (!t.referenceFiles || t.referenceFiles.length === 0) {
          if (t.referenceImage && !t.referenceImage.startsWith("blob:")) {
            imageUrl = t.referenceImage;
          } else {
            // Fallback: Check original table data if we kept it
            const originalRow = tableData.find(
              (r) => r.name === t.originalFilename,
            );
            if (originalRow && originalRow.imageUrl) {
              imageUrl = originalRow.imageUrl;
            }
          }
        }
        return {
          名称: t.originalFilename || "",
          提示词: originalPrompt,
          图片URL: imageUrl,
        };
      });

      const worksheet = xlsx.utils.json_to_sheet(rows);
      const workbook = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(workbook, worksheet, "Failed Tasks");
      const excelBuffer = xlsx.write(workbook, {
        bookType: "xlsx",
        type: "array",
      });
      zip.file("failed_tasks.xlsx", excelBuffer);

      for (let i = 0; i < failedList.length; i++) {
        const task = failedList[i];

        if (task.referenceFiles && task.referenceFiles.length > 0) {
          for (const file of task.referenceFiles) {
            const fullPath = file.webkitRelativePath || file.name;
            const pathParts = fullPath.split("/");
            let currentZipFolder = zip;
            if (pathParts.length > 1) {
              const dirs = pathParts.slice(0, -1);
              for (const dir of dirs) {
                currentZipFolder =
                  currentZipFolder.folder(dir) || currentZipFolder;
              }
            }
            const fileName = pathParts[pathParts.length - 1];
            currentZipFolder.file(fileName, file);
          }
        } else if (
          task.referenceImage ||
          (task.referenceImages && task.referenceImages.length > 0)
        ) {
          const urls =
            task.referenceImages && task.referenceImages.length > 0
              ? task.referenceImages
              : task.referenceImage
                ? [task.referenceImage]
                : [];

          for (let j = 0; j < urls.length; j++) {
            const url = urls[j];
            try {
              let fileData: any;
              let isBase64 = false;

              if (url.startsWith("data:")) {
                fileData = url.split(",")[1];
                isBase64 = true;
              } else if (url.startsWith("http") && !url.startsWith("blob:")) {
                const blob = await fetchImageBlob(url, bypassProxy);
                fileData = blob;
                isBase64 = false;
              } else {
                const res = await fetch(url);
                fileData = await res.blob();
              }

              const filenameStr = task.originalFilename
                ? String(task.originalFilename)
                : "";
              let baseName = filenameStr
                ? filenameStr.replace(/\.[^/.]+$/, "")
                : `failed_${task.id}`;
              if (urls.length > 1) baseName += `_${j + 1}`;

              let ext = "png";
              const match = filenameStr
                ? filenameStr.match(/\.([^.]+)$/)
                : null;
              if (match) ext = match[1];

              let tempZip = zip;
              if (task.relativePath) {
                const parts = String(task.relativePath).split("/");
                if (parts.length > 1) {
                  const dirs = parts.slice(0, -1);
                  for (const p of dirs) {
                    if (p) tempZip = tempZip.folder(p) || tempZip;
                  }
                }
              }

              tempZip.file(`${baseName}.${ext}`, fileData, {
                base64: isBase64,
              });
            } catch (e) {
              console.error("Failed to fetch ref image for zip", e);
            }
          }
        }
      }

      const content = await zip.generateAsync({ type: "blob" });
      saveAs(content, "failed_tasks.zip");
    } catch (err) {
      console.error(err);
      customAlert("下载失败");
    } finally {
      setIsDownloadingFailedZip(false);
    }
  };

  const openRetweakModal = (i: number) => {
    const task = tasksRef.current[i];
    const available: string[] = [];
    if (task.fixedImage) available.push(task.fixedImage);
    if (task.referenceImages && task.referenceImages.length > 0)
      available.push(...task.referenceImages);
    else if (task.referenceImage) available.push(task.referenceImage);
    if (task.resultUrl) available.push(task.resultUrl);

    // Dedup
    const uniqueAvailable = Array.from(new Set(available));

    setRetweakModalConfig({
      isOpen: true,
      taskIndex: i,
      availableImages: uniqueAvailable,
      selectedIndices: [],
      prompt: task.prompt,
    });
  };

  const renderReviewMode = () => {
    if (currentReviewIndex === null) return null;
    const task = tasks[currentReviewIndex];
    if (!task) return null;

    const total = tasks.length;
    const successCount = tasks.filter((t) => t.status === "success").length;
    const errorCount = tasks.filter((t) => t.status === "error").length;
    const approvedCount = tasks.filter(
      (t) => t.reviewStatus === "approved",
    ).length;
    const rejectedCount = tasks.filter(
      (t) => t.reviewStatus === "rejected",
    ).length;
    const unreviewedCount = tasks.filter(
      (t) => t.reviewStatus === "none" || !t.reviewStatus,
    ).length;

    // Local review status updates (saving immediately)
    const handleApprove = () => {
      const nextTasks = tasks.map((t, idx) => {
        if (idx === currentReviewIndex) {
          return {
            ...t,
            reviewStatus:
              t.reviewStatus === "approved"
                ? ("none" as const)
                : ("approved" as const),
          };
        }
        return t;
      });
      setTasks(nextTasks);
      tasksRef.current = nextTasks;
      saveTasksToServer(nextTasks);
      if (
        tasks[currentReviewIndex].reviewStatus !== "approved" &&
        currentReviewIndex < tasks.length - 1
      ) {
        setCurrentReviewIndex(currentReviewIndex + 1);
      }
    };

    const handleReject = () => {
      const nextTasks = tasks.map((t, idx) => {
        if (idx === currentReviewIndex) {
          return {
            ...t,
            reviewStatus:
              t.reviewStatus === "rejected"
                ? ("none" as const)
                : ("rejected" as const),
          };
        }
        return t;
      });
      setTasks(nextTasks);
      tasksRef.current = nextTasks;
      saveTasksToServer(nextTasks);
      if (
        tasks[currentReviewIndex].reviewStatus !== "rejected" &&
        currentReviewIndex < tasks.length - 1
      ) {
        setCurrentReviewIndex(currentReviewIndex + 1);
      }
    };

    // Category and Zoom states are loaded from parent App scope to adhere to the Rules of Hooks

    const handleMouseDown = (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      setDragStart({ x: e.clientX - zoomState.x, y: e.clientY - zoomState.y });
    };

    const handleMouseMove = (e: React.MouseEvent) => {
      if (!isDragging) return;
      setZoomState((prev) => ({
        ...prev,
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      }));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    const handleWheel = (e: React.WheelEvent) => {
      e.preventDefault();
      const zoomFactor = 1.1;
      let newScale = zoomState.scale;
      if (e.deltaY < 0) {
        newScale = Math.min(newScale * zoomFactor, 5); // max 5x
      } else {
        newScale = Math.max(newScale / zoomFactor, 0.5); // min 0.5x
      }
      setZoomState((prev) => ({ ...prev, scale: newScale }));
    };

    const handleResetZoom = () => {
      setZoomState({ scale: 1, x: 0, y: 0 });
    };

    const containerEventHandlers = {
      onMouseDown: handleMouseDown,
      onMouseMove: handleMouseMove,
      onMouseUp: handleMouseUp,
      onMouseLeave: handleMouseUp,
      onWheel: handleWheel,
    };

    const refImg =
      task.referenceImage || (task.referenceImages && task.referenceImages[0]);

    // Calculate sum of sub-scores for total score
    const auditScores = task.auditResult?.scores;
    const totalScore = auditScores
      ? (auditScores.structure || 0) +
        (auditScores.color || 0) +
        (auditScores.pattern || 0) +
        (auditScores.text || 0) +
        (auditScores.lighting || 0)
      : null;

    return (
      <div className="fixed inset-0 bg-[#eef0f2] z-[60] flex flex-col font-sans p-6 gap-4">
        {/* Header */}
        <div className="h-16 rounded-[2rem] bg-white flex items-center justify-between px-6 shrink-0 z-10">
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setCurrentReviewIndex(null)}
              className="bg-gray-100 hover:bg-gray-200 text-gray-700 h-9 px-4"
            >
              <ArrowLeft className="w-4 h-4 mr-1.5" /> 返回列表
            </Button>
            <Button
              onClick={handleResetZoom}
              className="bg-gray-100 hover:bg-gray-200 text-gray-600 h-9 px-3"
              title="重置图片同步缩放/拖拽"
            >
              <Maximize2 className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex items-center gap-6 ml-6 text-[13px] whitespace-nowrap font-normal">
            <div className="flex items-center gap-3 w-44">
              <div className="flex-1 h-[8px] bg-[#ececec] rounded-full overflow-hidden flex">
                <div
                  className="h-full bg-[#ccff00] transition-all duration-500"
                  style={{ width: `${(successCount / total) * 100}%` }}
                />
                <div
                  className="h-full bg-[#ef4444] transition-all duration-500"
                  style={{ width: `${(errorCount / total) * 100}%` }}
                />
              </div>
              <div className="text-xs font-bold text-gray-600 flex items-center gap-1 tabular-nums justify-end min-w-[36px]">
                <span className={successCount > 0 ? "text-gray-900" : ""}>
                  {successCount}
                </span>
                <span className="text-gray-300 font-normal">/</span>
                <span>{total}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                className="px-3 py-1 bg-gray-50 hover:bg-gray-100 text-gray-700 rounded-full transition-colors font-bold cursor-pointer flex items-center gap-1.5"
                onClick={() => setTagPanelType("approved")}
              >
                通过: {approvedCount}
              </button>
              <button
                className="px-3 py-1 bg-gray-50 hover:bg-gray-100 text-gray-700 rounded-full transition-colors font-bold cursor-pointer flex items-center gap-1.5"
                onClick={() => setTagPanelType("rejected")}
              >
                不通过: {rejectedCount}
              </button>
              <button
                className="px-3 py-1 bg-gray-50 hover:bg-gray-100 text-gray-700 rounded-full transition-colors font-bold cursor-pointer flex items-center gap-1.5"
                onClick={() => setTagPanelType("none")}
              >
                未审核: {unreviewedCount}
              </button>
            </div>
          </div>
          <div className="font-bold text-gray-900 bg-gray-100 px-4 py-1.5 rounded-full">
            {currentReviewIndex + 1} / {tasks.length}
          </div>
        </div>

        {/* Main Area */}
        <div className="flex-1 overflow-hidden flex gap-4">
          {/* 1. Standard Reference (标准/参考图) */}
          <div className="flex-[2] bg-white rounded-2xl flex flex-col p-6 overflow-hidden">
            <div className="flex flex-col flex-1 overflow-hidden">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-gray-800 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                  参考图/标准图 (Left Standard)
                </h3>
                {task.referenceImages && task.referenceImages.length > 1 ? (
                  <div
                    className="flex items-center gap-1.5 bg-gray-100/80 rounded-full px-2 py-0.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() =>
                        setActiveRefImageIndex((prev) => Math.max(0, prev - 1))
                      }
                      disabled={activeRefImageIndex === 0}
                      className="p-1 hover:bg-gray-200 rounded-full text-gray-500 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-[10px] font-black text-gray-700 min-w-[2.2rem] text-center">
                      {activeRefImageIndex + 1} / {task.referenceImages.length}
                    </span>
                    <button
                      onClick={() =>
                        setActiveRefImageIndex((prev) =>
                          Math.min(task.referenceImages!.length - 1, prev + 1),
                        )
                      }
                      disabled={
                        activeRefImageIndex === task.referenceImages.length - 1
                      }
                      className="p-1 hover:bg-gray-200 rounded-full text-gray-500 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : task.referenceImages &&
                  task.referenceImages.length === 1 ? (
                  <span className="text-[10px] font-bold bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                    共 1 张
                  </span>
                ) : null}
              </div>
              <div
                className="flex-1 bg-gray-50 rounded-[2rem] overflow-hidden relative cursor-grab flex items-center justify-center p-4 border"
                {...containerEventHandlers}
              >
                {task.referenceImages && task.referenceImages.length > 0 ? (
                  <div
                    className={`w-full h-full flex items-center justify-center transition-all`}
                    style={{
                      transform: `scale(${zoomState.scale}) translate(${zoomState.x}px, ${zoomState.y}px)`,
                      transformOrigin: "center center",
                    }}
                  >
                    <HighResReferenceImage
                      file={
                        task.referenceFiles?.[activeRefImageIndex] ||
                        task.referenceFiles?.[0]
                      }
                      fallbackUrl={
                        task.referenceImages[activeRefImageIndex] ||
                        task.referenceImages[0]
                      }
                      className="max-h-full max-w-full object-contain pointer-events-none select-none rounded-xl"
                    />
                  </div>
                ) : task.referenceImage ? (
                  <div
                    className="w-full h-full flex items-center justify-center"
                    style={{
                      transform: `scale(${zoomState.scale}) translate(${zoomState.x}px, ${zoomState.y}px)`,
                      transformOrigin: "center center",
                    }}
                  >
                    <HighResReferenceImage
                      file={task.referenceFiles?.[0]}
                      fallbackUrl={task.referenceImage}
                      className="max-h-full max-w-full object-contain pointer-events-none select-none rounded-xl"
                    />
                  </div>
                ) : (
                  <div className="text-gray-400 text-xs">无参考素材</div>
                )}

                {/* Standard Thumbnails list inside viewport overlay */}
                {task.referenceImages && task.referenceImages.length > 1 && (
                  <div
                    className="absolute bottom-4 right-4 flex gap-1.5 bg-black/40 backdrop-blur-md p-1.5 rounded-2xl z-20"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {task.referenceImages.map((imgUrl, i) => (
                      <div
                        key={i}
                        onClick={() => setActiveRefImageIndex(i)}
                        className={`w-10 h-10 rounded-xl overflow-hidden border-2 cursor-pointer transition-all ${i === activeRefImageIndex ? "border-[#ccff00] scale-105 shadow-md" : "border-white/50 hover:border-white"}`}
                      >
                        <img
                          src={imgUrl}
                          className="w-full h-full object-cover pointer-events-none select-none"
                        />
                      </div>
                    ))}
                  </div>
                )}

                <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-sm text-white text-[10px] px-2.5 py-1 rounded-full font-bold select-none pointer-events-none uppercase tracking-wide">
                  标准素材
                </div>
              </div>
            </div>
          </div>

          {/* 2. Generated Poster (生成结果图) */}
          <div className="flex-[3] flex flex-col bg-white rounded-2xl p-6 overflow-hidden">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-gray-800 flex items-center gap-1.5 shrink-0">
                  <span className="w-2 h-2 rounded-full bg-[#ccff00]"></span>
                  生成渲染
                  {task.roundIndex !== undefined && (
                    <span className="text-gray-400 font-normal text-xs">
                      (第{task.roundIndex + 1}轮)
                    </span>
                  )}
                </h3>

                {task.status === "success" && (
                  <div className="flex items-center gap-2 ml-2">
                    <Button
                      disabled={task.auditStatus === "running"}
                      onClick={() =>
                        triggerAutoAudit(
                          currentReviewIndex,
                          task.id,
                          refImg,
                          task.resultUrl!,
                          undefined,
                        )
                      }
                      className="h-8 bg-[#ccff00] hover:bg-[#b8e600] border-none text-black font-bold text-xs rounded-lg shadow-[0_0_10px_rgba(204,255,0,0.4)] transition-all cursor-pointer px-4 flex items-center gap-1.5 animate-fadeIn duration-200 scale-100 active:scale-95 ml-1"
                    >
                      {task.auditStatus === "running" ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />{" "}
                          评估中...
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 fill-black" /> 开始评估
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3 shrink-0 flex-wrap">
                {task.groupId && (
                  <div className="flex gap-1.5">
                    {tasks.map((t, idx) => {
                      if (t.groupId === task.groupId) {
                        return (
                          <button
                            key={idx}
                            onClick={() => {
                              setCurrentReviewIndex(idx);
                              setActiveIssueIndex(null);
                            }}
                            className={`w-6 h-6 rounded-full text-xs font-bold transition-colors flex items-center justify-center ${currentReviewIndex === idx ? "bg-[#ccff00] text-black shadow-sm" : "bg-gray-200 text-gray-500 hover:bg-gray-300"}`}
                            title={`R${(t.roundIndex || 0) + 1}`}
                          >
                            {(t.roundIndex || 0) + 1}
                          </button>
                        );
                      }
                      return null;
                    })}
                  </div>
                )}
              </div>
            </div>
            <div
              className="flex-1 bg-gray-50 rounded-[2rem] overflow-hidden relative cursor-grab flex items-center justify-center p-4 border"
              {...containerEventHandlers}
            >
              {task.status === "success" && task.resultUrl ? (
                <div
                  className="w-full h-full flex items-center justify-center select-none"
                  style={{
                    transform: `scale(${zoomState.scale}) translate(${zoomState.x}px, ${zoomState.y}px)`,
                    transformOrigin: "center center",
                  }}
                >
                  <div className="relative inline-block w-fit h-fit leading-none">
                    <img
                      src={task.resultUrl}
                      className="max-h-[68vh] max-w-full w-auto h-auto pointer-events-none select-none rounded-2xl block"
                      alt="generated result"
                    />

                    {/* Interactive defect overlays mapped dynamically from AI model coordinates! */}
                    {(() => {
                      const issuesList = task.auditResult?.issues || [];
                      // Calculate global scaleFactor across all issues in the same task to prevent 10x offsets within the same model response
                      const allCoordinates = issuesList.flatMap(
                        (iss) => iss.bbox || [],
                      );
                      const taskMaxVal =
                        allCoordinates.length > 0
                          ? Math.max(...allCoordinates)
                          : 0;
                      const scaleFactor = taskMaxVal > 150 ? 10 : 1;

                      return issuesList.map((issue, idx) => {
                        const [rawY1, rawX1, rawY2, rawX2] = issue.bbox;
                        const x1 = rawX1 / scaleFactor;
                        const y1 = rawY1 / scaleFactor;
                        const x2 = rawX2 / scaleFactor;
                        const y2 = rawY2 / scaleFactor;

                        let colorClasses =
                          "border-red-500 bg-red-400/10 text-red-600 shadow-[0_0_8px_rgba(239,68,68,0.4)]";
                        let badgeBg = "bg-red-500";
                        if (issue.type === "color_mismatch") {
                          colorClasses =
                            "border-yellow-500 bg-yellow-400/10 text-yellow-600 shadow-[0_0_8px_rgba(234,179,8,0.4)]";
                          badgeBg = "bg-yellow-500";
                        } else if (issue.type === "pattern_error") {
                          colorClasses =
                            "border-orange-500 bg-orange-400/10 text-orange-600 shadow-[0_0_8px_rgba(249,115,22,0.4)]";
                          badgeBg = "bg-orange-500";
                        }

                        const isHighlighted = activeIssueIndex === idx;

                        return (
                          <div
                            key={idx}
                            className={`absolute border-2 rounded transition-all duration-300 z-30 ${colorClasses} ${isHighlighted ? "scale-105 border-slate hover:bg-black/15 ring-2 ring-white z-40" : "opacity-80"}`}
                            style={{
                              left: `${x1}%`,
                              top: `${y1}%`,
                              width: `${x2 - x1}%`,
                              height: `${y2 - y1}%`,
                            }}
                            onMouseEnter={() => setActiveIssueIndex(idx)}
                            onMouseLeave={() => setActiveIssueIndex(null)}
                          >
                            {/* Super clean numbered bubble. Extremely space-saving to prevent clutter overlapping */}
                            <div
                              className={`absolute -top-2.5 -left-2.5 w-5 h-5 rounded-full ${badgeBg} text-white border-2 border-white flex items-center justify-center text-[9px] font-black shadow-md select-none`}
                            >
                              {idx + 1}
                            </div>

                            {/* Detailed floating label. Only shows on hover to completely prevent readability overlapping */}
                            {isHighlighted && (
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 bg-gray-950/95 text-white text-[10px] px-2 py-1 rounded shadow-lg z-50 whitespace-nowrap border border-white/20">
                                <div className="font-bold flex items-center gap-1">
                                  {issue.type === "text_error"
                                    ? "🔤 文字畸变"
                                    : issue.type === "structure_mismatch"
                                      ? "🧩 结构不一致"
                                      : issue.type === "color_mismatch"
                                        ? "🎨 颜色偏差"
                                        : "🧵 图案缺陷"}
                                </div>
                                <div className="text-[9px] text-gray-300 font-medium max-w-[150px] overflow-hidden text-ellipsis whitespace-normal">
                                  {issue.desc}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              ) : task.status === "running" ? (
                <div
                  className="flex flex-col items-center text-blue-500"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Loader2 className="w-8 h-8 animate-spin mb-2" />
                  <p className="font-bold text-xs">
                    {task.progressMsg || "正在生成中..."}
                  </p>
                </div>
              ) : task.status === "error" ? (
                <div
                  className="text-red-500 flex flex-col items-center text-center px-4"
                  onClick={(e) => e.stopPropagation()}
                >
                  <X className="w-8 h-8 mb-2" />
                  <p className="font-bold text-xs">任务失败</p>
                  <p className="text-xs mt-1 text-gray-500 max-w-md">
                    {task.errorMsg}
                  </p>
                </div>
              ) : (
                <div className="text-gray-400 font-bold text-xs">尚未生成</div>
              )}
              <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-sm text-white text-[10px] px-2.5 py-1 rounded-full font-bold select-none pointer-events-none uppercase tracking-wide">
                生成图海报
              </div>
            </div>
          </div>

          {/* 3. AI Consistency Audit Dashboard (AI 智能一致性审核侧边栏面板) */}
          <div className="w-96 shrink-0 bg-[#f7f9fa] border border-gray-200/80 rounded-2xl flex flex-col overflow-hidden shadow-sm p-0">
            {/* Action or Result viewport */}
            {task.status !== "success" ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-gray-400 gap-2">
                <ShieldAlert className="w-10 h-10 text-gray-300" />
                <p className="text-xs font-bold font-sans">
                  请等待鞋/服/配等片生成成功后，再运行 AI 一致性审核大盘
                </p>
              </div>
            ) : (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Display Audit Content */}
                <div className="flex-1 flex flex-col gap-3 min-h-0">
                  {/* 3a. Status: Not Run */}
                  {(!task.auditStatus || task.auditStatus === "none") && (
                    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-gray-500 gap-2 bg-white rounded-2xl border border-gray-100 min-h-[16rem]">
                      <Sparkles className="w-8 h-8 text-[#ccff00] animate-pulse" />
                      <p className="text-xs font-bold text-gray-700">
                        未进行 AI 检测
                      </p>
                      <p className="text-[11px] text-gray-400 max-w-xs font-sans">
                        使用小米 mimo-2.5
                        模型计算结构一致性得分并标注不一致的位置
                      </p>
                    </div>
                  )}

                  {/* 3b. Status: Running */}
                  {task.auditStatus === "running" && (
                    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-gray-500 gap-3 bg-white rounded-2xl border border-dashed border-[#ccff00] min-h-[16rem] animate-pulse shadow-[0_0_15px_rgba(204,255,0,0.15)]">
                      <Loader2 className="w-10 h-10 text-[#CCFF00] animate-spin" />
                      <div>
                        <p className="text-xs font-bold text-[#CCFF00]">
                          正在跨图对齐特征并检测...
                        </p>
                        <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                          大约需要 15-25 秒评估。
                        </p>
                      </div>
                    </div>
                  )}

                  {/* 3c. Status: Err */}
                  {task.auditStatus === "error" && (
                    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-red-500 gap-2.5 bg-red-50/50 rounded-2xl border border-red-200 min-h-[16rem]">
                      <ShieldAlert className="w-10 h-10 text-red-500" />
                      <div>
                        <p className="text-xs font-bold text-red-700">
                          审核调用失败
                        </p>
                        <p className="text-[11px] text-red-500/80 mt-1 leading-relaxed">
                          {task.auditError ||
                            "API network error high volatility"}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() =>
                          triggerAutoAudit(
                            currentReviewIndex,
                            task.id,
                            refImg,
                            task.resultUrl!,
                            undefined,
                          )
                        }
                        className="mt-2 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-lg px-4"
                      >
                        重新对齐比对
                      </Button>
                    </div>
                  )}

                  {/* 3d. Status: Success (The Dashboard!) - Merged layout inside single card with nicer border radius */}
                  {task.auditStatus === "success" && task.auditResult && (
                    <div className="flex-1 bg-[#0a0a0a] rounded-2xl p-5 border border-[#222] shadow-sm flex flex-col gap-4 text-white min-h-0">
                      {/* Combined Score Card & Radar Chart Layout */}
                      <div className="flex items-center justify-between border-b pb-3.5 border-[#222]">
                        <div className="flex flex-col">
                          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">
                            一致一票特征终判得分
                          </span>
                          <div className="flex items-baseline gap-1 mt-0.5">
                            <span
                              className={`text-4xl font-black tabular-nums tracking-tighter leading-none ${totalScore && totalScore >= 70 ? "text-[#ccff00]" : "text-red-500"}`}
                            >
                              {totalScore !== null ? totalScore : "N/A"}
                            </span>
                            <span className="text-[10px] text-gray-500 font-semibold font-mono">
                              / 满分 100 分
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-1">
                          <span className="text-[10px] font-bold text-gray-500">
                            自动智能决策 :
                          </span>
                          {task.auditResult.pass ? (
                            <div className="flex items-center gap-1 bg-[#ccff00]/10 text-[#ccff00] border border-[#ccff00]/30 px-3 py-1 rounded-full text-xs font-black shadow-sm uppercase tracking-wide">
                              <CheckCircle2 className="w-3.5 h-3.5 text-[#ccff00] shrink-0" />{" "}
                              PASS (通过)
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 bg-rose-500/10 text-rose-500 border border-rose-500/30 px-3 py-1 rounded-full text-xs font-black shadow-sm uppercase tracking-wide">
                              <XCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />{" "}
                              REJECT (打回)
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 5-Dimensional Radar Chart (Vibrant Light theme, seamlessly embedded) */}
                      <div className="flex flex-col items-center pt-2">
                        <MetricRadarChart
                          scores={task.auditResult.scores}
                          darkPanel={true}
                        />
                      </div>

                      {/* Separator */}
                      <div className="w-full h-[1px] bg-[#222]"></div>

                      {/* Defect Cards List Inside Unified View */}
                      <div className="flex flex-col gap-2 flex-1 min-h-0">
                        <h5 className="text-[11px] font-bold text-gray-400 flex items-center gap-1 border-b pb-1.5 border-[#222] shrink-0">
                          <AlertTriangle className="w-3.5 h-3.5 text-orange-500" />
                          不一致瑕疵定位 ({task.auditResult.issues.length} 处)
                        </h5>

                        {task.auditResult.issues.length === 0 ? (
                          <p className="text-[11px] text-emerald-400 font-semibold text-center py-2 shrink-0">
                            ✓ 未发现严重细节不一致项，完美通过对齐！
                          </p>
                        ) : (
                          <div className="flex flex-col gap-3 overflow-y-auto pr-1 scrollbar-minimal flex-1">
                            {task.auditResult.issues.map((issue, idx) => {
                              const isHighlighted = activeIssueIndex === idx;

                              let typeText = "🧩 结构不一致";
                              if (issue.type === "color_mismatch") {
                                typeText = "🎨 颜色偏差";
                              } else if (issue.type === "pattern_error") {
                                typeText = "🧵 图案瑕疵";
                              } else if (issue.type === "text_error") {
                                typeText = "🔤 文字畸变";
                              }

                              return (
                                <div
                                  key={idx}
                                  onMouseEnter={() => setActiveIssueIndex(idx)}
                                  onMouseLeave={() => setActiveIssueIndex(null)}
                                  className={`rounded-lg transition-colors border ${isHighlighted ? "border-gray-500 bg-[#1a1a1a]" : "border-transparent hover:border-[#333] hover:bg-[#111]"} p-2 text-[11px] flex flex-col gap-1 cursor-pointer select-none`}
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="font-bold text-white">
                                      {typeText}
                                    </span>
                                    <span className="font-mono text-[9px] text-gray-500">
                                      BBox: [
                                      {issue.bbox
                                        .map((n) => Math.round(n))
                                        .join(", ")}
                                      ]
                                    </span>
                                  </div>
                                  <p className="text-gray-300 leading-relaxed font-medium">
                                    {issue.desc}
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div className="shrink-0 pt-3 border-t border-[#222] mt-auto">
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full border-none bg-[#ccff00] hover:bg-[#b8e600] text-black font-bold shadow-[0_0_8px_rgba(204,255,0,0.3)] transition-colors"
                          onClick={async () => {
                            await exportTaskToPsdHelper(
                              task,
                              task.auditResult?.issues || [],
                              false,
                            );
                          }}
                        >
                          <Download className="w-4 h-4 mr-1.5" /> 导出结果分层
                          PSD 文件
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Bottom Actions */}
        <div className="h-20 bg-white rounded-[2rem] flex items-center justify-between px-6 shrink-0 relative">
          <div className="flex gap-4">
            <Button
              onClick={() => {
                const nextTasks = tasksRef.current.map((t) =>
                  t.reviewStatus === "rejected" || t.status === "error"
                    ? {
                        ...t,
                        status: "pending" as const,
                        reviewStatus: "none" as const,
                        errorMsg: undefined,
                        auditStatus: "none" as const,
                        auditResult: undefined,
                        auditError: undefined,
                      }
                    : t,
                );
                setTasks(nextTasks);
                tasksRef.current = nextTasks;
                saveTasksToServer(nextTasks);
                setCurrentReviewIndex(null);
                setTimeout(runTasks, 10);
              }}
              className="bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold shrink-0"
            >
              重新生成 (不通过+失败)
            </Button>
            <Button
              className="bg-black hover:bg-gray-800 text-[#ccff00] font-bold shrink-0"
              onClick={handleDownloadAllZip}
              disabled={isDownloadingZip}
            >
              {isDownloadingZip ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Download className="w-4 h-4 mr-2" />
              )}
              下载所有结果包 (Zip)
            </Button>
            <Button
              className="border-2 border-red-500 bg-white hover:bg-red-50 text-red-500 font-bold shrink-0"
              onClick={handleDownloadFailedZip}
              disabled={isDownloadingFailedZip}
            >
              {isDownloadingFailedZip ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Download className="w-4 h-4 mr-2" />
              )}
              下载失败任务
            </Button>
          </div>

          <div className="flex items-center gap-4 text-sm font-medium text-gray-500">
            <span className="text-xs text-gray-400">
              快捷键: [↑/↓] 切换任务 &nbsp;&nbsp; 鼠标滚轮/拖拽:
              双图同步缩放/对齐比对
            </span>

            <div className="w-[1px] h-6 bg-gray-200 mx-1"></div>

            <span className="text-sm font-bold text-gray-800 shrink-0">
              手动终审
            </span>

            <div className="flex items-center gap-2 select-none">
              <Button
                className={`h-10 border-2 rounded-xl flex items-center justify-center gap-1.5 leading-none transition-all px-6 ${task.reviewStatus === "rejected" ? "bg-red-500 border-transparent hover:bg-red-600 text-white shadow-[0_0_10px_rgba(239,68,68,0.4)] font-bold scale-[1.02]" : "bg-white hover:bg-red-50 text-gray-800 border-gray-200 hover:border-red-500 hover:text-red-500"}`}
                onClick={handleReject}
              >
                <span className="text-sm font-bold">
                  {task.reviewStatus === "rejected" ? "已打回" : "不通过"}
                </span>
              </Button>
              <Button
                className={`h-10 border-2 rounded-xl flex items-center justify-center gap-1.5 leading-none transition-all px-6 ${task.reviewStatus === "approved" ? "bg-[#ccff00] border-transparent hover:bg-[#b8e600] text-black shadow-[0_0_10px_rgba(204,255,0,0.5)] font-bold scale-[1.02]" : "bg-black hover:bg-gray-800 text-[#ccff00] border-black"}`}
                onClick={handleApprove}
              >
                <span className="text-sm font-bold">
                  {task.reviewStatus === "approved" ? "已通过" : "通过"}
                </span>
              </Button>
            </div>

            <div className="w-[1px] h-6 bg-gray-200 mx-1"></div>

            <div className="flex items-center gap-2">
              <Button
                className="h-10 px-4 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl font-bold"
                disabled={currentReviewIndex === 0}
                onClick={() => {
                  setCurrentReviewIndex(currentReviewIndex - 1);
                  setActiveIssueIndex(null);
                }}
              >
                <ChevronLeft className="w-4 h-4" /> 上一个
              </Button>
              <Button
                className="h-10 px-4 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl font-bold"
                disabled={currentReviewIndex === tasks.length - 1}
                onClick={() => {
                  setCurrentReviewIndex(currentReviewIndex + 1);
                  setActiveIssueIndex(null);
                }}
              >
                下一个 <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const runTasks = () => {
    if (!accessKey || !secretKey) {
      customAlert("请输入 LOVART_ACCESS_KEY 和 LOVART_SECRET_KEY");
      return;
    }

    const pendingTasks = tasksRef.current.filter((t) => t.status === "pending");
    if (pendingTasks.length === 0) {
      customAlert("没有待处理的任务");
      return;
    }

    if (tableData.length > 0) {
      const hasOriginalPending = pendingTasks.some(
        (t) => !t.id.startsWith("retweak-"),
      );
      if (hasOriginalPending) {
        const confirmMsg = `即将开始执行 ${pendingTasks.length} 个任务。\n\n当前统一提示词为：\n${fixedPrompt}\n\n（将与表格中的提示词合并拼接）。\n\n确认继续吗？`;
        customConfirm(confirmMsg, startExecution);
        return;
      }
    }

    startExecution();
  };

  const startExecution = async () => {
    abortRef.current = false;
    setIsProcessing(true);

    const updateTask = (idx: number, updates: Partial<GeneratedTask>) => {
      tasksRef.current = tasksRef.current.map((t, i) =>
        i === idx ? { ...t, ...updates } : t,
      );
      setTasks(tasksRef.current);
    };

    try {
      // 0. Set mode
      const modeRes = await setLovartMode(accessKey, secretKey, !fastTrack);
      if (!modeRes.ok) throw new Error("Failed to set mode");

      // 1. Create a single project for the entire batch to avoid spamming the backend
      let projId = globalProjectId;
      if (!projId) {
        const projData = await saveLovartProject(
          accessKey,
          secretKey,
          "Batch Generation",
        );
        if (projData.code !== 0)
          throw new Error(projData.message || `创建生成项目失败`);
        projId = projData.data.project_id;
        setGlobalProjectId(projId);
      }

      // 2. Upload fixed image once if it exists (pull from browser IndexedDB cache if page was reloaded)
      let fixedImageUrl = "";
      let currentFixedFileToUpload = fixedImageFile;
      if (!currentFixedFileToUpload) {
        try {
          const { getImageFromCache } = await import("@/src/lib/imageCache");
          const cachedBlob = await getImageFromCache("fixed_image_original");
          if (cachedBlob) {
            currentFixedFileToUpload = new File([cachedBlob], "fixed.png", {
              type: cachedBlob.type,
            });
          }
        } catch (e) {
          console.error(
            "Failed to retrieve original fixed image from cache:",
            e,
          );
        }
      }

      if (currentFixedFileToUpload) {
        try {
          const upData = await uploadFileToLovart(
            currentFixedFileToUpload,
            currentFixedFileToUpload.name,
            accessKey,
            secretKey,
          );
          if (upData.code !== 0)
            throw new Error(upData.message || "上传返回异常");
          fixedImageUrl = upData.data.url;
        } catch (e: any) {
          throw new Error("无法上传固定图片 " + e.message);
        }
      }

      const CONCURRENCY = concurrency || 3;

      let batchRound = 0;
      let cachedRefUrls: Record<number, string[]> = {};

      // Pause/resume loop control
      const getNextPendingIndex = async (): Promise<number | undefined> => {
        while (!abortRef.current) {
          if (isPausedRef.current) {
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }

          let minRoundIndex = Infinity;
          for (let i = 0; i < tasksRef.current.length; i++) {
            if (tasksRef.current[i].status === "pending") {
              const rIdx = tasksRef.current[i].roundIndex ?? 0;
              if (rIdx < minRoundIndex) {
                minRoundIndex = rIdx;
              }
            }
          }

          if (minRoundIndex !== Infinity) {
            const idx = tasksRef.current.findIndex(
              (t) =>
                t.status === "pending" && (t.roundIndex ?? 0) === minRoundIndex,
            );
            if (idx !== -1) {
              updateTask(idx, { status: "running" });
              return idx;
            }
          }

          // No more pending tasks
          return undefined;
        }
        return undefined;
      };

      const processTaskWithRetry = async (i: number) => {
        let retryCount = 0;
        const MAX_RETRIES = 5;
        let success = false;
        let lastError = "";
        let currentThreadId = "";

        while (
          retryCount <= MAX_RETRIES &&
          !abortRef.current &&
          !isPausedRef.current &&
          !success
        ) {
          if (abortRef.current) {
            updateTask(i, { status: "pending", errorMsg: undefined });
            return;
          }
          const task = tasksRef.current[i];
          lastError = "";

          try {
            if (abortRef.current) throw new Error("任务已手动中止");
            if (retryCount === 0) {
              updateTask(i, { status: "running", errorMsg: undefined });
            }

            const getBase64FromUrl = async (url: string) => {
              if (url.startsWith("data:")) return url;
              if (url.startsWith("http") && !url.startsWith("blob:")) {
                const blob = await fetchImageBlob(url, bypassProxy);
                return new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onloadend = () => resolve(reader.result as string);
                  reader.onerror = reject;
                  reader.readAsDataURL(blob);
                });
              }
              const res = await fetch(url);
              const blob = await res.blob();
              return new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
              });
            };

            const uploadImg = async (b64: string, name: string) => {
              let blob: Blob;
              if (b64.startsWith("data:")) {
                const arr = b64.split(",");
                const mime = arr[0].match(/:(.*?);/)?.[1] || "image/png";
                const bstr = atob(arr[1]);
                let n = bstr.length;
                const u8arr = new Uint8Array(n);
                while (n--) {
                  u8arr[n] = bstr.charCodeAt(n);
                }
                blob = new Blob([u8arr], { type: mime });
              } else {
                const bstr = atob(b64);
                let n = bstr.length;
                const u8arr = new Uint8Array(n);
                while (n--) {
                  u8arr[n] = bstr.charCodeAt(n);
                }
                blob = new Blob([u8arr], { type: "image/png" });
              }

              try {
                const data = await uploadFileToLovart(
                  blob,
                  name,
                  accessKey,
                  secretKey,
                );
                if (data.code === 0) return data.data.url;
                throw new Error(data.message || "上传异常");
              } catch (err: any) {
                throw new Error(`上传图片失败: ${name} 详情: ${err.message}`);
              }
            };

            // Build attachments
            const attachments: string[] = [];

            if (task.uploadedFixedImage !== undefined) {
              if (task.uploadedFixedImage)
                attachments.push(task.uploadedFixedImage);
            } else {
              let currentFixedImage = task.fixedImage || fixedImageUrl;
              if (currentFixedImage) {
                if (
                  currentFixedImage.startsWith("http") &&
                  !currentFixedImage.startsWith("blob:")
                ) {
                  task.uploadedFixedImage = currentFixedImage;
                  attachments.push(currentFixedImage);
                } else {
                  // Since task.fixedImage is a 300px thumbnail base64 to keep payload tiny,
                  // we try to extract the original high-resolution fixed image from IndexedDB cache
                  // to ensure generated rendering remains ultra-crisp!
                  let realFixedImageBase64 = currentFixedImage;
                  try {
                    const { getImageFromCache } =
                      await import("@/src/lib/imageCache");
                    const keyToLoad = task.fixedImageKey || "fixed_image_original";
                    const cachedBlob = await getImageFromCache(keyToLoad);
                    if (cachedBlob) {
                      realFixedImageBase64 = await new Promise<string>(
                        (resolve, reject) => {
                          const reader = new FileReader();
                          reader.onloadend = () =>
                            resolve(reader.result as string);
                          reader.onerror = reject;
                          reader.readAsDataURL(cachedBlob);
                        },
                      );
                    }
                  } catch (cacheErr) {
                    console.error(
                      "Failed to retrieve high-res fixed image from cache:",
                      cacheErr,
                    );
                  }

                  const b64 = await getBase64FromUrl(realFixedImageBase64);
                  task.uploadedFixedImage = await uploadImg(b64, "fixed.png");
                  attachments.push(task.uploadedFixedImage);
                }
              } else {
                task.uploadedFixedImage = "";
              }
              updateTask(i, { uploadedFixedImage: task.uploadedFixedImage });
            }

            if (task.uploadedReferenceImages !== undefined) {
              attachments.push(...task.uploadedReferenceImages);
            } else {
              if (!cachedRefUrls[i]) {
                cachedRefUrls[i] = [];
                const refs =
                  task.referenceImages && task.referenceImages.length > 0
                    ? task.referenceImages
                    : task.referenceImage
                      ? [task.referenceImage]
                      : [];

                if (task.referenceFiles && task.referenceFiles.length > 0) {
                  for (const file of task.referenceFiles) {
                    cachedRefUrls[i].push(
                      await uploadImg(await fileToBase64(file), file.name),
                    );
                  }
                } else {
                  for (const ref of refs) {
                    if (ref.startsWith("http") && !ref.startsWith("blob:")) {
                      cachedRefUrls[i].push(ref);
                    } else {
                      cachedRefUrls[i].push(
                        await uploadImg(await getBase64FromUrl(ref), "ref.png"),
                      );
                    }
                  }
                }
              }
              if (cachedRefUrls[i] && cachedRefUrls[i].length > 0) {
                attachments.push(...cachedRefUrls[i]);
              }
              updateTask(i, { uploadedReferenceImages: cachedRefUrls[i] });
            }

            let agentPrompt = task.prompt;

            if (!task.id.startsWith("retweak-")) {
              agentPrompt = `${resolution}，${ratio}； ${task.prompt}`;

              // Instruct the agent explicitly to use all provided attachments IN A SINGLE CALL
              if (attachments && attachments.length > 0) {
                agentPrompt =
                  agentPrompt +
                  `\n\n【防多扣费指令】注意：你只能进行**1次**生图工具调用！请将所有 ${attachments.length} 张图片在这一次调用中作为参考图一起使用。绝对不能循环调用工具，绝对不能为每张图片分别生成图片！必须只生成1张图片！`;
              }

              if (useExecutionPrefix) {
                agentPrompt = `【强制原样指令】你必须严格原样使用下面括号内的提示词调用工具生图，不准添加任何发散细节、扩写或拆解，即便你觉得提示词不完善也必须原样透传。如果工具报错也请直接将错误抛出，不要自动修正！\n原样使用的提示词内容如下：\n【 ${agentPrompt} 】`;
              }
            }

            // Start chat
            if (!currentThreadId) {
              try {
                // Force set mode right before submitting task to ensure no external changes leak in during long batch runs
                await setLovartMode(accessKey, secretKey, !fastTrack);

                // Add a small delay to allow Lovart backend to sync mode/project before creating task (helps prevent '模型未找到')
                await new Promise((r) => setTimeout(r, 1000));

                const mappedToolName = (() => {
                  if (modelType === "GPT Image 2")
                    return "generate_image_gpt_image_2";
                  if (modelType === "Nano Banana Pro")
                    return "generate_image_nano_banana_pro";
                  if (modelType === "Nano Banana 2")
                    return "generate_image_nano_banana_2";
                  if (modelType === "seedream 4.5")
                    return "generate_image_seedream_v4_5";
                  return undefined; // Let Agent Decide
                })();

                const chatRes = await submitLovartChat(
                  {
                    project_id: projId,
                    prompt: agentPrompt,
                    attachments: attachments.length ? attachments : undefined,
                    mode: useThinkingMode ? "thinking" : "fast",
                    tool_config: mappedToolName
                      ? { include_tools: [mappedToolName] }
                      : undefined,
                  },
                  accessKey,
                  secretKey,
                );

                if (chatRes.status === 429) {
                  const retryAfter = chatRes.headers.get("Retry-After");
                  const waitS = retryAfter ? parseInt(retryAfter, 10) : 10;
                  throw new Error(`Rate limit: API被限流，等待时长: ${waitS}s`);
                }
                if (chatRes.status === 409) {
                  throw new Error("Rate limit: 生图请求冲突");
                }
                const chatData = await chatRes.json();

                // Intelligent Blocker: If we requested Free (unlimited: true) but it still replies it is going to consume points/fast track, we block it to save user's Lovart points.
                if (
                  !fastTrack &&
                  chatData.data &&
                  (chatData.data.unlimited === false ||
                    chatData.data.is_unlimited === false)
                ) {
                  throw new Error(
                    "智能阻断: 分配到快速通道(扣费)，自动重试以切换回免费通道",
                  );
                }

                if (chatData.code === 2012)
                  throw new Error("Rate limit: 并发满载排队中");
                if (chatData.code !== 0)
                  throw new Error(chatData.message || "发起生图请求失败");

                currentThreadId = chatData.data
                  ? chatData.data.thread_id
                  : chatData.threadId; // fallback
                if (!currentThreadId) throw new Error("无法获取 threadId");
              } catch (chatErr: any) {
                throw chatErr;
              }
            }
            if (abortRef.current) throw new Error("任务已手动中止");

            // Poll status
            let isDone = false;
            let isFailed = false;
            let failedReasonStr = "";

            while (!isDone && !isFailed && !abortRef.current) {
              // Add jitter and increase interval to avoid hitting 300/min query limits easily
              await new Promise((r) =>
                setTimeout(r, 6000 + Math.random() * 4000),
              );
              if (abortRef.current) return;

              try {
                const statRes = await getLovartChatStatus(
                  currentThreadId,
                  accessKey,
                  secretKey,
                );

                if (statRes.status === 429) {
                  const retryAfter = statRes.headers.get("Retry-After");
                  const delayMs = retryAfter
                    ? parseInt(retryAfter, 10) * 1000
                    : 10000;
                  await new Promise((r) => setTimeout(r, delayMs));
                  continue;
                }
                if (!statRes.ok) {
                  console.warn(`HTTP异常 ${statRes.status}`);
                  continue;
                }
                const statData = await statRes.json();
                if (statData.code !== 0) {
                  console.warn(statData.message || "返回错误码");
                  continue;
                }

                // Intelligent Blocker: If it's fast channel during polling and we wanted free channel, abort the entire batch.
                if (
                  !fastTrack &&
                  statData.data &&
                  (statData.data.unlimited === false ||
                    statData.data.is_unlimited === false)
                ) {
                  currentThreadId = ""; // 废弃该收费任务，重新创建
                  throw new Error(
                    "智能阻断: 排队中变更为快速通道(扣费)，废弃由于强转通道导致的扣费任务并重启免费任务",
                  );
                }

                const status = statData.data?.status;
                const qData = statData.data || {};
                let pMsg = "";
                if (qData.rank !== undefined)
                  pMsg += `排队位次: ${qData.rank} `;
                if (qData.queue_index !== undefined)
                  pMsg += `排队中: ${qData.queue_index} `;
                if (qData.wait_time !== undefined)
                  pMsg += `预计排队: ${qData.wait_time}s`;
                else if (qData.queue_time !== undefined)
                  pMsg += `预计排队: ${qData.queue_time}s`;

                if (!pMsg) {
                  if (
                    status === "queue" ||
                    status === "queueing" ||
                    status === "queued"
                  ) {
                    pMsg = "排队中...";
                  } else if (
                    status === "doing" ||
                    status === "running" ||
                    status === "processing"
                  ) {
                    pMsg = "生图中...";
                  }
                }

                if (pMsg) {
                  updateTask(i, { progressMsg: pMsg });
                }

                if (status === "done" || status === "completed") {
                  isDone = true;
                } else if (
                  status === "aborted" ||
                  status === "failed" ||
                  status === "error"
                ) {
                  isFailed = true;
                  failedReasonStr =
                    statData.data?.failed_reason || "生成任务失败退出";
                }
              } catch (pollErr: any) {
                // Silenced polling network error to avoid console spam
                // console.warn(`Polling network error: ${pollErr.message}`);
              }
            }

            if (abortRef.current) throw new Error("任务已手动中止");
            if (isFailed) throw new Error(`任务端侧失败: ${failedReasonStr}`);

            // Fetch result
            let resultUrl = "";
            let resultAttempt = 0;

            while (!abortRef.current && resultAttempt < 10) {
              resultAttempt++;
              try {
                const resRes = await getLovartChatResult(
                  currentThreadId,
                  accessKey,
                  secretKey,
                );

                if (resRes.status === 429) {
                  const retryAfter = resRes.headers.get("Retry-After");
                  const delayMs = retryAfter
                    ? parseInt(retryAfter, 10) * 1000
                    : 10000;
                  await new Promise((r) => setTimeout(r, delayMs));
                  continue;
                }
                if (!resRes.ok) {
                  console.warn(`HTTP异常 ${resRes.status}`);
                  await new Promise((r) => setTimeout(r, 2000));
                  continue;
                }

                const resData = await resRes.json();
                if (resData.code !== 0) {
                  console.warn(resData.message || "获取结果失败");
                  await new Promise((r) => setTimeout(r, 2000));
                  continue;
                }

                const items = resData.data?.items || [];
                for (const item of items) {
                  const arts = item.artifacts || [];
                  for (const art of arts) {
                    if (art.type === "image" && art.content) {
                      resultUrl = art.content;
                      break;
                    }
                  }
                  if (resultUrl) break;
                }
                if (resultUrl) break; // Got result successfully

                // If no valid image content, wait and retry
                await new Promise((r) => setTimeout(r, 3000));
              } catch (resErr: any) {
                console.warn(
                  `Network error fetching result: ${resErr.message}`,
                );
                await new Promise((r) => setTimeout(r, 3000));
              }
            }
            if (abortRef.current) throw new Error("任务已手动中止");
            if (!resultUrl) throw new Error("结果中没有有效图片");

            let blobToSave: Blob | null = null;
            if (resultUrl && resultUrl.startsWith("http")) {
              try {
                blobToSave = await fetchUrlToBlobAndCache(resultUrl, task.id);
              } catch (e) {
                console.warn("Failed to precache image", e);
              }
            }

            updateTask(i, {
              status: "success",
              resultUrl,
              errorMsg: undefined,
              retryCount,
            });

            // Chain the automatic consistency audit
            const refImg =
              task.referenceImage ||
              (task.referenceImages && task.referenceImages[0]);
            if (autoAuditEnabledRef.current) {
              if (refImg && resultUrl) {
                triggerAutoAudit(i, task.id, refImg, resultUrl);
              }
            } else {
              const currentTask = tasksRef.current[i];
              const filenameStr = currentTask.originalFilename
                ? String(currentTask.originalFilename)
                : "";
              const baseName = filenameStr
                ? filenameStr.replace(/\.[^/.]+$/, "")
                : `result_${currentTask.id}`;
              const extMatch = filenameStr
                ? filenameStr.match(/\.([^/.]+)$/)
                : null;
              const ext = extMatch ? extMatch[1] : "png";
              const downloadFilename = `${baseName}.${ext}`;
              autoDownloadImage(resultUrl, downloadFilename);
            }

            success = true;
          } catch (err: any) {
            lastError = err.message;
            const isRateLimitError = lastError.includes("Rate limit");
            const isIntelligentBlock = lastError.includes("智能阻断");
            const isHttpError = true; // Retry any non-abort error up to MAX_RETRIES

            if (
              (isRateLimitError ||
                isIntelligentBlock ||
                (isHttpError && retryCount < MAX_RETRIES)) &&
              !abortRef.current
            ) {
              if (!isRateLimitError && !isIntelligentBlock) {
                retryCount++;
              }
              const waitCount =
                isRateLimitError || isIntelligentBlock ? 1 : retryCount;
              let delayMs = 0;
              if (isRateLimitError) {
                const match = lastError.match(/等待时长:\s*(\d+)s/);
                if (match && match[1]) {
                  delayMs =
                    parseInt(match[1], 10) * 1000 +
                    Math.floor(Math.random() * 5000);
                } else {
                  delayMs = 15000 + Math.floor(Math.random() * 15000); // 15s to 30s jitter
                }
              } else if (isIntelligentBlock) {
                delayMs = 10000 + Math.floor(Math.random() * 10000); // 10s to 20s wait before retry
              } else {
                delayMs =
                  Math.pow(2, waitCount) * 2000 +
                  Math.floor(Math.random() * 2000);
              }

              let displayError = lastError;
              if (displayError.includes("模型未找到"))
                displayError = "云端资源冷启动中(模型未找到)";

              updateTask(i, {
                status: "running",
                errorMsg: `提示: ${displayError}，等待 ${Math.round(delayMs / 1000)}s 后重试${!isRateLimitError && !isIntelligentBlock ? ` (${retryCount}/${MAX_RETRIES})` : ""}`,
              });

              let elapsed = 0;
              while (
                elapsed < delayMs &&
                !abortRef.current &&
                !isPausedRef.current
              ) {
                await new Promise((r) => setTimeout(r, 1000));
                elapsed += 1000;
              }
              if (isPausedRef.current) {
                // Pause clicked during delay
                updateTask(i, {
                  status: "pending",
                  errorMsg: `任务已暂停 (重试 ${retryCount}/${MAX_RETRIES})`,
                });
                return;
              }
              if (!abortRef.current) {
                updateTask(i, {
                  status: "running",
                  errorMsg: `重试 ${retryCount}/${MAX_RETRIES} ...`,
                });
              }
            } else {
              break;
            }
          }
        }

        if (!success) {
          const finalStatus = abortRef.current ? "pending" : "error";
          const finalMsg = abortRef.current ? undefined : lastError;
          updateTask(i, {
            status: finalStatus,
            errorMsg: finalMsg,
            retryCount,
          });
        }
      };

      const executeNext = async (workerIdx: number) => {
        // Stagger worker start to avoid instant QPS spikes, with randomness
        const startDelay = Math.floor(Math.random() * 5000) + workerIdx * 3000;
        await new Promise((r) => setTimeout(r, startDelay));
        while (!abortRef.current) {
          const nextIdx = await getNextPendingIndex();
          if (nextIdx === undefined) {
            // If paused, wait and try again
            if (isPausedRef.current) {
              await new Promise((r) => setTimeout(r, 2000));
              continue;
            }
            break;
          }
          await processTaskWithRetry(nextIdx);
        }
      };

      const workers = Array(CONCURRENCY)
        .fill(null)
        .map((_, idx) => executeNext(idx));
      await Promise.all(workers);

      if (!abortRef.current) {
        const waitForAudits = async () => {
          while (!abortRef.current) {
            const isAuditing = tasksRef.current.some(
              (t) => t.auditStatus === "running" || t.auditStatus === "pending",
            );
            if (!isAuditing) break;
            await new Promise((r) => setTimeout(r, 2000));
          }
        };

        await waitForAudits();

        if (!abortRef.current) {
          // Automated processing for unreviewed items
          let triggeredAny = false;
          for (let i = 0; i < tasksRef.current.length; i++) {
            const t = tasksRef.current[i];
            if (
              t.status === "success" &&
              (!t.auditStatus || t.auditStatus === "none") &&
              t.reviewStatus !== "approved" &&
              t.reviewStatus !== "rejected"
            ) {
              const refImg =
                t.referenceImage || (t.referenceImages && t.referenceImages[0]);
              if (autoAuditEnabledRef.current && refImg && t.resultUrl) {
                triggerAutoAudit(i, t.id, refImg, t.resultUrl);
                triggeredAny = true;
              }
            }
          }
          if (triggeredAny) {
            await waitForAudits();
          }
        }

        // Generate retry tasks for rejected items
        if (!abortRef.current) {
          let anyRetriesAdded = false;
          const currentTasks = tasksRef.current;
          const rejectedTasks = currentTasks.filter(
            (t) => t.reviewStatus === "rejected" && t.status === "success",
          );

          for (const rej of rejectedTasks) {
            const rejRound = rej.roundIndex || 0;
            if (rejRound >= 3) continue; // max 3 automatic retries

            const hasLaterRound = currentTasks.some(
              (t) =>
                t.groupId === rej.groupId &&
                t.originalFilename === rej.originalFilename &&
                (t.roundIndex || 0) > rejRound,
            );

            if (!hasLaterRound) {
              const newTask: GeneratedTask = {
                ...rej,
                id:
                  Date.now().toString() +
                  Math.random().toString(36).substring(7),
                status: "pending",
                resultUrl: undefined,
                errorMsg: undefined,
                auditStatus: "none",
                auditResult: undefined,
                reviewStatus: "none",
                progressMsg: undefined,
                retryCount: 0,
                roundIndex: rejRound + 1,
              };
              tasksRef.current = [...tasksRef.current, newTask];
              anyRetriesAdded = true;
            }
          }

          if (anyRetriesAdded) {
            setTasks(tasksRef.current);
            setIsProcessing(false);
            // Automatic restart
            setTimeout(() => startExecutionRef.current?.(), 1000);
            return;
          }
        }
      }
    } catch (err: any) {
      customAlert("批量任务启动失败：" + err.message);
    }

    setIsProcessing(false);
    if (abortRef.current) {
      tasksRef.current = tasksRef.current.map((t) =>
        t.status === "running"
          ? { ...t, status: "pending", errorMsg: undefined }
          : t,
      );
      setTasks(tasksRef.current);
    }
  };

  startExecutionRef.current = startExecution;

  return (
    <div className="h-screen w-screen bg-[#eef0f2] flex flex-col font-sans overflow-hidden p-3 gap-3">
      {/* Header Strips */}
      <div className="bg-white rounded-[2rem] px-5 py-2 shrink-0 flex items-center justify-between z-10 overflow-x-auto shadow-none">
        <h1 className="font-bold text-gray-800 flex items-center gap-2 shrink-0 mr-4">
          {/* 预留 logo 位置，可上传覆盖 public/logo.svg 更换 */}
          <div className="w-6 h-6 rounded flex items-center justify-center overflow-hidden shrink-0">
            <img
              src="/logo.svg"
              alt="Logo"
              className="w-full h-full object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).src =
                  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="4" /><path d="m9 10 2 2 4-4" /></svg>';
              }}
            />
          </div>
          批量生图工具
          <span className="text-[10px] text-gray-400 font-normal ml-1 whitespace-nowrap">
            *滔搏内部使用
          </span>
        </h1>
        <div className="flex gap-4 items-center shrink-0">
          <div className="flex items-center gap-2 pl-0 border-transparent">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsAuditSettingsOpen(true)}
              className="h-9 px-4 text-xs bg-[#fff5f5] hover:bg-rose-100 text-rose-700 font-bold rounded-full border border-rose-200 flex items-center gap-1.5 cursor-pointer focus:ring-0 focus:ring-offset-0 transition-colors shadow-none shrink-0"
              title="打开系统参数与一致性检测 (MIMO) 全局配置"
            >
              <Settings className="w-3.5 h-3.5 text-rose-500 shrink-0" />
              <span>系统 & 审计设置</span>
            </Button>
          </div>
          <div className="flex items-center gap-2 border-l pl-4 border-gray-200">
            <Label className="text-xs text-gray-500 whitespace-nowrap">
              并发
            </Label>
            <Input
              className="h-9 w-[60px] text-xs text-center bg-gray-100 rounded-full border-none focus:bg-gray-200"
              value={concurrency}
              onChange={(e) => setConcurrency(parseInt(e.target.value) || 3)}
              type="number"
              min={1}
              max={30}
            />
          </div>
          <div
            className="flex items-center gap-2 border-l pl-4 border-gray-200 cursor-pointer"
            onClick={() => setFastTrack(!fastTrack)}
          >
            <div
              className={`w-10 h-6 flex items-center rounded-full p-1 transition-colors ${fastTrack ? "bg-[#ccff00]" : "bg-gray-300"}`}
            >
              <div
                className={`w-4 h-4 rounded-full shadow-md transform transition-transform ${fastTrack ? "translate-x-4 bg-black" : "translate-x-0 bg-white"}`}
              ></div>
            </div>
            <Label className="text-xs text-gray-600 whitespace-nowrap cursor-pointer select-none">
              钞能力
            </Label>
          </div>
          <div
            className="flex items-center gap-2 border-l pl-4 border-gray-200 cursor-pointer"
            onClick={() => setUseThinkingMode(!useThinkingMode)}
          >
            <div
              className={`w-10 h-6 flex items-center rounded-full p-1 transition-colors ${useThinkingMode ? "bg-[#ccff00]" : "bg-gray-300"}`}
            >
              <div
                className={`w-4 h-4 rounded-full shadow-md transform transition-transform ${useThinkingMode ? "translate-x-4 bg-black" : "translate-x-0 bg-white"}`}
              ></div>
            </div>
            <Label className="text-xs text-gray-600 whitespace-nowrap cursor-pointer select-none">
              Agent 思考模式
            </Label>
          </div>
          <div className="flex items-center gap-2 border-l pl-4 border-gray-200">
            <Label className="text-xs text-gray-500 whitespace-nowrap">
              模型
            </Label>
            <Select value={modelType} onValueChange={setModelType}>
              <SelectTrigger className="h-9 text-xs bg-gray-100 rounded-full border-none px-3 focus:ring-0 focus:ring-offset-0 hover:bg-gray-200 data-[state=open]:bg-gray-200 cursor-pointer w-[160px]">
                <SelectValue placeholder="选择模型" />
              </SelectTrigger>
              <SelectContent className="rounded-2xl border-none shadow-lg max-h-[300px]">
                <SelectItem
                  value="GPT Image 2"
                  className="text-xs rounded-xl cursor-pointer"
                >
                  GPT Image 2
                </SelectItem>
                <SelectItem
                  value="Nano Banana Pro"
                  className="text-xs rounded-xl cursor-pointer"
                >
                  Nano Banana Pro
                </SelectItem>
                <SelectItem
                  value="Nano Banana 2"
                  className="text-xs rounded-xl cursor-pointer"
                >
                  Nano Banana 2
                </SelectItem>
                <SelectItem
                  value="seedream 4.5"
                  className="text-xs rounded-xl cursor-pointer"
                >
                  Seedream 4.5
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 pl-2">
            <Label className="text-xs text-gray-500 whitespace-nowrap">
              分辨率
            </Label>
            <Select value={resolution} onValueChange={setResolution}>
              <SelectTrigger className="h-9 text-xs bg-gray-100 rounded-full border-none px-3 focus:ring-0 focus:ring-offset-0 hover:bg-gray-200 data-[state=open]:bg-gray-200 cursor-pointer w-[90px]">
                <SelectValue placeholder="分辨率" />
              </SelectTrigger>
              <SelectContent className="rounded-2xl border-none shadow-lg">
                <SelectItem
                  value="1K"
                  className="text-xs rounded-xl cursor-pointer"
                >
                  1K
                </SelectItem>
                <SelectItem
                  value="2K"
                  className="text-xs rounded-xl cursor-pointer"
                >
                  2K
                </SelectItem>
                <SelectItem
                  value="medium 1K"
                  className="text-xs rounded-xl cursor-pointer"
                >
                  medium 1K
                </SelectItem>
                <SelectItem
                  value="low 2K"
                  className="text-xs rounded-xl cursor-pointer"
                >
                  low 2K
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 pl-2 border-l border-gray-200">
            <Label className="text-xs text-gray-500 whitespace-nowrap">
              比例
            </Label>
            <Select value={ratio} onValueChange={setRatio}>
              <SelectTrigger className="h-9 text-xs bg-gray-100 rounded-full border-none px-3 focus:ring-0 focus:ring-offset-0 hover:bg-gray-200 data-[state=open]:bg-gray-200 cursor-pointer w-[80px]">
                <SelectValue placeholder="比例" />
              </SelectTrigger>
              <SelectContent className="rounded-2xl border-none shadow-lg">
                <SelectItem
                  value="auto"
                  className="text-xs rounded-xl cursor-pointer"
                >
                  auto
                </SelectItem>
                <SelectItem
                  value="1:1"
                  className="text-xs rounded-xl cursor-pointer"
                >
                  1:1
                </SelectItem>
                <SelectItem
                  value="2:3"
                  className="text-xs rounded-xl cursor-pointer"
                >
                  2:3
                </SelectItem>
                <SelectItem
                  value="3:4"
                  className="text-xs rounded-xl cursor-pointer"
                >
                  3:4
                </SelectItem>
                <SelectItem
                  value="9:16"
                  className="text-xs rounded-xl cursor-pointer"
                >
                  9:16
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Task Config */}
      <div className="bg-white rounded-2xl px-5 py-3 shrink-0 flex flex-col justify-center z-10 shadow-none border-0 overflow-x-auto [&::-webkit-scrollbar]:hidden">
        <div className="flex items-center gap-4 flex-nowrap min-w-max w-full">
          <div className="flex items-center gap-2 relative shrink-0">
            <div
              className={`relative flex items-center bg-gray-100 rounded-full h-11 transition-colors border border-transparent ${refCollectionPreviews.length > 0 ? "pl-5 pr-2" : "px-5"}`}
            >
              <div className="relative flex items-center">
                <Label className="text-sm font-bold text-gray-800 whitespace-nowrap flex items-center gap-1.5 cursor-pointer pr-1">
                  <ImageIcon className="w-4 h-4 text-gray-600" /> 参考图/集
                </Label>
                <div className="flex items-center gap-1.5 text-[10px] ml-1.5 text-gray-500 font-medium z-20">
                  <div className="relative bg-white border border-gray-200 hover:border-gray-400 px-2.5 py-1.5 rounded-full cursor-pointer transition-colors shadow-none select-none">
                    <span>选择图片</span>
                    <Input
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleRefCollectionFilesChange}
                      title=""
                    />
                  </div>
                  <div className="relative bg-white border border-gray-200 hover:border-gray-400 px-2.5 py-1.5 rounded-full cursor-pointer transition-colors shadow-none select-none">
                    <span>选择文件夹</span>
                    <Input
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      type="file"
                      /* @ts-ignore */ webkitdirectory=""
                      directory=""
                      multiple
                      onChange={handleRefCollectionFolderChange}
                      title=""
                    />
                  </div>
                </div>
              </div>

              {refCollectionPreviews.length > 0 && (
                <>
                  <span className="w-[1px] h-4 bg-gray-300 mx-2 self-center" />
                  <div className="flex items-center gap-1.5 shrink-0 select-none">
                    <div className="relative flex items-center">
                      <div
                        className="flex items-center -space-x-2 overflow-hidden cursor-pointer transition-transform hover:scale-105"
                        onClick={() => setIsRefCollectionModalOpen(true)}
                        title="点击查看所有参考图"
                      >
                        {refCollectionPreviews.slice(0, 2).map((prev, i) => (
                          <div
                            key={i}
                            className="relative w-7 h-7 rounded-full border border-white overflow-hidden bg-gray-100 shrink-0"
                          >
                            <img
                              src={prev}
                              className="w-full h-full object-cover"
                              alt={`Ref ${i}`}
                            />
                          </div>
                        ))}
                      </div>
                      <div className="absolute -top-1 -right-1.5 bg-slate-900 text-[#ccff00] text-[8px] font-black px-1 py-0.25 rounded-full border border-white min-w-[14px] h-3.5 flex items-center justify-center pointer-events-none">
                        {refCollectionFiles.length}
                      </div>
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setIsRefCollectionModalOpen(true)}
                      className="h-6 w-6 text-gray-400 hover:text-gray-600 hover:bg-transparent rounded-full transition-all cursor-pointer flex items-center justify-center p-0"
                      title="展开图集列表"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </>
              )}

              {fixedImageFile && (
                <div
                  className="flex items-center justify-center p-1 ml-1.5 text-gray-400 hover:text-red-500 hover:bg-gray-200 rounded-full transition-colors relative z-10 cursor-pointer"
                  onClick={handleClearRefCollection}
                  title="清空图集"
                >
                  <X className="w-3.5 h-3.5" />
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 flex-1 border-l pl-4 border-gray-200">
            <Label className="text-sm text-gray-400 whitespace-nowrap font-bold shrink-0">
              统一提示词
            </Label>
            <Input
              className="h-10 text-sm w-full min-w-[300px] bg-gray-100 rounded-full border-none focus:bg-gray-200 px-4"
              placeholder="在此输入..."
              value={fixedPrompt}
              onChange={(e) => handleFixedPromptChange(e.target.value)}
            />
          </div>

          <div
            className={`flex items-center bg-gray-800 text-white rounded-full shrink-0 relative transition-colors ml-4 ${folderFiles.length > 0 ? "pl-6 pr-1.5 py-1.5 hover:bg-gray-700" : "px-6 py-2.5 hover:bg-gray-700"}`}
          >
            <div className="relative flex items-center cursor-pointer">
              <Label className="text-sm font-bold whitespace-nowrap cursor-pointer flex items-center gap-1.5 pr-2">
                <FolderUp className="w-4 h-4" />{" "}
                {folderFiles.length
                  ? `已选择 ${folderFiles.length} 张图片`
                  : "上传文件夹"}
              </Label>
              <Input
                className="absolute inset-0 opacity-0 cursor-pointer w-full"
                type="file"
                /* @ts-ignore */ webkitdirectory=""
                directory=""
                multiple
                onChange={handleFolderSelect}
                title=""
              />
            </div>
            {folderFiles.length > 0 && (
              <div
                className="flex items-center justify-center p-1.5 hover:bg-gray-600 rounded-full transition-colors relative z-10 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  setFolderFiles([]);
                  rebuildTasks(tableData, [], refCollectionFiles, fixedPrompt);
                }}
              >
                <X className="w-4 h-4 text-gray-300" />
              </div>
            )}
          </div>

          <div
            className={`flex items-center bg-[#ccff00] text-black rounded-full shrink-0 relative transition-colors ml-2 ${tableFile ? "pl-6 pr-1.5 py-1.5 hover:bg-[#b8e600]" : "px-6 py-2.5 hover:bg-[#b8e600]"}`}
          >
            <div className="relative flex items-center cursor-pointer">
              <Label className="text-sm font-bold whitespace-nowrap cursor-pointer flex items-center gap-1.5 pr-2">
                <FileUp className="w-4 h-4 text-black" />{" "}
                {tableFile
                  ? `已加载表格: ${tableFile.name}`
                  : "上传表格(.xlsx, .csv)"}
              </Label>
              <Input
                className="absolute inset-0 opacity-0 cursor-pointer w-full"
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleTableUpload}
                title=""
              />
            </div>
            {tableFile && (
              <div
                className="flex items-center justify-center p-1.5 hover:bg-black/10 rounded-full transition-colors relative z-10 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  setTableFile(null);
                  setTableData([]);
                  rebuildTasks(
                    [],
                    folderFiles,
                    refCollectionFiles,
                    fixedPrompt,
                  );
                }}
              >
                <X className="w-4 h-4 text-black/60" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Task List Space */}
      <div className="flex-1 overflow-hidden flex flex-col bg-white rounded-2xl p-6 shadow-none border-0">
        {/* Header */}
        <div className="pb-4 flex flex-col sm:flex-row gap-4 sm:items-center justify-between shrink-0 border-none">
          <div className="text-lg font-bold text-gray-800 flex flex-wrap items-center gap-y-2">
            任务列表
            {/* Grouped parent-child controls to visually show the relationship */}
            <div className="flex items-center ml-4 bg-gray-100 rounded-full p-1 gap-1">
              {/* Parent Option: Auto-Audit */}
              <div className="flex items-center gap-2 px-3 py-1 rounded-full hover:bg-gray-200/50 transition-colors">
                <Switch
                  id="auto-audit"
                  checked={autoAuditEnabled}
                  onCheckedChange={(checked) => {
                    setAutoAuditEnabled(checked);
                    if (!checked) {
                      setAutoPsdDownloadEnabled(false);
                    }
                  }}
                />
                <Label
                  htmlFor="auto-audit"
                  className="text-sm font-semibold text-gray-700 cursor-pointer select-none"
                >
                  自动审核
                </Label>
              </div>

              {/* Minimalist Divider */}
              <div className="w-[1px] h-4 bg-gray-300/80 my-auto" />

              {/* Child Option: Auto-PSD Download */}
              <div 
                className={`flex items-center gap-2 px-3 py-1 rounded-full transition-all duration-200 ${
                  autoAuditEnabled 
                    ? "opacity-100" 
                    : "opacity-45"
                }`}
              >
                <Switch
                  id="auto-psd"
                  checked={autoPsdDownloadEnabled}
                  onCheckedChange={(checked) => {
                    setAutoPsdDownloadEnabled(checked);
                    if (checked) {
                      setAutoAuditEnabled(true);
                    }
                  }}
                />
                <Label
                  htmlFor="auto-psd"
                  className={`text-sm select-none cursor-pointer transition-colors ${
                    autoAuditEnabled ? "font-semibold text-gray-750" : "font-normal text-gray-400"
                  }`}
                >
                  下载PSD
                </Label>
              </div>
            </div>
            {tasks.length > 0 && (
              <div className="flex items-center gap-6 ml-6 text-[13px] whitespace-nowrap font-normal">
                <div className="flex items-center gap-3 w-44">
                  <div className="flex-1 h-[8px] bg-[#ececec] rounded-full overflow-hidden flex">
                    <div
                      className="h-full bg-[#ccff00] transition-all duration-500"
                      style={{
                        width: `${(tasks.filter((t) => t.status === "success").length / tasks.length) * 100}%`,
                      }}
                    />
                    <div
                      className="h-full bg-[#ef4444] transition-all duration-500"
                      style={{
                        width: `${(tasks.filter((t) => t.status === "error").length / tasks.length) * 100}%`,
                      }}
                    />
                  </div>
                  <div className="text-xs font-bold text-gray-600 flex items-center gap-1 tabular-nums justify-end min-w-[36px]">
                    <span
                      className={
                        tasks.filter((t) => t.status === "success").length > 0
                          ? "text-gray-900"
                          : ""
                      }
                    >
                      {tasks.filter((t) => t.status === "success").length}
                    </span>
                    <span className="text-gray-300 font-normal">/</span>
                    <span>{tasks.length}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    className="px-3 py-1 bg-gray-50 hover:bg-gray-100 text-gray-700 rounded-full transition-colors font-bold cursor-pointer flex items-center gap-1.5"
                    onClick={() => {
                      setTagPanelType("approved");
                    }}
                  >
                    通过:{" "}
                    {tasks.filter((t) => t.reviewStatus === "approved").length}
                  </button>

                  <button
                    className="px-3 py-1 bg-gray-50 hover:bg-gray-100 text-gray-700 rounded-full transition-colors font-bold cursor-pointer flex items-center gap-1.5"
                    onClick={() => {
                      setTagPanelType("rejected");
                    }}
                  >
                    不通过:{" "}
                    {tasks.filter((t) => t.reviewStatus === "rejected").length}
                  </button>

                  <div className="px-3 py-1 bg-gray-50 text-gray-700 rounded-full font-bold flex items-center gap-2 relative">
                    未审核:{" "}
                    {
                      tasks.filter(
                        (t) =>
                          t.status === "success" &&
                          !["running", "success"].includes(
                            t.auditStatus as any,
                          ),
                      ).length
                    }
                  </div>
                  <Button
                    className="h-8 rounded-full px-3 text-xs bg-black text-white hover:bg-black/80 shadow-none border-none cursor-pointer flex items-center gap-1 shrink-0"
                    onClick={handleBatchAudit}
                    disabled={
                      isBatchAuditing ||
                      tasks.filter(
                        (t) =>
                          t.status === "success" &&
                          !["running", "success"].includes(
                            t.auditStatus as any,
                          ),
                      ).length === 0
                    }
                  >
                    {isBatchAuditing && (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    )}{" "}
                    一键审核
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden shrink-0 px-1 py-2">
            <div className="flex bg-gray-100 p-1 rounded-full mr-2 shrink-0">
              <button
                className={`px-4 py-1.5 text-xs font-bold rounded-full transition-colors ${filterTab === "all" ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"}`}
                onClick={() => {
                  setFilterTab("all");
                  setCurrentPage(1);
                }}
              >
                全部
              </button>
              <button
                className={`px-4 py-1.5 text-xs font-bold rounded-full transition-colors ${filterTab === "success" ? "bg-white shadow text-emerald-500" : "text-gray-500 hover:text-gray-700"}`}
                onClick={() => {
                  setFilterTab("success");
                  setCurrentPage(1);
                }}
              >
                成功
              </button>
              <button
                className={`px-4 py-1.5 text-xs font-bold rounded-full transition-colors ${filterTab === "error" ? "bg-white shadow text-red-500" : "text-gray-500 hover:text-gray-700"}`}
                onClick={() => {
                  setFilterTab("error");
                  setCurrentPage(1);
                }}
              >
                失败
              </button>
              <button
                className={`px-4 py-1.5 text-xs font-bold rounded-full transition-colors ${filterTab === "running" ? "bg-white shadow text-blue-500" : "text-gray-500 hover:text-gray-700"}`}
                onClick={() => {
                  setFilterTab("running");
                  setCurrentPage(1);
                }}
              >
                处理中
              </button>
            </div>

            <Button
              size="sm"
              onClick={handleDownloadAllZip}
              disabled={
                isDownloadingZip || !tasks.some((t) => t.status === "success")
              }
              className="h-9 bg-gray-100 hover:bg-gray-200 text-gray-800 shadow-none rounded-full px-4 text-xs shrink-0"
            >
              {isDownloadingZip ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Download className="w-4 h-4 mr-1.5" />
              )}
              打包下载成功结果
            </Button>
            <Button
              size="sm"
              onClick={handleDownloadFailedZip}
              disabled={
                isDownloadingFailedZip ||
                !tasks.some(
                  (t) => t.status === "error" || t.reviewStatus === "rejected",
                )
              }
              className="h-9 border-2 border-red-500 bg-white text-red-500 hover:bg-red-50 shadow-none rounded-full px-4 text-xs shrink-0"
            >
              {isDownloadingFailedZip ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Download className="w-4 h-4 mr-1.5" />
              )}
              下载失败任务
            </Button>

            <div className="flex items-center gap-2 border-l border-gray-200 pl-4 mr-2">
              <Label className="text-xs text-gray-500 font-bold whitespace-nowrap">
                生成轮次
              </Label>
              <Input
                className="h-9 w-[60px] text-xs text-center bg-gray-100 rounded-full border-none focus:bg-gray-200 font-bold"
                value={roundCount}
                onChange={(e) => {
                  const v = parseInt(e.target.value);
                  if (!isNaN(v) && v >= 1) {
                    setRoundCount(v);
                    setTimeout(
                      () =>
                        rebuildTasks(
                          tableData,
                          folderFiles,
                          refCollectionFiles,
                          fixedPrompt,
                          v,
                        ),
                      10,
                    );
                  } else if (e.target.value === "") {
                    // @ts-ignore
                    setRoundCount("");
                  }
                }}
                onBlur={() => {
                  if (!roundCount || roundCount < 1) {
                    setRoundCount(1);
                    rebuildTasks(
                      tableData,
                      folderFiles,
                      refCollectionFiles,
                      fixedPrompt,
                      1,
                    );
                  }
                }}
                type="number"
                min={1}
                max={10}
              />
            </div>

            {isProcessing ? (
              <>
                <Button
                  size="sm"
                  onClick={() => setIsPaused(!isPaused)}
                  className={`h-9 px-4 rounded-full font-bold shadow-none shrink-0 ${isPaused ? "bg-[#ccff00] text-black hover:bg-[#b8e600]" : "bg-gray-800 text-white hover:bg-gray-700"}`}
                >
                  {isPaused ? (
                    <Play className="w-4 h-4" />
                  ) : (
                    <Pause className="w-4 h-4" />
                  )}
                  <span className="ml-1.5">
                    {isPaused ? "继续执行" : "暂停调度"}
                  </span>
                </Button>
                <Button
                  size="sm"
                  onClick={handleStop}
                  variant="destructive"
                  className="h-9 px-4 rounded-full font-bold shrink-0"
                >
                  中止执行
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                onClick={runTasks}
                disabled={!tasks.length || !accessKey || !secretKey}
                className="h-9 bg-[#ccff00] text-gray-900 border-none hover:bg-[#b8e600] gap-1.5 transition-all font-bold shadow-none rounded-full px-6 shrink-0"
              >
                <Play className="w-4 h-4" /> 开始执行
              </Button>
            )}
          </div>
        </div>

        {/* Grid Container */}
        <div className="flex-1 overflow-auto -mx-4 px-4 pt-4 pb-8">
          {tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-6">
              <ImageIcon className="w-12 h-12 text-gray-300" />
              <p className="text-lg font-bold">
                暂无任务，请在上方配置并选择图片 / 表格
              </p>

              <div className="flex flex-col mt-12 max-w-4xl self-center w-full">
                <div className="flex items-center justify-center gap-4 mb-8">
                  <div className="h-[1px] bg-gray-100 flex-1 max-w-[120px]"></div>
                  <h4 className="font-bold text-gray-400 text-sm flex items-center justify-center gap-2 tracking-wider">
                    <Settings2 className="w-4 h-4" />
                    快速上手指南
                  </h4>
                  <div className="h-[1px] bg-gray-100 flex-1 max-w-[120px]"></div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 px-4 w-full">
                  {/* Card 1 */}
                  <div className="bg-gray-50/80 hover:bg-gray-50 border border-gray-100/80 rounded-3xl p-6 transition-colors">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-2xl bg-white shadow-sm flex items-center justify-center text-gray-600 shrink-0 border border-gray-100">
                        <Settings className="w-5 h-5" />
                      </div>
                      <div className="text-gray-700 font-bold text-[15px]">
                        全局基础配置
                      </div>
                    </div>
                    <div className="text-[13px] text-gray-500 leading-relaxed pl-1 pr-2">
                      通用的参数可以在顶部直接设定。提前配置好「固定提示词」和「固定图一」（可无）后，后续上传的产品图片或表格内容会自动与它们合并，应用到所有批处理任务中。
                    </div>
                  </div>

                  {/* Card 2 */}
                  <div className="bg-gray-50/80 hover:bg-gray-50 border border-gray-100/80 rounded-3xl p-6 transition-colors">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-500 flex items-center justify-center shrink-0 border border-emerald-100/50">
                        <FolderUp className="w-5 h-5" />
                      </div>
                      <div className="text-gray-700 font-bold text-[15px]">
                        按文件夹批量生成
                      </div>
                    </div>
                    <div className="text-[13px] text-gray-500 leading-relaxed pl-1 pr-2">
                      点击“上传文件夹”，选择包含所需图片的父级目录。系统会自动以子文件夹的名称为维度进行分类，将组内的图片作为「参考素材」来自动切分出多条任务。
                    </div>
                  </div>

                  {/* Card 3 */}
                  <div className="bg-gray-50/80 hover:bg-gray-50 border border-gray-100/80 rounded-3xl p-6 transition-colors">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-2xl bg-blue-50 text-blue-500 flex items-center justify-center shrink-0 border border-blue-100/50">
                        <FileUp className="w-5 h-5" />
                      </div>
                      <div className="text-gray-700 font-bold text-[15px]">
                        表格智能匹配模式
                      </div>
                    </div>
                    <div className="text-[13px] text-gray-500 leading-relaxed pl-1 pr-2">
                      支持导入{" "}
                      <code className="bg-white border border-gray-100 px-1.5 py-0.5 rounded text-gray-600 font-mono text-[11px]">
                        .xlsx
                      </code>{" "}
                      文件 (需含{" "}
                      <code className="bg-white border border-gray-100 px-1.5 py-0.5 rounded text-gray-600 font-mono text-[11px]">
                        name
                      </code>{" "}
                      与{" "}
                      <code className="bg-white border border-gray-100 px-1.5 py-0.5 rounded text-gray-600 font-mono text-[11px]">
                        prompt
                      </code>
                      )。若表格中的 name
                      与本地上传子文件夹名称一致，将自动把文件图片与 Excel
                      的提示词精准匹配。
                    </div>
                  </div>

                  {/* Card 4 */}
                  <div className="bg-[#f9fafb] hover:bg-gray-50 border border-gray-100/80 rounded-3xl p-6 transition-colors relative overflow-hidden">
                    <div className="flex items-center gap-3 mb-3 relative z-10">
                      <div className="w-10 h-10 rounded-2xl bg-gray-900 shadow-sm text-[#ccff00] flex items-center justify-center shrink-0">
                        <Play className="w-5 h-5 ml-0.5" />
                      </div>
                      <div className="text-gray-700 font-bold text-[15px]">
                        执行生成与二次编辑
                      </div>
                    </div>
                    <div className="text-[13px] text-gray-500 leading-relaxed pl-1 pr-2 relative z-10">
                      在列表中检查好任务后点击右上角“开始执行”。排队及生成完全自动化。生成完成后，点击具体结果可以直接进行“二次微调修改”、打回重做或打包批量下载。
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            (() => {
              const mainFilteredTasks = tasks
                .map((t, idx) => ({ t, idx }))
                .filter(({ t }) =>
                  filterTab === "all"
                    ? true
                    : filterTab === "running"
                      ? t.status === "running" || t.status === "pending"
                      : t.status === filterTab,
                );

              // Group by groupId for UI
              const groupMap = new Map<
                string,
                { t: GeneratedTask; idx: number }[]
              >();
              mainFilteredTasks.forEach((item) => {
                const k = item.t.groupId || item.t.id;
                if (!groupMap.has(k)) groupMap.set(k, []);
                groupMap.get(k)!.push(item);
              });
              const groupings = Array.from(groupMap.values());
              const mainTotalPages = Math.ceil(groupings.length / PAGE_SIZE);
              const mainCurrentGrid = groupings.slice(
                (currentPage - 1) * PAGE_SIZE,
                currentPage * PAGE_SIZE,
              );

              return (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8 gap-4">
                    {mainCurrentGrid.map((groupItems, groupIndex) => {
                      return (
                        <GridGroupCard
                          key={groupItems[0].t.groupId || groupItems[0].t.id}
                          groupItems={groupItems}
                          isProcessing={isProcessing}
                          setCurrentReviewIndex={setCurrentReviewIndex}
                          openRetweakModal={openRetweakModal}
                        />
                      );
                    })}
                  </div>
                  {mainTotalPages > 1 && (
                    <div className="flex items-center justify-center gap-4 mt-8 pb-4">
                      <Button
                        variant="outline"
                        disabled={currentPage === 1}
                        onClick={() =>
                          setCurrentPage((p) => Math.max(1, p - 1))
                        }
                        className="rounded-full font-bold shadow-sm"
                      >
                        上一页
                      </Button>
                      <span className="text-sm font-bold text-gray-500">
                        {currentPage} / {mainTotalPages}
                      </span>
                      <Button
                        variant="outline"
                        disabled={currentPage === mainTotalPages}
                        onClick={() =>
                          setCurrentPage((p) => Math.min(mainTotalPages, p + 1))
                        }
                        className="rounded-full font-bold shadow-sm"
                      >
                        下一页
                      </Button>
                    </div>
                  )}
                </>
              );
            })()
          )}
        </div>
      </div>

      {/* Tag Collection Panel */}
      {tagPanelType && (
        <TagCollectionPanel
          type={tagPanelType}
          tasks={tasks}
          onClose={() => setTagPanelType(null)}
          onChangeStatus={(indices, newStatus) => {
            setTasks((prev) =>
              prev.map((t, i) =>
                indices.includes(i) ? { ...t, reviewStatus: newStatus } : t,
              ),
            );
          }}
          onReview={(index) => {
            setCurrentReviewIndex(index);
            setTagPanelType(null);
          }}
        />
      )}

      {/* Review Mode Overlay */}
      {renderReviewMode()}

      {/* Retweak Modal Dialog */}
      {retweakModalConfig && retweakModalConfig.isOpen && (
        <div className="fixed inset-0 z-[150] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-2xl w-full flex flex-col gap-5 animate-in fade-in zoom-in duration-200 overflow-hidden max-h-[90vh]">
            <div className="flex justify-between items-center shrink-0">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <Settings2 className="w-5 h-5" /> 二次编辑 / 重新生成
              </h3>
              <button
                onClick={() => setRetweakModalConfig(null)}
                className="text-gray-400 hover:text-gray-600 bg-gray-100 hover:bg-gray-200 p-2 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden pr-2">
              <Label className="text-sm font-bold text-gray-700 mb-2 block">
                1. 点击按序选择生成用图 (图一、图二...)
              </Label>
              <div className="flex gap-3 overflow-x-auto pb-4">
                {retweakModalConfig.availableImages.map((img, idx) => {
                  const selectedOrder =
                    retweakModalConfig.selectedIndices.indexOf(idx);
                  const isSelected = selectedOrder !== -1;
                  return (
                    <div
                      key={idx}
                      className={`relative cursor-pointer border-4 rounded-2xl overflow-hidden w-28 h-28 shrink-0 transition-all ${isSelected ? "border-[#ccff00] scale-105 shadow-md" : "border-transparent bg-gray-100 hover:opacity-80"}`}
                      onClick={() => {
                        if (isSelected) {
                          setRetweakModalConfig((prev) => ({
                            ...prev!,
                            selectedIndices: prev!.selectedIndices.filter(
                              (i) => i !== idx,
                            ),
                          }));
                        } else {
                          setRetweakModalConfig((prev) => ({
                            ...prev!,
                            selectedIndices: [...prev!.selectedIndices, idx],
                          }));
                        }
                      }}
                    >
                      <CachedThumbnail
                        url={img}
                        className="w-full h-full object-cover"
                      />
                      {isSelected && (
                        <div className="absolute top-2 right-2 bg-black text-[#ccff00] w-6 h-6 flex items-center justify-center rounded-full text-xs font-black shadow-sm">
                          {selectedOrder + 1}
                        </div>
                      )}
                      {!isSelected && (
                        <div className="absolute bottom-2 right-2 text-white bg-black/40 px-2 py-0.5 rounded-full text-[10px] font-bold">
                          可选
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="relative border-4 border-dashed border-gray-300 rounded-2xl overflow-hidden w-28 h-28 shrink-0 flex flex-col items-center justify-center hover:border-gray-400 hover:bg-gray-50 transition-all cursor-pointer">
                  <ImageIcon className="w-8 h-8 text-gray-400 mb-1" />
                  <span className="text-xs text-gray-500 font-bold">
                    本地上传
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    onChange={async (e) => {
                      if (e.target.files) {
                        const filesArr = (
                          Array.from(e.target.files) as File[]
                        ).filter((f) => f.type.startsWith("image/"));
                        if (filesArr.length > 0) {
                          const newBase64s = await Promise.all(
                            filesArr.map((f) => fileToBase64(f)),
                          );
                          setRetweakModalConfig((prev) => {
                            if (!prev) return prev;
                            const newAvailable = [
                              ...prev.availableImages,
                              ...newBase64s,
                            ];
                            const newSelectedIndices = [
                              ...prev.selectedIndices,
                            ];
                            newBase64s.forEach((_, i) => {
                              newSelectedIndices.push(
                                prev.availableImages.length + i,
                              );
                            });
                            return {
                              ...prev,
                              availableImages: newAvailable,
                              selectedIndices: newSelectedIndices,
                            };
                          });
                        }
                        e.target.value = "";
                      }
                    }}
                  />
                </div>
              </div>

              <Label className="text-sm font-bold text-gray-700 mb-2 block mt-2">
                2. 修改提示词
              </Label>
              <textarea
                className="w-full text-sm p-4 bg-gray-100 border-none rounded-[1.5rem] focus:ring-2 focus:ring-[#ccff00] resize-none h-32 text-gray-800 font-medium"
                value={retweakModalConfig.prompt}
                onChange={(e) =>
                  setRetweakModalConfig((prev) => ({
                    ...prev!,
                    prompt: e.target.value,
                  }))
                }
                placeholder="输入想要调整的提示词..."
              />
            </div>

            <div className="flex gap-3 mt-2 shrink-0">
              <Button
                variant="ghost"
                className="flex-1 rounded-full h-12 font-bold text-gray-600 bg-gray-100 hover:bg-gray-200"
                onClick={() => setRetweakModalConfig(null)}
              >
                取消
              </Button>
              <Button
                className="flex-1 rounded-full h-12 font-bold bg-[#ccff00] text-black hover:bg-[#b8e600] text-base"
                onClick={() => {
                  const {
                    taskIndex,
                    availableImages,
                    selectedIndices,
                    prompt,
                  } = retweakModalConfig;
                  const sourceTask = tasksRef.current[taskIndex];
                  const selectedUrls = selectedIndices.map(
                    (idx) => availableImages[idx],
                  );

                  let newFixedImage = undefined;
                  let newReferenceImages: string[] = [];

                  if (selectedUrls.length > 0) {
                    newFixedImage = selectedUrls[0];
                    newReferenceImages = selectedUrls.slice(1);
                  }

                  const newTask: GeneratedTask = {
                    ...sourceTask,
                    id: `retweak-${Date.now()}`,
                    prompt,
                    fixedImage: newFixedImage,
                    referenceImage: newReferenceImages[0],
                    referenceImages: newReferenceImages,
                    referenceFiles: undefined,
                    status: "pending",
                    errorMsg: undefined,
                    progressMsg: undefined,
                    resultUrl: undefined,
                    reviewStatus: "none",
                    retryCount: 0,
                    uploadedFixedImage: undefined,
                    uploadedReferenceImages: undefined,
                  };

                  const nextTasks = [...tasksRef.current, newTask];
                  setTasks(nextTasks);
                  tasksRef.current = nextTasks;
                  setRetweakModalConfig(null);
                  setCurrentReviewIndex(null); // Close review if open
                }}
              >
                新建子任务
              </Button>
            </div>
          </div>
        </div>
      )}

      {dialogConfig.isOpen && (
        <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl flex flex-col gap-4 animate-in fade-in zoom-in duration-200">
            <h3 className="text-lg font-bold text-gray-900">
              {dialogConfig.title}
            </h3>
            <div className="text-sm text-gray-600 whitespace-pre-wrap">
              {Array.isArray(dialogConfig.message)
                ? dialogConfig.message.map((l, i) => (
                    <p key={i} className="min-h-[1em]">
                      {l}
                    </p>
                  ))
                : dialogConfig.message}
            </div>
            <div className="flex justify-end gap-3 mt-2">
              {(dialogConfig.type === "confirm" || dialogConfig.onCancel) && (
                <Button
                  variant="ghost"
                  onClick={
                    dialogConfig.onCancel ||
                    (() =>
                      setDialogConfig((prev) => ({ ...prev, isOpen: false })))
                  }
                >
                  取消
                </Button>
              )}
              <Button
                className={
                  dialogConfig.type === "confirm"
                    ? "bg-[#ccff00] text-black hover:bg-[#b8e600]"
                    : ""
                }
                onClick={
                  dialogConfig.type === "confirm"
                    ? dialogConfig.onConfirm
                    : dialogConfig.onCancel ||
                      (() =>
                        setDialogConfig((prev) => ({ ...prev, isOpen: false })))
                }
              >
                确定
              </Button>
            </div>
          </div>
        </div>
      )}

      <SettingsPanel
        isOpen={isAuditSettingsOpen}
        onClose={() => setIsAuditSettingsOpen(false)}
        accessKey={accessKey}
        setAccessKey={setAccessKey}
        secretKey={secretKey}
        setSecretKey={setSecretKey}
        useExecutionPrefix={useExecutionPrefix}
        setUseExecutionPrefix={setUseExecutionPrefix}
        bypassProxy={bypassProxy}
        setBypassProxy={setBypassProxy}
        auditBaseUrl={auditBaseUrl}
        setAuditBaseUrl={setAuditBaseUrl}
        auditModel={auditModel}
        setAuditModel={setAuditModel}
        auditApiKey={auditApiKey}
        setAuditApiKey={setAuditApiKey}
      />

      {/* Full Screen Image Lightbox */}
      {fullscreenImage && (
        <div
          className="fixed inset-0 z-[300] bg-black/90 flex items-center justify-center p-4"
          onClick={() => closeFullscreen()}
        >
          <CachedThumbnail
            url={fullscreenImage.url}
            className="max-w-full max-h-full object-contain shadow-2xl"
          />
          <button
            className="absolute top-4 right-4 text-white bg-black/50 p-2 rounded-full hover:bg-black/80 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              closeFullscreen();
            }}
          >
            <X className="w-6 h-6" />
          </button>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/70 text-sm">
            点击背景或按 ESC 返回
          </div>
        </div>
      )}

      {/* Reference Collection Detail Modal */}
      {isRefCollectionModalOpen && (
        <div
          className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4"
          onClick={() => setIsRefCollectionModalOpen(false)}
        >
          <div
            className="bg-white rounded-3xl p-6 max-w-2xl w-full max-h-[80vh] shadow-2xl flex flex-col gap-4 animate-in fade-in zoom-in duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <ImageIcon className="w-5 h-5 text-gray-700" />{" "}
                  已上传的参考图集
                </h3>
                <p className="text-xs text-[#a3a3a3] mt-0.5">
                  共 {refCollectionFiles.length}{" "}
                  张参考图，将根据文件名/提示词自动与表格对应的行进行匹配
                </p>
              </div>
              <Button
                variant="ghost"
                onClick={() => setIsRefCollectionModalOpen(false)}
                className="rounded-full hover:bg-gray-100 p-2 h-9 w-9 flex items-center justify-center"
              >
                <X className="w-5 h-5 text-gray-500" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto pr-1">
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 p-1">
                {refCollectionFiles.map((file, i) => {
                  const preview = refCollectionPreviews[i];
                  return (
                    <div
                      key={i}
                      className="flex flex-col items-center p-2 rounded-2xl bg-gray-55 border border-gray-100 hover:border-gray-200 hover:bg-gray-100/50 transition-all select-none"
                    >
                      <div
                        className="aspect-square w-full rounded-xl overflow-hidden bg-white relative shadow-sm cursor-pointer hover:opacity-90 group"
                        onClick={() => openFullscreen(preview, file)}
                      >
                        <img
                          src={preview}
                          className="w-full h-full object-cover"
                          alt={file.name}
                        />
                        <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <span className="text-[10px] bg-black/80 text-white font-bold px-2 py-0.5 rounded-full">
                            查看大图
                          </span>
                        </div>
                      </div>
                      <span
                        className="text-[10px] text-gray-600 font-bold mt-1.5 truncate w-full text-center px-1"
                        title={file.name}
                      >
                        {file.name}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-100 shrink-0">
              <Button
                variant="outline"
                className="text-xs font-bold rounded-xl h-9 hover:bg-red-50 hover:text-red-500 hover:border-red-100"
                onClick={(e) => {
                  handleClearRefCollection(e);
                  setIsRefCollectionModalOpen(false);
                }}
              >
                清空图集
              </Button>
              <Button
                className="bg-[#ccff00] hover:bg-[#b8e600] text-black font-bold rounded-xl h-9 px-5"
                onClick={() => setIsRefCollectionModalOpen(false)}
              >
                确定
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
