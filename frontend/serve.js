// ============================================================
// Zero-dependency static file server for the CCMS frontend.
// Node is already installed for the backend, so no npm install
// is needed. Run:   node serve.js   (defaults to port 5173)
//   PORT=8080 node serve.js   to change the port.
// ============================================================
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = process.env.PORT || 5173;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".map": "application/json",
};

// Security headers applied to EVERY response. A production web server /
// reverse proxy (Nginx, CloudFront, etc.) should send the equivalent.
//   • CSP mirrors the <meta> in index.html and adds frame-ancestors
//     (which is ignored inside <meta>) to block clickjacking.
//   • X-Frame-Options is the legacy fallback for older browsers.
//   • X-Content-Type-Options stops MIME sniffing.
//   • Referrer-Policy keeps the API host out of the Referer header.
const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; font-src 'self'; connect-src 'self' http://localhost:* https:; " +
    "base-uri 'self'; form-action 'self'; object-src 'none'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function sendHead(res, status, extra) {
  res.writeHead(status, Object.assign({}, SECURITY_HEADERS, extra || {}));
}

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";

  // Prevent path traversal.
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    sendHead(res, 403); return res.end("Forbidden");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback: unknown non-file routes → index.html
      if (!path.extname(filePath)) {
        return fs.readFile(path.join(ROOT, "index.html"), (e2, html) => {
          if (e2) { sendHead(res, 404); return res.end("Not found"); }
          sendHead(res, 200, { "Content-Type": MIME[".html"] });
          res.end(html);
        });
      }
      sendHead(res, 404); return res.end("Not found: " + urlPath);
    }
    const ext = path.extname(filePath).toLowerCase();
    sendHead(res, 200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log("\n  CCMS frontend running:  http://localhost:" + PORT);
  console.log("  Make sure the backend is up (npm start in the project root).\n");
});
