import { createSignal, For, Show } from "solid-js";
import { api, me, clearToken, refreshMe } from "./api";

const wait = ms => new Promise(r => setTimeout(r, ms));

function Rows(props) {
  return (
    <>
      <h2>{props.title}</h2>
      <ul>
        <For each={props.items}>{([ok, k, v]) => (
          <li class={ok ? "ok" : props.bonus ? "na" : "no"}>
            <span class="m">{ok ? "✓" : props.bonus ? "–" : "✗"}</span><span>{k}</span><span class="v">{v}</span>
          </li>
        )}</For>
      </ul>
    </>
  );
}

export default function Verify() {
  const [repo, setRepo] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [v, setV] = createSignal(null);      
  const [must, setMust] = createSignal([]);
  const [extra, setExtra] = createSignal([]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setMust([]); setExtra([]);
    setV({ cls: "busy", head: "Checking…", sub: "Reading the repo, pull requests and activity." });
    try {
      const r = await api("/api/verify", { repo: repo() });
      for (const m of r.must) { setMust(a => [...a, m]); await wait(120); }
      for (const m of r.extra) { setExtra(a => [...a, m]); await wait(120); }
      if (r.pass) {
        setV({ cls: "pass", head: r.awarded ? `Verified · +${r.awarded} points` : "Verified",
               sub: r.awarded ? `${r.repo} scored ${r.points}. You now have ${r.total} points.` : "Already counted. Add bonuses to score more." });
      } else {
        const missing = r.must.filter(m => !m[0]).map(m => m[1].replace(/\s+\+\d+$/, "").toLowerCase()).join(" and ");
        setV({ cls: "fail", head: r.awarded ? `Partial · +${r.awarded} points` : "Not yet",
               sub: `Still needs ${missing}. You have ${r.total} points. Fix it, then verify again.` });
      }
      refreshMe();
    } catch (err) {
      setV({ cls: "fail", head: "Couldn't verify", sub: err.message });
      if (err.status === 401) clearToken();
    } finally { setBusy(false); }
  }

  return (
    <div>
      <div class="me">
        <span>{me().name}{me().github ? ` (@${me().github})` : ""} · <b>{me().points} pts</b> · {me().repos} {me().repos === 1 ? "repo" : "repos"}</span>
        <a role="button" tabindex="0" onClick={clearToken} onKeyDown={e => e.key === "Enter" && clearToken()}>Switch participant</a>
      </div>
      <form onSubmit={submit}>
        <div class="row"><label for="repo">$</label>
          <input id="repo" placeholder="github.com/owner/repo" autocomplete="off" spellcheck={false} required value={repo()} onInput={e => setRepo(e.target.value)} /></div>
        <button type="submit" disabled={busy()}>git verify --repo</button>
      </form>
      <p class="hint">10 points if the repo exists, 20 for pull requests, 30 for a merged PR. Once all three are met, up to +50 in bonuses.</p>

      <div id="out" aria-live="polite">
        <Show when={v()}>
          <div class={"verdict " + v().cls}>
            <span class="dot" /><div><strong>{v().head}</strong><small>{v().sub}</small></div>
          </div>
        </Show>
        <Show when={must().length}><Rows title="REQUIRED" items={must()} /></Show>
        <Show when={extra().length}><Rows title="BONUS" items={extra()} bonus /></Show>
      </div>
    </div>
  );
}
