import { Hono } from "hono";
import { getStore } from "@netlify/blobs";
import { desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { uploads } from "../../db/schema.js";

export const config = { path: "/api/*" };

const app = new Hono();
const audioStore = getStore("audio-uploads");

const AUDIUS_API = "https://api.audius.co/v1";
const APP_NAME = "SoundWave";
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const AUDIO_EXTENSIONS: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  webm: "audio/webm",
};

type Track = {
  id: string;
  source: "audius" | "itunes" | "upload";
  title: string;
  artist: string;
  artwork: string | null;
  duration: number | null;
  url: string;
  preview: boolean;
};

async function fetchJSON(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Upstream ${res.status}`);
  return res.json();
}

function fromAudius(t: any): Track | null {
  if (!t || t.is_streamable === false || t.access?.stream === false) return null;
  return {
    id: `audius:${t.id}`,
    source: "audius",
    title: t.title,
    artist: t.user?.name ?? "Unknown artist",
    artwork: t.artwork?.["480x480"] ?? t.artwork?.["150x150"] ?? null,
    duration: t.duration ?? null,
    url: `/api/audius/${encodeURIComponent(t.id)}/stream`,
    preview: false,
  };
}

function fromItunes(t: any): Track | null {
  if (!t?.previewUrl) return null;
  return {
    id: `itunes:${t.trackId}`,
    source: "itunes",
    title: t.trackName,
    artist: t.artistName,
    artwork: t.artworkUrl100 ? t.artworkUrl100.replace("100x100bb", "300x300bb") : null,
    duration: 30,
    url: t.previewUrl,
    preview: true,
  };
}

async function searchAudius(q: string): Promise<Track[]> {
  const data = await fetchJSON(
    `${AUDIUS_API}/tracks/search?query=${encodeURIComponent(q)}&app_name=${APP_NAME}&limit=20`,
  );
  return (data.data ?? []).map(fromAudius).filter(Boolean) as Track[];
}

async function searchItunes(q: string): Promise<Track[]> {
  const data = await fetchJSON(
    `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=20`,
  );
  return (data.results ?? []).map(fromItunes).filter(Boolean) as Track[];
}

function toUploadTrack(row: typeof uploads.$inferSelect): Track {
  return {
    id: `upload:${row.id}`,
    source: "upload",
    title: row.title,
    artist: row.artist,
    artwork: null,
    duration: null,
    url: `/api/uploads/${row.id}/audio`,
    preview: false,
  };
}

// ---- Online catalogs ----

app.get("/api/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 100);
  if (!q) return c.json({ audius: [], itunes: [] });
  const [audius, itunes] = await Promise.allSettled([searchAudius(q), searchItunes(q)]);
  return c.json({
    audius: audius.status === "fulfilled" ? audius.value : [],
    itunes: itunes.status === "fulfilled" ? itunes.value : [],
    errors: [
      ...(audius.status === "rejected" ? ["audius"] : []),
      ...(itunes.status === "rejected" ? ["itunes"] : []),
    ],
  });
});

app.get("/api/trending", async (c) => {
  try {
    const data = await fetchJSON(`${AUDIUS_API}/tracks/trending?app_name=${APP_NAME}&limit=24`);
    const tracks = (data.data ?? []).map(fromAudius).filter(Boolean);
    c.header("Cache-Control", "public, max-age=600");
    return c.json({ tracks });
  } catch {
    return c.json({ tracks: [], error: "Trending tracks are unavailable right now." }, 502);
  }
});

// Audius stream links are signed and expire, so look up a fresh one at play time.
app.get("/api/audius/:id/stream", async (c) => {
  const id = c.req.param("id");
  if (!/^[A-Za-z0-9]{1,32}$/.test(id)) return c.json({ error: "Invalid track id" }, 400);
  try {
    const data = await fetchJSON(`${AUDIUS_API}/tracks/${id}?app_name=${APP_NAME}`);
    const url = data.data?.stream?.url;
    if (!url) return c.json({ error: "Track is not streamable" }, 404);
    c.header("Cache-Control", "no-store");
    return c.redirect(url, 302);
  } catch {
    return c.json({ error: "Could not reach Audius" }, 502);
  }
});

// ---- Uploaded music ----

app.get("/api/uploads", async (c) => {
  const rows = await db.select().from(uploads).orderBy(desc(uploads.createdAt));
  return c.json({ tracks: rows.map(toUploadTrack) });
});

app.post("/api/uploads", async (c) => {
  const declared = Number(c.req.header("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) {
    return c.json({ error: "File is too large (max 20 MB)." }, 413);
  }

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: "Expected a multipart form upload." }, 400);
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return c.json({ error: "Choose an audio file to upload." }, 400);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return c.json({ error: "File is too large (max 20 MB)." }, 413);
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const contentType = file.type.startsWith("audio/") ? file.type : AUDIO_EXTENSIONS[ext];
  if (!contentType) {
    return c.json({ error: "That doesn't look like an audio file (try MP3, M4A, WAV, OGG or FLAC)." }, 415);
  }

  const fallbackTitle = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Untitled";
  const title = String(form.get("title") ?? "").trim().slice(0, 200) || fallbackTitle;
  const artist = String(form.get("artist") ?? "").trim().slice(0, 200) || "Unknown artist";

  const blobKey = crypto.randomUUID();
  await audioStore.set(blobKey, await file.arrayBuffer());

  try {
    const [row] = await db
      .insert(uploads)
      .values({ title, artist, blobKey, contentType, sizeBytes: file.size })
      .returning();
    return c.json({ track: toUploadTrack(row) }, 201);
  } catch (err) {
    await audioStore.delete(blobKey);
    throw err;
  }
});

app.get("/api/uploads/:id/audio", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "Invalid id" }, 400);
  const [row] = await db.select().from(uploads).where(eq(uploads.id, id));
  if (!row) return c.json({ error: "Not found" }, 404);

  const data = await audioStore.get(row.blobKey, { type: "arrayBuffer" });
  if (!data) return c.json({ error: "Audio file missing" }, 404);

  const total = data.byteLength;
  const headers: Record<string, string> = {
    "Content-Type": row.contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
  };

  // Range support lets the browser seek and report duration for uploaded tracks.
  const range = c.req.header("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    let start: number;
    let end: number;
    if (range[1]) {
      start = Number(range[1]);
      end = range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
    } else {
      start = Math.max(total - Number(range[2]), 0);
      end = total - 1;
    }
    if (start >= total || start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
    }
    return new Response(data.slice(start, end + 1), {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }

  return new Response(data, { headers: { ...headers, "Content-Length": String(total) } });
});

app.delete("/api/uploads/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "Invalid id" }, 400);
  const [row] = await db.delete(uploads).where(eq(uploads.id, id)).returning();
  if (!row) return c.json({ error: "Not found" }, 404);
  await audioStore.delete(row.blobKey);
  return c.json({ ok: true });
});

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Something went wrong" }, 500);
});

export default app;
