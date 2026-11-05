import { createSignal, onMount, Show } from "solid-js";
import { me, refreshMe } from "./api";
import Register from "./Register";
import Verify from "./Verify";
import Leaderboard from "./Leaderboard";
import CheatSheet from "./CheatSheet";

function Graph() {
  return (
    <svg class="graph" viewBox="0 0 760 80" aria-hidden="true">
      <path d="M20 58 H 700" stroke="#8a8d86" stroke-width="2.5" opacity=".6" />
      <path d="M20 58 C 60 58,70 16,110 16 S 160 58,200 58 M200 58 C 240 58,250 16,290 16 S 340 58,380 58 M380 58 C 420 58,430 16,470 16 S 520 58,560 58" fill="none" stroke="#3ddc57" stroke-width="2.5" />
      <g fill="#080b09" stroke="#f3efe6" stroke-width="2.5"><circle cx="20" cy="58" r="9" /><circle cx="200" cy="58" r="9" /><circle cx="380" cy="58" r="9" /></g>
      <g fill="#080b09" stroke="#3ddc57" stroke-width="2.5"><circle cx="110" cy="16" r="7" /><circle cx="290" cy="16" r="7" /><circle cx="470" cy="16" r="7" /></g>
      <circle cx="700" cy="58" r="13" fill="#3ddc57" />
    </svg>
  );
}

// To use real logos: put gdg-logo.png / foss-logo.png in /public and swap each <span> for
// <img src="/gdg-logo.png" alt="Google Developer Groups logo" />
function Orgs() {
  return (
    <section class="orgs">
      <div class="org">
        <img src="/gdg-logo.svg" alt="Google Developer Groups logo" class="logo" />
        <div>Google Developer Groups<small>On Campus · Indian Institute of Information Technology Kalyani</small></div>
      </div>
      <div class="org r">
        <div><b>FOSS Club</b><br />IIIT, কল্যাণী</div>
        <div class="logo"><img src="/foss-icon.svg" alt="FOSS Club logo" class ="logo" /></div>
      </div>
    </section>
  );
}

export default function App() {
  const [tab, setTab] = createSignal("play");
  onMount(refreshMe);

  return (
    <main class="wrap">
      <section class="win">
        <div class="bar">
          <i style="background:#ff5f57" /><i style="background:#febc2e" /><i style="background:#28c840" />
          <span class="t">foss × gdg — bash</span><span class="pill">REPO VERIFIER</span>
        </div>
        <div class="body">
          <p class="cmd"><b>$</b> git checkout -b <span>git-set-go</span></p>
          <h1>Git, Set,<br /><em>Go!</em><span class="cursor" aria-hidden="true" /></h1>
          <p class="sub">Register, verify your repo, earn points, climb the board.</p>
          <Graph />

          <div class="tabs" role="tablist">
            <button role="tab" aria-selected={tab() === "play"} onClick={() => setTab("play")}>Verify</button>
            <button role="tab" aria-selected={tab() === "lb"} onClick={() => setTab("lb")}>Leaderboard</button>
            <button role="tab" aria-selected={tab() === "sheet"} onClick={() => setTab("sheet")}>Cheat sheet</button>
          </div>

          <div hidden={tab() !== "play"}>
            <Show when={me()} fallback={<Register />}><Verify /></Show>
          </div>
          <Show when={tab() === "lb"}><Leaderboard /></Show>
          <Show when={tab() === "sheet"}><CheatSheet /></Show>

          <p class="foot">$ git push origin main --be-there</p>
        </div>
      </section>
      <Orgs />
    </main>
  );
}
