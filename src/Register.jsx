import { createSignal, onMount } from "solid-js";
import { api, setToken, setMe } from "./api";

export default function Register() {
  const [name, setName] = createSignal("");
  const [gh, setGh] = createSignal("");
  const [err, setErr] = createSignal("");
  const [redisStatus, setRedisStatus] = createSignal("checking");

  async function checkRedis() {
    setRedisStatus("checking");
    try {
      const health = await api("/api/health");
      if (!health.ok || !health.redis) throw new Error("Redis health check failed.");
      setRedisStatus("ready");
      setErr("");
      return true;
    } catch (x) {
      setRedisStatus("unavailable");
      setErr(x.message);
      return false;
    }
  }

  onMount(checkRedis);

  async function submit(e) {
    e.preventDefault();
    if (!(await checkRedis())) return;
    setErr("");
    try {
      const r = await api("/api/register", { name: name(), github: gh() });
      setToken(r.token); setMe(r);
    } catch (x) { setErr(x.message); }
  }

  return (
    <form class="register-form" onSubmit={submit}>
      <div class="row"><label for="name">$</label>
        <input id="name" placeholder="your name" maxlength="30" autocomplete="off" required value={name()} onInput={e => setName(e.target.value)} /></div>
      <div class="pair">
        <div class="row"><label for="gh">@</label>
          <input id="gh" placeholder="github username" autocomplete="off" spellcheck={false} required value={gh()} onInput={e => setGh(e.target.value)} /></div>
        <button type="submit" disabled={redisStatus() !== "ready"}>
          {redisStatus() === "checking" ? "checking Redis…" : "git config --register"}
        </button>
      </div>
      <p class="hint">Your GitHub username is required and must be unique (including capitalization); display names can be shared. Earn +20 for PRs you authored.</p>
      <p class={"hint " + (redisStatus() === "ready" ? "" : "err")} role="status">
        {redisStatus() === "ready" ? "Upstash Redis connected." : redisStatus() === "checking" ? "Checking Upstash Redis…" : "Upstash Redis is unavailable. Start the API server and check its Upstash configuration, then retry."}
      </p>
      <button type="button" class="secondary" onClick={checkRedis} disabled={redisStatus() === "checking"}>Retry Redis check</button>
      <p class="hint err">{err()}</p>
    </form>
  );
}
