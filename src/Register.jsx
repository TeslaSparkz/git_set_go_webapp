import { createSignal } from "solid-js";
import { api, setToken, setMe } from "./api";

export default function Register() {
  const [name, setName] = createSignal("");
  const [gh, setGh] = createSignal("");
  const [err, setErr] = createSignal("");

  async function submit(e) {
    e.preventDefault(); setErr("");
    try {
      const r = await api("/api/register", { name: name(), github: gh() });
      setToken(r.token); setMe(r);
    } catch (x) { setErr(x.message); }
  }

  return (
    <form onSubmit={submit}>
      <div class="row"><label for="name">$</label>
        <input id="name" placeholder="your name" maxlength="30" autocomplete="off" required value={name()} onInput={e => setName(e.target.value)} /></div>
      <div class="pair">
        <div class="row"><label for="gh">@</label>
          <input id="gh" placeholder="github username (optional)" autocomplete="off" spellcheck={false} value={gh()} onInput={e => setGh(e.target.value)} /></div>
        <button type="submit">git config --register</button>
      </div>
      <p class="hint">Add your GitHub username to earn +20 for PRs you authored. Your name appears on the leaderboard.</p>
      <p class="hint err">{err()}</p>
    </form>
  );
}
