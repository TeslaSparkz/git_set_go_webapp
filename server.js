// Git, Set, Go! backend. Node 18+, no dependencies. Data lives in Upstash Redis (REST API).
// Required env: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN. Optional: GITHUB_TOKEN, PORT.
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
// Load .env from this folder if present (real environment variables, e.g. on Render, take priority).
try {
  for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith("#") && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
} catch {}
const PORT = process.env.PORT || 3000, GH_TOKEN = process.env.GITHUB_TOKEN;
const R_URL = (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/+$/, ""), R_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!R_URL || !R_TOKEN) { console.error("Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN."); process.exit(1); }

/* ---------- Upstash Redis (REST) ----------
   Keys: token:<t> -> player JSON | player:<id> -> player JSON | name:<lowercase> -> id (unique names)
         claim:<owner/repo> -> {playerId, points} | stats:<id> hash {repos} | lb sorted set (id -> points) */
async function call(url, body) {
  let r, j;
  try {
    r = await fetch(url, { method: "POST", headers: { Authorization: "Bearer " + R_TOKEN }, body: JSON.stringify(body) });
    j = await r.json();
  } catch { throw Object.assign(new Error("Database unavailable. Try again."), { status: 503 }); }
  if (!r.ok) throw Object.assign(new Error("Database error."), { status: 503 });
  return j;
}
async function redis(...cmd) {
  const j = await call(R_URL, cmd.map(String));
  if (j.error) throw Object.assign(new Error("Database error."), { status: 503 });
  return j.result;
}
async function pipe(cmds) {
  const j = await call(R_URL + "/pipeline", cmds.map(c => c.map(String)));
  return j.map(x => { if (x.error) throw Object.assign(new Error("Database error."), { status: 503 }); return x.result; });
}

/* ---------- GitHub ---------- */
async function gh(p) {
  const r = await fetch("https://api.github.com" + p, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "git-set-go", ...(GH_TOKEN ? { Authorization: "Bearer " + GH_TOKEN } : {}) }
  });
  if ((r.status === 403 || r.status === 429) && r.headers.get("x-ratelimit-remaining") === "0")
    throw Object.assign(new Error("GitHub rate limit reached. Try again in a minute."), { status: 503 });
  return r;
}
const search = async q => { const r = await gh("/search/issues?per_page=1&q=" + encodeURIComponent(q)); return r.ok ? (await r.json()).total_count : 0; };
async function count(p) {
  const r = await gh(p + "?per_page=1"); if (!r.ok) return 0;
  const m = (r.headers.get("link") || "").match(/[?&]page=(\d+)>; rel="last"/);
  return m ? +m[1] : (await r.json()).length;
}
const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");

async function inspect(owner, name, handle) {
  const r = await gh(`/repos/${owner}/${name}`);
  if (r.status === 404) return null;
  if (!r.ok) throw Object.assign(new Error("GitHub returned " + r.status), { status: 502 });
  const info = await r.json(), s = `repo:${owner}/${name}`, b = `/repos/${owner}/${name}`;
  const [prs, merged, issues, commits, branches, runs, mine] = await Promise.all([
    search(`${s} is:pr`), search(`${s} is:pr is:merged`), search(`${s} is:issue`),
    count(b + "/commits"), count(b + "/branches"),
    gh(b + "/actions/runs?per_page=1").then(x => x.ok ? x.json().then(j => j.total_count) : 0),
    handle ? search(`${s} is:pr author:${handle}`) : 0
  ]);
  return { info, prs, merged, issues, commits, branches, runs, mine };
}

// 10 points if the repo exists, 20 for pull requests, 30 for a merged PR (60 total).
// Once all three are met, up to +50 in bonuses.
function grade(d, handle) {
  const must = [
    [true, "Repository exists  +10", (d.info.fork ? "public · fork" : "public") + " · ★" + d.info.stargazers_count],
    [d.prs > 0, "Has pull requests  +20", plural(d.prs, "PR")],
    [d.merged > 0, "Has merged PRs (merge requests)  +30", d.merged + " merged"]
  ];
  const extra = [
    [d.commits > 0, "Commits", String(d.commits)],
    [d.branches > 1, "Extra branches  +10", String(d.branches)],
    [d.issues > 0, "Issues opened  +10", String(d.issues)],
    [d.runs > 0, "GitHub Actions runs  +10", String(d.runs)]
  ];
  if (handle) extra.unshift([d.mine > 0, "PRs by @" + handle + "  +20", String(d.mine)]);
  const pass = must.every(m => m[0]);
  const bonus = (handle && d.mine > 0 ? 20 : 0) + (d.runs > 0 ? 10 : 0) + (d.issues > 0 ? 10 : 0) + (d.branches > 1 ? 10 : 0);
  const points = 10 + (d.prs > 0 ? 20 : 0) + (d.merged > 0 ? 30 : 0) + (pass ? bonus : 0);
  return { must, extra, pass, points };
}

/* ---------- helpers ---------- */
async function auth(req) {
  const t = (req.headers.authorization || "").replace("Bearer ", "");
  if (!/^[a-f0-9]{48}$/.test(t)) return null;
  const v = await redis("GET", "token:" + t);
  return v ? JSON.parse(v) : null;
}
const send = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
const readBody = req => new Promise((ok, no) => {
  let s = ""; req.on("data", c => { s += c; if (s.length > 4096) { req.destroy(); no(new Error("Too large")); } });
  req.on("end", () => { try { ok(JSON.parse(s || "{}")); } catch { no(new Error("Bad JSON")); } });
});
const cooldown = {};

/* ---------- static files (the built Solid app in ./dist) ---------- */
const DIST = path.join(__dirname, "dist");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".json": "application/json", ".pdf": "application/pdf" };
function serveStatic(res, url) {
  let f = path.join(DIST, decodeURIComponent(url));
  if (!f.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, "index.html");
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end("Frontend not built. Run: npm run build"); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}

/* ---------- routes ---------- */
http.createServer(async (req, res) => {
  try {
    const url = req.url.split("?")[0];
    if (req.method === "GET" && !url.startsWith("/api/")) return serveStatic(res, url);

    if (req.method === "GET" && url === "/api/leaderboard") {
      const flat = await redis("ZRANGE", "lb", 0, -1, "REV", "WITHSCORES");   // [id, score, id, score, ...]
      const ids = [], pts = {};
      for (let i = 0; i < flat.length; i += 2) { ids.push(flat[i]); pts[flat[i]] = +flat[i + 1]; }
      if (!ids.length) return send(res, 200, []);
      const out = await pipe([["MGET", ...ids.map(i => "player:" + i)], ...ids.map(i => ["HGET", "stats:" + i, "repos"])]);
      const rows = ids.map((id, i) => { const p = JSON.parse(out[0][i] || "{}"); return { name: p.name, points: pts[id], repos: +out[i + 1] || 0, t: p.created || 0 }; })
        .filter(r => r.name).sort((a, b) => b.points - a.points || a.t - b.t).map(({ t, ...r }, i) => ({ rank: i + 1, ...r }));
      return send(res, 200, rows);
    }
    if (req.method === "POST" && url === "/api/register") {
      const { name = "", github = "" } = await readBody(req);
      const n = String(name).trim().replace(/\s+/g, " "), g = String(github).trim().replace(/^@/, "");
      if (n.length < 2 || n.length > 30) return send(res, 400, { error: "Name must be 2 to 30 characters." });
      if (g && !/^[A-Za-z0-9-]{1,39}$/.test(g)) return send(res, 400, { error: "That GitHub username looks invalid." });
      const id = crypto.randomUUID(), token = crypto.randomBytes(24).toString("hex");
      if (!(await redis("SET", "name:" + n.toLowerCase(), id, "NX"))) return send(res, 409, { error: "That name is taken. Pick another." });
      const p = JSON.stringify({ id, name: n, github: g, created: Date.now() });
      await pipe([["SET", "token:" + token, p], ["SET", "player:" + id, p], ["ZADD", "lb", "NX", 0, id]]);
      return send(res, 201, { token, name: n, github: g, points: 0, repos: 0 });
    }
    const me = url.startsWith("/api/") ? await auth(req) : null;
    if (url.startsWith("/api/") && !me) return send(res, 401, { error: "Register first." });
    if (req.method === "GET" && url === "/api/me") {
      const [pts, repos] = await pipe([["ZSCORE", "lb", me.id], ["HGET", "stats:" + me.id, "repos"]]);
      return send(res, 200, { name: me.name, github: me.github, points: +pts || 0, repos: +repos || 0 });
    }
    if (req.method === "POST" && url === "/api/verify") {
      const m = String((await readBody(req)).repo || "").trim().replace(/\.git$/i, "").replace(/\/+$/, "")
        .match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)/i);
      if (!m) return send(res, 400, { error: "Paste a link like github.com/owner/repo." });
      if (Date.now() - (cooldown[me.id] || 0) < 8000) return send(res, 429, { error: "Slow down. Wait a few seconds between checks." });
      cooldown[me.id] = Date.now();
      const [, owner, name] = m, key = "claim:" + (owner + "/" + name).toLowerCase();
      const raw = await redis("GET", key), claim = raw ? JSON.parse(raw) : null;
      if (claim && claim.playerId !== me.id) return send(res, 409, { error: "That repo is already registered to another participant." });
      const d = await inspect(owner, name, me.github);
      if (!d) return send(res, 404, { error: "Repo not found. Check the link and make sure it is public." });
      const g = grade(d, me.github), prev = claim ? claim.points : 0, awarded = Math.max(0, g.points - prev);
      const rec = JSON.stringify({ playerId: me.id, points: Math.max(g.points, prev), at: Date.now() });
      if (!claim) {
        if (!(await redis("SET", key, rec, "NX"))) return send(res, 409, { error: "That repo is already registered to another participant." });
        await redis("HINCRBY", "stats:" + me.id, "repos", 1);
      } else if (awarded) await redis("SET", key, rec);
      const total = awarded ? +(await redis("ZINCRBY", "lb", awarded, me.id)) : +(await redis("ZSCORE", "lb", me.id)) || 0;
      return send(res, 200, { ...g, awarded, repo: owner + "/" + name, total });
    }
    send(res, 404, { error: "Not found" });
  } catch (e) { send(res, e.status || 400, { error: e.message || "Something went wrong." }); }
}).listen(PORT, () => console.log("Git, Set, Go! running on http://localhost:" + PORT));
