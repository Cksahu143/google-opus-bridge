# login-service/Dockerfile
#
# UNTESTED — written for review. Builds a container with everything
# needed for the free, self-hosted NotebookLM login flow: a virtual
# display, Chromium, x11vnc, websockify+noVNC, and the Node service itself.
#
# Build:  docker build -t nblm-login-service ./login-service
# Run:    docker run -p 8787:8787 -p 6080:6080 \
#           -e SUPABASE_URL=... \
#           -e SUPABASE_SERVICE_ROLE_KEY=... \
#           -e LOGIN_SERVICE_SHARED_SECRET=... \
#           -e PUBLIC_HOST=<your-server-public-ip-or-domain> \
#           nblm-login-service
#
# PUBLIC_HOST must be reachable from the iPad — not "localhost". If this
# runs on a VPS, use the VPS's public IP or a domain pointed at it. Port
# 6080 (noVNC) must also be reachable from the iPad, not just 8787.

FROM node:20-bookworm

# CONFIRM package names against current Debian bookworm repos before
# building — chromium package naming occasionally shifts between
# distros/releases.
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    xvfb \
    x11vnc \
    novnc \
    websockify \
    fonts-liberation \
    dbus-x11 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

# Some Debian noVNC packages install to /usr/share/novnc, others differ —
# CONFIRM this path after `apt-get install novnc` by checking
# `dpkg -L novnc | grep vnc_lite.html` inside the built image, and update
# the --web= path in server.js if it differs.

EXPOSE 8787 6080

CMD ["node", "server.js"]
