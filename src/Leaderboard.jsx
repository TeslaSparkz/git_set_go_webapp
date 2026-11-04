import { createSignal, For, Show, onCleanup } from "solid-js";
import { api, me } from "./api";

export default function Leaderboard() {
  const [rows, setRows] = createSignal(null);
  const [err, setErr] = createSignal("");

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
          <table>
            <thead><tr><th>#</th><th>Participant</th><th>Repos</th><th>Points</th></tr></thead>
            <tbody>
              <For each={rows()}>{r => (
                <tr class={(r.rank <= 3 ? "r" + r.rank : "") + (me() && r.name === me().name ? " you" : "")}>
                  <td class="n">{r.rank}</td>
                  <td>{r.name}<Show when={me() && r.name === me().name}><span class="tag">you</span></Show></td>
                  <td>{r.repos}</td><td class="pts">{r.points}</td>
                </tr>
              )}</For>
            </tbody>
          </table>
        </Show>
      </Show>
    </div>
  );
}
