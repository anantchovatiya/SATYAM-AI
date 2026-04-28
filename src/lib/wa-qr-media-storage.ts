import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WaMessage } from "@/lib/models/webhook-log";

/** Writable media root for QR-downloaded files (same host rules as QR auth). */
export function qrMediaRootDir(): string | null {
  const disabled = process.env.WA_DISABLE_QR === "1" || process.env.WA_DISABLE_QR === "true";
  if (disabled) return null;
  if (process.env.VERCEL === "1") return null;
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) return null;
  if (process.env.NETLIFY === "true") return null;
  const override = process.env.WA_MEDIA_DIR?.trim();
  if (override) return path.resolve(override);
  return path.join(process.cwd(), ".wa-media");
}

function extFromMime(mime: string): string {
  const base = mime.toLowerCase().split(";")[0]?.trim() ?? "";
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "audio/ogg": ".ogg",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "application/pdf": ".pdf",
  };
  return map[base] ?? ".bin";
}

function safeFileBase(id: string): string {
  const t = id.replace(/[^a-zA-Z0-9._-]/g, "_");
  return t.slice(0, 180) || "msg";
}

export async function saveQrDownloadedMedia(args: {
  userIdHex: string;
  waMessageId: string;
  buffer: Buffer;
  mimeType: string;
}): Promise<{ qrMediaRelPath: string } | null> {
  const root = qrMediaRootDir();
  if (!root) return null;
  const ext = extFromMime(args.mimeType);
  const baseName = safeFileBase(args.waMessageId);
  const userDir = path.join(root, args.userIdHex);
  await mkdir(userDir, { recursive: true });
  const fileName = `${baseName}${ext}`;
  await writeFile(path.join(userDir, fileName), args.buffer);
  return { qrMediaRelPath: path.posix.join(args.userIdHex, fileName) };
}

/** Resolve stored relative path to absolute file; enforces tenant + no traversal. */
export function resolveQrMediaAbsolutePath(
  qrMediaRelPath: string,
  expectedUserIdHex: string
): string | null {
  const root = qrMediaRootDir();
  if (!root || !qrMediaRelPath) return null;
  const norm = qrMediaRelPath.replace(/\\/g, "/").trim();
  const parts = norm.split("/").filter(Boolean);
  if (parts.length !== 2) return null;
  const [hex, file] = parts;
  if (hex !== expectedUserIdHex) return null;
  if (!file || file === "." || file === ".." || file.includes("..")) return null;
  const userFolder = path.resolve(path.join(root, hex));
  const abs = path.resolve(path.join(userFolder, file));
  if (!abs.startsWith(userFolder + path.sep)) return null;
  return abs;
}

export function detectBaileysMediaKind(message: unknown): {
  kind: NonNullable<WaMessage["mediaKind"]>;
  mime: string;
} | null {
  const m = message as {
    imageMessage?: { mimetype?: string | null };
    videoMessage?: { mimetype?: string | null };
    audioMessage?: { mimetype?: string | null };
    documentMessage?: { mimetype?: string | null };
    stickerMessage?: { mimetype?: string | null };
  };
  const im = m.imageMessage?.mimetype?.trim();
  if (im) return { kind: "image", mime: im };
  const vm = m.videoMessage?.mimetype?.trim();
  if (vm) return { kind: "video", mime: vm };
  const am = m.audioMessage?.mimetype?.trim();
  if (am) return { kind: "audio", mime: am };
  const dm = m.documentMessage?.mimetype?.trim();
  if (dm) return { kind: "document", mime: dm };
  const sm = m.stickerMessage?.mimetype?.trim();
  if (sm) return { kind: "sticker", mime: sm };
  return null;
}
