import { z } from "zod";

import { SCOPES } from "@/lib/nexus/scopes";
import { defineAdapter, defineCapability } from "@/lib/nexus/types";

const BASE = "https://www.googleapis.com/youtube/v3";

/**
 * YouTube Data API v3 — a real, documented, OAuth-based API (not gated behind
 * an allowlist like Lyria). Works with the same Google account connection as
 * every other adapter here; only needs the youtube.readonly scope for these
 * read-oriented capabilities.
 * https://developers.google.com/youtube/v3/docs
 */
export const youtubeAdapter = defineAdapter({
  service: "youtube",
  label: "YouTube",
  description:
    "Search YouTube and read the connected account's own channel, uploads and playlists.",
  status: "supported",
  statusNote: "Official YouTube Data API v3, read-only scope.",
  docsUrl: "https://developers.google.com/youtube/v3/docs",
  healthCheck: async (ctx) => {
    await ctx.api(`${BASE}/channels?part=id&mine=true`);
    return { ok: true, detail: "YouTube Data API reachable" };
  },
  capabilities: [
    defineCapability({
      id: "youtube.search",
      title: "Search YouTube",
      description: "Search public YouTube videos, channels, or playlists by keyword.",
      implementation: "google-rest-api",
      scopes: [SCOPES.youtubeReadonly],
      input: z.object({
        query: z.string().min(1),
        type: z.enum(["video", "channel", "playlist"]).default("video"),
        maxResults: z.number().int().min(1).max(25).default(10),
      }),
      run: (ctx, input) =>
        ctx.api(
          `${BASE}/search?part=snippet&type=${input.type}&maxResults=${input.maxResults}&q=${encodeURIComponent(
            input.query,
          )}`,
        ),
    }),
    defineCapability({
      id: "youtube.my_channel",
      title: "Get my channel",
      description: "Read the connected account's own channel details and statistics.",
      implementation: "google-rest-api",
      scopes: [SCOPES.youtubeReadonly],
      input: z.object({}),
      run: (ctx) => ctx.api(`${BASE}/channels?part=snippet,statistics,contentDetails&mine=true`),
    }),
    defineCapability({
      id: "youtube.list_playlist_items",
      title: "List playlist items",
      description:
        "List videos in a playlist (use the channel's 'uploads' playlist id from youtube.my_channel to list your own uploads).",
      implementation: "google-rest-api",
      scopes: [SCOPES.youtubeReadonly],
      input: z.object({
        playlistId: z.string().min(1),
        maxResults: z.number().int().min(1).max(50).default(25),
      }),
      run: (ctx, input) =>
        ctx.api(
          `${BASE}/playlistItems?part=snippet,contentDetails&maxResults=${input.maxResults}&playlistId=${encodeURIComponent(
            input.playlistId,
          )}`,
        ),
    }),
    defineCapability({
      id: "youtube.video_details",
      title: "Get video details",
      description: "Read a video's snippet, statistics (views/likes/comments) and duration.",
      implementation: "google-rest-api",
      scopes: [SCOPES.youtubeReadonly],
      input: z.object({ videoId: z.string().min(1) }),
      run: (ctx, input) =>
        ctx.api(
          `${BASE}/videos?part=snippet,statistics,contentDetails&id=${encodeURIComponent(input.videoId)}`,
        ),
    }),
  ],
});

export default youtubeAdapter;
