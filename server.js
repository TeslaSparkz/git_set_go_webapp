
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const PORT = process.env.PORT || 3000, GH_TOKEN = process.env.GITHUB_TOKEN;
const DB_FILE = path.join(__dirname, "data.json");

let db = { players: {}, claims: {} };       
try { db = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch {}
const save = () => { fs.writeFileSync(DB_FILE + ".tmp", JSON.stringify(db)); fs.renameSync(DB_FILE + ".tmp", DB_FILE); };


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
const total = id => Object.values(db.claims).filter(c => c.playerId === id).reduce((a, c) => a + c.points, 0);
const repoCount = id => Object.values(db.claims).filter(c => c.playerId === id).length;
const auth = req => { const t = (req.headers.authorization || "").replace("Bearer ", ""); return Object.values(db.players).find(p => p.token === t); };
const send = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
const readBody = req => new Promise((ok, no) => {
  let s = ""; req.on("data", c => { s += c; if (s.length > 4096) { req.destroy(); no(new Error("Too large")); } });
  req.on("end", () => { try { ok(JSON.parse(s || "{}")); } catch { no(new Error("Bad JSON")); } });
});
const cooldown = {};

const DIST = path.join(__dirname, "dist");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".json": "application/json" };
function serveStatic(res, url) {
  let f = path.join(DIST, decodeURIComponent(url));
  if (!f.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, "index.html");
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end("Frontend not built. Run: npm run build"); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}


http.createServer(async (req, res) => {
  try {
    const url = req.url.split("?")[0];
    if (req.method === "GET" && !url.startsWith("/api/")) return serveStatic(res, url);
    if (req.method === "GET" && url === "/api/leaderboard") {
      const rows = Object.values(db.players).map(p => ({ name: p.name, points: total(p.id), repos: repoCount(p.id), t: p.created }))
        .sort((a, b) => b.points - a.points || a.t - b.t).map(({ t, ...r }, i) => ({ rank: i + 1, ...r }));
      return send(res, 200, rows);
    }
    if (req.method === "POST" && url === "/api/register") {
      const { name = "", github = "" } = await readBody(req);
      const n = String(name).trim().replace(/\s+/g, " "), g = String(github).trim().replace(/^@/, "");
      if (n.length < 2 || n.length > 30) return send(res, 400, { error: "Name must be 2 to 30 characters." });
      if (g && !/^[A-Za-z0-9-]{1,39}$/.test(g)) return send(res, 400, { error: "That GitHub username looks invalid." });
      if (Object.values(db.players).some(p => p.name.toLowerCase() === n.toLowerCase())) return send(res, 409, { error: "That name is taken. Pick another." });
      const id = crypto.randomUUID(), token = crypto.randomBytes(24).toString("hex");
      db.players[id] = { id, name: n, github: g, token, created: Date.now() }; save();
      return send(res, 201, { token, name: n, github: g, points: 0, repos: 0 });
    }
    const me = auth(req);
    if (url.startsWith("/api/") && !me) return send(res, 401, { error: "Register first." });
    if (req.method === "GET" && url === "/api/me") return send(res, 200, { name: me.name, github: me.github, points: total(me.id), repos: repoCount(me.id) });
    if (req.method === "POST" && url === "/api/verify") {
      const m = String((await readBody(req)).repo || "").trim().replace(/\.git$/i, "").replace(/\/+$/, "")
        .match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)/i) || null;
      if (!m) return send(res, 400, { error: "Paste a link like github.com/owner/repo." });
      if (Date.now() - (cooldown[me.id] || 0) < 8000) return send(res, 429, { error: "Slow down. Wait a few seconds between checks." });
      cooldown[me.id] = Date.now();
      const [, owner, name] = m, key = (owner + "/" + name).toLowerCase();
      const claim = db.claims[key];
      if (claim && claim.playerId !== me.id) return send(res, 409, { error: "That repo is already registered to another participant." });
      const d = await inspect(owner, name, me.github);
      if (!d) return send(res, 404, { error: "Repo not found. Check the link and make sure it is public." });
      const g = grade(d, me.github);
      let awarded = 0;
      awarded = Math.max(0, g.points - (claim ? claim.points : 0));
      db.claims[key] = { playerId: me.id, points: Math.max(g.points, claim ? claim.points : 0), at: Date.now() };
      if (!claim || awarded) save();
      return send(res, 200, { ...g, awarded, repo: owner + "/" + name, total: total(me.id) });
    }
    send(res, 404, { error: "Not found" });
  } catch (e) { send(res, e.status || 400, { error: e.message || "Something went wrong." }); }
}).listen(PORT, () => console.log("Git, Set, Go! running on http://localhost:" + PORT));
