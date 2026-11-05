const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");

try {
  for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith("#") && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
} catch {}
const PORT = process.env.PORT || 3000, GH_TOKEN = process.env.GITHUB_TOKEN;
const R_URL = (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/+$/, ""), R_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function call(url, body) {
  if (!R_URL || !R_TOKEN) throw Object.assign(new Error("Server is missing Upstash Redis configuration."), { status: 503 });
  let r, j;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer " + R_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch {
    throw Object.assign(new Error("Could not reach Upstash Redis. Check its REST URL and network access."), { status: 503 });
  }
  if (!r.ok) {
    const message = r.status === 401 || r.status === 403
      ? "Upstash rejected the REST token. Check UPSTASH_REDIS_REST_TOKEN."
      : r.status === 404
        ? "Upstash REST endpoint not found. Check UPSTASH_REDIS_REST_URL."
        : `Upstash REST request failed (HTTP ${r.status}). Check the database configuration and status.`;
    console.error(`Upstash REST request failed with HTTP ${r.status}.`);
    throw Object.assign(new Error(message), { status: 503 });
  }
  try { j = await r.json(); }
  catch { throw Object.assign(new Error("Upstash returned an invalid response. Check UPSTASH_REDIS_REST_URL."), { status: 503 }); }
  return j;
}
function commandError(detail) {
  console.error("Upstash Redis command failed:", detail);
  return Object.assign(new Error("Upstash Redis rejected a command. Check the server logs for details."), { status: 503 });
}
async function redis(...cmd) {
  const j = await call(R_URL, cmd.map(String));
  if (j.error) throw commandError(j.error);
  return j.result;
}
async function pipe(cmds) {
  const j = await call(R_URL + "/pipeline", cmds.map(c => c.map(String)));
  if (!Array.isArray(j)) throw Object.assign(new Error("Upstash returned an invalid pipeline response."), { status: 503 });
  return j.map(x => { if (x.error) throw commandError(x.error); return x.result; });
}

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
const SCORE_VERSION = 4;
const MAX_POINTS = 110;

async function moveIdentity(oldId, newId, profile) {
  if (oldId === newId) return profile;
  const [oldScore, newScore, oldRepos, newRepos, existing] = await pipe([
    ["ZSCORE", "lb", oldId], ["ZSCORE", "lb", newId],
    ["HGET", "stats:" + oldId, "repos"], ["HGET", "stats:" + newId, "repos"],
    ["GET", "player:" + newId]
  ]);
  const canonical = existing ? JSON.parse(existing) : profile;
  const mergedScore = Math.min(MAX_POINTS, (+oldScore || 0) + (+newScore || 0));
  const mergedRepos = (+oldRepos || 0) + (+newRepos || 0);
  let cursor = "0";
  do {
    const [next, keys] = await redis("SCAN", cursor, "MATCH", "claim:*", "COUNT", 100);
    cursor = String(next);
    const updates = [];
    for (const key of keys) {
      const raw = await redis("GET", key);
      if (!raw) continue;
      const claim = JSON.parse(raw);
      if (claim.playerId === oldId) {
        claim.playerId = newId;
        updates.push(["SET", key, JSON.stringify(claim)]);
      }
    }
    for (let i = 0; i < updates.length; i += 50) await pipe(updates.slice(i, i + 50));
  } while (cursor !== "0");

  const updated = {
    ...canonical,
    id: newId,
    github: profile.github,
    scoreAt: Math.min(
      canonical.scoreAt || canonical.created || Date.now(),
      profile.scoreAt || profile.created || Date.now()
    )
  };
  await pipe([
    ["ZADD", "lb", mergedScore, newId],
    ["ZREM", "lb", oldId],
    ["HSET", "stats:" + newId, "repos", mergedRepos],
    ["DEL", "stats:" + oldId],
    ["SET", "player:" + newId, JSON.stringify(updated)],
    ["DEL", "player:" + oldId]
  ]);
  Object.assign(profile, updated);
  if (profile.token) await redis("SET", "token:" + profile.token, JSON.stringify(profile));
  return profile;
}

async function canonicalizeIdentity(profile) {
  if (!profile.github) return profile;
  const id = profile.github.toLowerCase();
  return moveIdentity(profile.id, id, profile);
}

function scoreForClaim(claim) {
  const o = claim.objectives;
  if (!o || claim.version >= 3) return +claim.points || 0;
  const pass = o.pullRequests > 0 && o.mergedPullRequests > 0;
  return 10 + (o.commits > 0 ? 20 : 0) + (o.pullRequests > 0 ? 40 : 0)
    + (o.mergedPullRequests > 0 ? 10 : 0) + (o.issues > 0 ? 30 : 0)
    + (pass ? (o.authoredPullRequests > 0 ? 20 : 0) + (o.actionsRuns > 0 ? 10 : 0)
      + (o.branches > 1 ? 10 : 0) : 0);
}

async function highestRepoScore(playerId) {
  let cursor = "0", highest = { points: 0, scoreAt: 0 };
  do {
    const [next, keys] = await redis("SCAN", cursor, "MATCH", "claim:*", "COUNT", 100);
    cursor = String(next);
    for (let i = 0; i < keys.length; i += 50) {
      const batch = keys.slice(i, i + 50);
      const [records] = await pipe([["MGET", ...batch]]);
      for (const raw of records) {
        if (!raw) continue;
        const claim = JSON.parse(raw);
        if (claim.playerId !== playerId) continue;
        const points = scoreForClaim(claim);
        const scoreAt = claim.scoreAt || claim.at || 0;
        if (points > highest.points || (points === highest.points && scoreAt < highest.scoreAt)) {
          highest = { points, scoreAt };
        }
      }
    }
  } while (cursor !== "0");
  return highest;
}

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
    [d.prs > 0, "Has pull requests  +40 points", `${plural(d.prs, "PR")} · +40 pts`],
    [d.merged > 0, "Has merged PRs (merge requests)  +10 points", `${d.merged} merged · +10 pts`]
  ];
  const extra = [
    [d.commits > 0, "Commits  +20 points", `${plural(d.commits, "commit")} · +20 pts`],
    [d.branches > 1, "Extra branches  +10", String(d.branches)],
    [d.issues > 0, "Issues opened  +30 points", `${plural(d.issues, "issue")} · +30 pts`],
    [d.runs > 0, "GitHub Actions runs  +10", String(d.runs)]
  ];
  if (handle) extra.unshift([d.mine > 0, "PRs by @" + handle + "  +20 points", String(d.mine)]);
  const pass = must.every(m => m[0]);
  const bonus = pass ? (handle && d.mine > 0 ? 20 : 0) + (d.runs > 0 ? 10 : 0) + (d.branches > 1 ? 10 : 0) : 0;
  const points = 10 + (d.commits > 0 ? 20 : 0) + (d.prs > 0 ? 40 : 0)
    + (d.merged > 0 ? 10 : 0) + (d.issues > 0 ? 30 : 0) + bonus;
  return { must, extra, pass, points };
}

async function auth(req) {
  const t = (req.headers.authorization || "").replace("Bearer ", "");
  if (!/^[a-f0-9]{48}$/.test(t)) return null;
  const v = await redis("GET", "token:" + t);
  if (!v) return null;
  const profile = JSON.parse(v);
  Object.defineProperty(profile, "token", { value: t });
  return profile;
}
const send = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
const readBody = req => {
  if (req.body !== undefined) {
    if (typeof req.body === "string") {
      try { return Promise.resolve(JSON.parse(req.body || "{}")); }
      catch { return Promise.reject(Object.assign(new Error("Bad JSON"), { status: 400 })); }
    }
    return Promise.resolve(req.body || {});
  }
  return new Promise((ok, no) => {
  let s = ""; req.on("data", c => { s += c; if (s.length > 4096) { req.destroy(); no(new Error("Too large")); } });
  req.on("end", () => { try { ok(JSON.parse(s || "{}")); } catch { no(new Error("Bad JSON")); } });
  });
};
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

async function handle(req, res) {
  try {
    const url = req.url.split("?")[0];
    if (req.method === "GET" && !url.startsWith("/api/")) return serveStatic(res, url);

    if (req.method === "GET" && url === "/api/health") {
      await redis("PING");
      return send(res, 200, { ok: true, redis: true });
    }

    if (req.method === "GET" && url === "/api/leaderboard") {
      const flat = await redis("ZRANGE", "lb", 0, -1, "REV", "WITHSCORES");   // [id, score, id, score, ...]
      const ids = [], pts = {};
      for (let i = 0; i < flat.length; i += 2) { ids.push(flat[i]); pts[flat[i]] = +flat[i + 1]; }
      if (!ids.length) return send(res, 200, []);
      const out = await pipe([["MGET", ...ids.map(i => "player:" + i)], ...ids.map(i => ["HGET", "stats:" + i, "repos"])]);
      const rows = ids.map((id, i) => {
        const p = JSON.parse(out[0][i] || "{}");
        return { name: p.name, github: p.github, points: pts[id], repos: +out[i + 1] || 0, reachedAt: p.scoreAt || p.created || 0, id };
      })
        .filter(r => r.name && r.github && r.id === r.github.toLowerCase())
        .sort((a, b) => b.points - a.points || a.reachedAt - b.reachedAt || a.id.localeCompare(b.id))
        .map(({ id, ...r }, i) => ({ rank: i + 1, ...r }));
      return send(res, 200, rows);
    }
    if (req.method === "POST" && url === "/api/register") {
      const { name = "", github = "" } = await readBody(req);
      const n = String(name).trim().replace(/\s+/g, " "), g = String(github).trim().replace(/^@/, "");
      if (n.length < 2 || n.length > 30) return send(res, 400, { error: "Name must be 2 to 30 characters." });
      if (!/^[A-Za-z0-9-]{1,39}$/.test(g)) return send(res, 400, { error: "A valid GitHub username is required." });
      const id = g.toLowerCase(), token = crypto.randomBytes(24).toString("hex");
      if (!(await redis("SET", "name:" + n.toLowerCase(), id, "NX"))) return send(res, 409, { error: "That name is taken. Pick another." });
      const existing = await redis("GET", "player:" + id);
      const profile = existing ? JSON.parse(existing) : { id, name: n, github: g, created: Date.now() };
      profile.name = n;
      profile.github = g;
      const p = JSON.stringify(profile);
      await pipe([["SET", "token:" + token, p], ["SET", "player:" + id, p], ["ZADD", "lb", "NX", 0, id]]);
      const [points, repos] = await pipe([["ZSCORE", "lb", id], ["HGET", "stats:" + id, "repos"]]);
      return send(res, 201, { token, name: profile.name, github: g, points: +points || 0, repos: +repos || 0 });
    }
    const me = url.startsWith("/api/") ? await auth(req) : null;
    if (url.startsWith("/api/") && !me) return send(res, 401, { error: "Register first." });
    if (req.method === "POST" && url === "/api/me/github") {
      const g = String((await readBody(req)).github || "").trim().replace(/^@/, "");
      if (!/^[A-Za-z0-9-]{1,39}$/.test(g)) return send(res, 400, { error: "That GitHub username looks invalid." });
      me.github = g;
      await redis("SET", "token:" + me.token, JSON.stringify(me));
      await redis("SET", "player:" + me.id, JSON.stringify(me));
      await canonicalizeIdentity(me);
      const [points, repos] = await pipe([["ZSCORE", "lb", me.id], ["HGET", "stats:" + me.id, "repos"]]);
      return send(res, 200, { name: me.name, github: me.github, points: +points || 0, repos: +repos || 0 });
    }
    await canonicalizeIdentity(me);
    if (req.method === "GET" && url === "/api/me") {
      const [pts, repos] = await pipe([["ZSCORE", "lb", me.id], ["HGET", "stats:" + me.id, "repos"]]);
      return send(res, 200, { name: me.name, github: me.github, points: +pts || 0, repos: +repos || 0 });
    }
    if (req.method === "POST" && url === "/api/verify") {
      const m = String((await readBody(req)).repo || "").trim().replace(/\.git$/i, "").replace(/\/+$/, "")
        .match(/^(?:(?:https?:\/\/)?(?:www\.)?github\.com\/)?([\w.-]+)\/([\w.-]+)$/i);
      if (!m) return send(res, 400, { error: "Paste a link like github.com/owner/repo." });
      const [, owner, name] = m;
      if (!me.github || owner.toLowerCase() !== me.github.toLowerCase())
        return send(res, 400, { error: `Enter a repository owned by your GitHub username (@${me.github || "unknown"}).` });
      if (!(await redis("SET", "cooldown:" + me.id, "1", "NX", "EX", 8)))
        return send(res, 429, { error: "Slow down. Wait a few seconds between checks." });
      const key = "claim:" + (owner + "/" + name).toLowerCase();
      const raw = await redis("GET", key), claim = raw ? JSON.parse(raw) : null;
      if (claim && claim.playerId !== me.id) return send(res, 409, { error: "That repo is already registered to another participant." });
      const d = await inspect(owner, name, me.github);
      if (!d) return send(res, 404, { error: "Repo not found. Check the link and make sure it is public." });
      const g = grade(d, me.github);
      const [score] = await pipe([["ZSCORE", "lb", me.id]]);
      const current = Math.min(MAX_POINTS, +score || 0);
      const at = Date.now();
      const repoPoints = claim?.version === SCORE_VERSION ? Math.max(claim.points, g.points) : g.points;
      const repoScoreAt = claim?.version === SCORE_VERSION && repoPoints === claim.points
        ? claim.scoreAt || claim.at || at : at;
      const rec = JSON.stringify({
        playerId: me.id,
        points: repoPoints,
        scoreAt: repoScoreAt,
        objectives: {
          repository: true,
          pullRequests: d.prs,
          mergedPullRequests: d.merged,
          commits: d.commits,
          issues: d.issues,
          branches: d.branches,
          actionsRuns: d.runs,
          authoredPullRequests: d.mine
        },
        version: SCORE_VERSION,
        at
      });
      if (!claim) {
        if (!(await redis("SET", key, rec, "NX"))) return send(res, 409, { error: "That repo is already registered to another participant." });
        await redis("HINCRBY", "stats:" + me.id, "repos", 1);
      } else {
        await redis("SET", key, rec);
      }
      const best = await highestRepoScore(me.id);
      const total = Math.min(MAX_POINTS, best.points);
      const awarded = Math.max(0, total - current);
      await redis("ZADD", "lb", total, me.id);
      if (total !== current) {
        await redis("SET", "player:" + me.id, JSON.stringify({ ...me, scoreAt: best.scoreAt || at }));
      }
      return send(res, 200, { ...g, awarded, repo: owner + "/" + name, total });
    }
    send(res, 404, { error: "Not found" });
  } catch (e) { send(res, e.status || 400, { error: e.message || "Something went wrong." }); }
}

module.exports = handle;

if (require.main === module) {
  if (!R_URL || !R_TOKEN) {
    console.error("Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN.");
    process.exit(1);
  }
  http.createServer(handle).listen(PORT, () => console.log("Git, Set, Go! running on http://localhost:" + PORT));
}
