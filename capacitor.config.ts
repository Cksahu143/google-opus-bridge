import type { CapacitorConfig } from "@capacitor/cli";

// UNTESTED — written for review before running `npx cap add ios`.
//
// IMPORTANT: this project is TanStack Start (SSR via Nitro), not a plain
// static SPA (see package.json: @tanstack/react-start, nitro). Capacitor
// cannot reliably bundle server-rendered output for fully offline use.
// This config instead points the native shell at the DEPLOYED site via
// `server.url`, so the iPad app is a real installed app wrapping the live
// site — same approach Twitter/Instagram-style hybrid apps use, and the
// most reliable option for an SSR framework. It requires network
// connectivity to work (no offline mode) unless a separate static-export
// path is built later.
//
// Replace `server.url` with your actual production domain before building.
const config: CapacitorConfig = {
  appId: "com.charukrishna.googleopusbridge",
  appName: "Google Opus Bridge",
  webDir: "dist", // only used as a fallback shell; real content loads from server.url
  server: {
    // CONFIRM this is the correct production URL before building.
    url: "https://google-opus-bridge.lovable.app",
    cleartext: false,
  },
  ios: {
    contentInset: "automatic",
    // iPad-specific: allow both orientations, and don't force a phone-sized
    // status bar layout. Fine-tune in Xcode's General > Deployment Info
    // after `npx cap open ios` — set "Devices" to iPad (or Universal) and
    // enable both landscape orientations there, since some of these
    // settings aren't fully controllable from capacitor.config alone.
  },
};

export default config;
