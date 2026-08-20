# login-service/Dockerfile
#
# PARTIALLY VERIFIED (see notes below) — written for review. Builds a
# container with everything needed for the free, self-hosted NotebookLM
# login flow: a virtual display, Chromium, x11vnc, websockify+noVNC, and
# the Node service itself.
#
# WHAT'S ACTUALLY BEEN TESTED (in a real Ubuntu 24.04 sandbox, not this
# Debian image directly — Docker wasn't available to build this exact
# image, so treat the two verified lines below as high-confidence, not
# 100% proven on this specific base):
#   - novnc, websockify, x11vnc, xvfb all installed cleanly via apt on
#     Ubuntu 24.04 with these exact package names.
#   - CONFIRMED: /usr/share/novnc/vnc_lite.html is the real installed path
#     — matches what server.js expects. No fix needed there.
#   - FOUND A REAL BUG (Ubuntu-specific, not yet proven on Debian): on
#     Ubuntu, `apt-get install chromium` installs a broken stub that
#     requires snapd and refuses to run — NOT a working browser. Debian
#     (this image's actual base) has historically shipped a real chromium
#     package rather than Ubuntu's snap-redirect, but I could not verify
#     that directly (no Debian package archive access from my sandbox, no
#     Docker-in-Docker to build this image and check). The RUN command
#     below now fails the build loudly if this turns out to be wrong,
#     instead of silently shipping a broken container.
#
# Build:  docker build -t nblm-login-service ./login-service
# Run:    docker run -p 8787:8787 -p 6080:6080 \
#           -e SUPABASE_URL=... \
#           -e SUPABASE_SERVICE_ROLE_KEY=... \
#           -e LOGIN_SERVICE_SHARED_SECRET=... \
#           -e PUBLIC_HOST=<your-server-public-ip-or-domain> \
#           nblm-login-service
#
# PUBLIC_HOST must be reachable from the iPad — not "localhost". Port 6080
# (noVNC) must also be reachable, not just 8787.

FROM node:20-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    xvfb \
    x11vnc \
    novnc \
    websockify \
    fonts-liberation \
    dbus-x11 \
    && rm -rf /var/lib/apt/lists/* \
    # Fail the BUILD (not silently at runtime on your iPad) if chromium
    # turns out to be a non-functional stub on this base image — this is
    # the exact bug found on Ubuntu; this check catches it here if Debian
    # bookworm ever ships something similar.
    && chromium --version

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

# CONFIRMED (tested on Ubuntu 24.04, expected to match on Debian too since
# it's the same upstream noVNC .deb packaging): novnc installs to
# /usr/share/novnc/vnc_lite.html — matches server.js's --web= path.

EXPOSE 8787 6080

CMD ["node", "server.js"]
