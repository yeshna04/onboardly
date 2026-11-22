import { Download, ExternalLink, FileText, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { fileSize } from "../lib/format";
import { Button, Modal } from "./ui";

export interface PreviewFile { url: string; name: string; mime: string | null; size?: number | null; subtitle?: string }

const kindOf = (f: PreviewFile) => {
  const mime = (f.mime ?? "").toLowerCase(), name = f.name.toLowerCase();
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/.test(name)) return "image";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (mime.startsWith("text/") || mime.includes("json") || /\.(txt|csv|json|md)$/.test(name)) return "text";
  return "other";
};

/** In-app viewer for an uploaded document: PDFs, images and text show inline; anything else offers a download. */
export function FilePreviewModal({ file, onClose }: { file: PreviewFile | null; onClose: () => void }) {
  const kind = file ? kindOf(file) : "other";
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setText(null); setFailed(false); setLoaded(false);
    if (!file || kind !== "text") return;
    fetch(file.url, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((t) => { setText(t.length > 200_000 ? t.slice(0, 200_000) + "\n…" : t); setLoaded(true); })
      .catch(() => setFailed(true));
  }, [file, kind]);

  return (
    <Modal open={!!file} onClose={onClose} size="xl" title={file?.name ?? ""}
      description={file && [file.subtitle, file.size ? fileSize(file.size) : null].filter(Boolean).join(" · ")}
      footer={file && <>
        <a href={file.url} target="_blank" rel="noreferrer"><Button variant="ghost" icon={<ExternalLink className="h-4 w-4" />}>Open in new tab</Button></a>
        <a href={file.url} download={file.name}><Button icon={<Download className="h-4 w-4" />}>Download</Button></a>
      </>}>
      {file && (
        <div className="relative flex min-h-[320px] items-center justify-center overflow-hidden rounded-xl border border-stone-200 bg-stone-50 dark:border-white/10 dark:bg-black/30">
          {!loaded && !failed && kind !== "other" && <Loader2 className="absolute h-6 w-6 animate-spin text-brand-500" />}
          {failed ? (
            <Fallback text="We couldn't load a preview of this file. You can still download it." />
          ) : kind === "image" ? (
            <img src={file.url} alt={file.name} onLoad={() => setLoaded(true)} onError={() => setFailed(true)}
              className="max-h-[65vh] w-auto max-w-full object-contain" />
          ) : kind === "pdf" ? (
            <iframe src={file.url} title={file.name} onLoad={() => setLoaded(true)} className="h-[65vh] w-full bg-white" />
          ) : kind === "text" ? (
            text !== null && <pre className="max-h-[65vh] w-full overflow-auto whitespace-pre-wrap p-4 text-xs leading-5 text-stone-800 dark:text-stone-200">{text}</pre>
          ) : (
            <Fallback text="There's no preview for this type of file. Download it to open it on your device." />
          )}
        </div>
      )}
    </Modal>
  );
}

function Fallback({ text }: { text: string }) {
  return <div className="flex flex-col items-center gap-2 p-8 text-center text-sm"><FileText className="h-8 w-8 text-stone-400" /><p className="muted max-w-sm">{text}</p></div>;
}
