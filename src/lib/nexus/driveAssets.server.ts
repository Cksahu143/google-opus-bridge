import type { AdapterContext } from "./types";

const UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink,mimeType,size";

export interface SavedAsset {
  driveFileId: string;
  name: string;
  mimeType: string;
  webViewLink: string | null;
  webContentLink: string | null;
  bytes: number;
}

/**
 * Uploads generated media into the user's Drive so Claude gets a durable,
 * shareable reference instead of megabytes of base64 in a tool response.
 */
export async function saveBinaryToDrive(
  ctx: AdapterContext,
  params: { name: string; mimeType: string; data: Uint8Array; folderId?: string | undefined },
): Promise<SavedAsset> {
  const boundary = `nexus-${Math.random().toString(36).slice(2)}`;
  const metadata = JSON.stringify({
    name: params.name,
    mimeType: params.mimeType,
    ...(params.folderId ? { parents: [params.folderId] } : {}),
  });

  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${params.mimeType}\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + params.data.length + tail.length);
  body.set(head, 0);
  body.set(params.data, head.length);
  body.set(tail, head.length + params.data.length);

  const response = await ctx.raw(UPLOAD_URL, {
    method: "POST",
    headers: { "content-type": `multipart/related; boundary=${boundary}` },
    body: body as unknown as BodyInit,
  });
  if (!response.ok) {
    throw new Error(`Drive upload failed (${response.status}): ${await response.text()}`);
  }
  const file = (await response.json()) as {
    id: string;
    name: string;
    mimeType: string;
    webViewLink?: string;
    webContentLink?: string;
  };
  return {
    driveFileId: file.id,
    name: file.name,
    mimeType: file.mimeType,
    webViewLink: file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`,
    webContentLink: file.webContentLink ?? null,
    bytes: params.data.length,
  };
}

export function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(base64, "base64"));
}

export async function ensureNexusFolder(
  ctx: AdapterContext,
  name: string,
  parentId?: string,
): Promise<string> {
  const escaped = name.replace(/'/g, "\\'");
  const parentClause = parentId ? ` and '${parentId}' in parents` : "";
  const query = `mimeType='application/vnd.google-apps.folder' and name='${escaped}' and trashed=false${parentClause}`;
  const found = await ctx.api<{ files?: { id: string }[] }>(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id)&pageSize=1`,
  );
  const existing = found.files?.[0]?.id;
  if (existing) return existing;
  const created = await ctx.api<{ id: string }>(
    "https://www.googleapis.com/drive/v3/files?fields=id",
    {
      body: {
        name,
        mimeType: "application/vnd.google-apps.folder",
        ...(parentId ? { parents: [parentId] } : {}),
      },
    },
  );
  return created.id;
}

/** Reads a Drive file's bytes (used for reference images / edits). */
export async function readDriveBinary(
  ctx: AdapterContext,
  fileId: string,
): Promise<{ mimeType: string; base64: string }> {
  const meta = await ctx.api<{ mimeType: string }>(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=mimeType`,
  );
  const response = await ctx.raw(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
  );
  if (!response.ok) throw new Error(`Drive download failed (${response.status})`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return { mimeType: meta.mimeType, base64: buffer.toString("base64") };
}