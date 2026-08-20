// capacitor.config.ts
//
// SUPERSEDED / NOT IN USE.
//
// This file was an earlier proposal to wrap the whole app as a native iPad
// app. That is NOT what's being built — the actual requirement is just
// making NotebookLM login work when the existing web app is opened on an
// iPad's Safari, which is solved instead by /notebooks/connect.tsx +
// login-service (Browserbase-based remote-browser login, embedded via a
// plain <iframe>). No native wrapper, no App Store, no Xcode build needed.
//
// Left in place only for reference/history — safe to delete this file.
// The @capacitor/* packages referenced below were never installed and
// should not be added.

import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.charukrishna.googleopusbridge",
  appName: "Google Opus Bridge",
  webDir: "dist",
  server: {
    url: "https://google-opus-bridge.lovable.app",
    cleartext: false,
  },
};

export default config;
