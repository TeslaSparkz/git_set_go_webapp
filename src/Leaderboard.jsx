import { createSignal, For, Show, onCleanup } from "solid-js";
import { api, me } from "./api";

export default function Leaderboard() {
  const [rows, setRows] = createSignal(null);
  const [err, setErr] = createSignal("");
  const reachedAt = timestamp => timestamp ? new Date(timestamp).toLocaleString() : "—";

  const load = async () => {
    try { setRows(await api("/api/leaderboard")); setErr(""); } catch (e) { setErr(e.message); }
  };
  load();
  const timer = setInterval(load, 20000);   
  onCleanup(() => clearInterval(timer));

  return (
    <div class="tw">
      <Show when={!err()} fallback={<p class="empty">Couldn't load the leaderboard. {err()}</p>}>
        <Show when={rows()?.length} fallback={<p class="empty">{rows() ? "No one on the board yet. Register and verify a repo to be first." : "Loading…"}</p>}>
          <p class="hint">Max 110 points per GitHub username across repos. Equal scores rank by when the score was reached; earlier times rank higher.</p>
          <table>
            <thead><tr><th>#</th><th>Participant</th><th>Repos</th><th>Points</th><th>Reached</th></tr></thead>
            <tbody>
              <For each={rows()}>{r => (
                <tr class={(r.rank <= 3 ? "r" + r.rank : "") + (me() && r.github === me().github ? " you" : "")}>
                  <td class="n">{r.rank}</td>
                  <td>{r.github ? "@" + r.github : r.name}<Show when={me() && r.github === me().github}><span class="tag">you</span></Show></td>
                  <td>{r.repos}</td><td class="pts">{r.points}</td><td class="reached">{reachedAt(r.reachedAt)}</td>
                </tr>
              )}</For>
            </tbody>
          </table>
        </Show>
      </Show>
    </div>
  );
}
