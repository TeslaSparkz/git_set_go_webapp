import { createSignal, createMemo, For, Show } from "solid-js";

const I = (d, c, w) => ({ d, c: [].concat(c), w });   // description, command(s), optional warning
const SECTIONS = [
  { n: "01", t: "CREATE", items: [
    I("Clone an existing repository", "git clone ssh://user@domain.com/repo.git"),
    I("Create a new local repository", "git init")] },
  { n: "02", t: "LOCAL CHANGES", items: [
    I("Changed files in your working directory", "git status"),
    I("Changes to tracked files", "git diff"),
    I("Add all current changes to the next commit", "git add ."),
    I("Add some changes in <file> to the next commit", "git add -p <file>"),
    I("Commit all local changes in tracked files", "git commit -a"),
    I("Commit previously staged changes", "git commit"),
    I("Change the last commit", "git commit --amend", "Don't amend published commits!")] },
  { n: "03", t: "COMMIT HISTORY", items: [
    I("Show all commits, starting with newest", "git log"),
    I("Show changes over time for a specific file", "git log -p <file>"),
    I("Who changed what and when in <file>", "git blame <file>")] },
  { n: "04", t: "BRANCHES & TAGS", items: [
    I("List all existing branches", "git branch -av"),
    I("Switch HEAD branch", "git switch <branch>"),
    I("Create a new branch based on your current HEAD", "git branch <new-branch>"),
    I("Create a new tracking branch based on a remote branch", "git checkout --track <remote/branch>"),
    I("Delete a local branch", "git branch -d <branch>"),
    I("Mark the current commit with a tag", "git tag <tag-name>")] },
  { n: "05", t: "UPDATE & PUBLISH", items: [
    I("List all currently configured remotes", "git remote -v"),
    I("Show information about a remote", "git remote show <remote>"),
    I("Add a new remote repository, named <remote>", "git remote add <shortname> <url>"),
    I("Download all changes from <remote>, but don't integrate into HEAD", "git fetch <remote>"),
    I("Download changes and directly merge / integrate into HEAD", "git pull <remote> <branch>"),
    I("Publish local changes on a remote", "git push <remote> <branch>"),
    I("Delete a branch on the remote", "git push <remote> --delete <branch>"),
    I("Publish your tags", "git push --tags")] },
  { n: "06", t: "MERGE & REBASE", items: [
    I("Merge <branch> into your current HEAD", "git merge <branch>"),
    I("Rebase your current HEAD onto <branch>", "git rebase <branch>", "Don't rebase published commits!"),
    I("Abort a rebase", "git rebase --abort"),
    I("Continue a rebase after resolving conflicts", "git rebase --continue"),
    I("Use your configured merge tool to solve conflicts", "git mergetool"),
    I("Use your editor to manually solve conflicts and (after resolving) mark the file as resolved", ["git add <resolved-file>", "git rm <resolved-file>"])] },
  { n: "07", t: "UNDO", items: [
    I("Discard all local changes in your working directory", "git reset --hard HEAD"),
    I("Discard local changes in a specific file", "git checkout HEAD <file>"),
    I("Revert a commit (by producing a new commit with contrary changes)", "git revert <commit>"),
    I("Reset your HEAD pointer to a previous commit … and discard all changes since then", "git reset --hard <commit>"),
    I("…and preserve all changes as unstaged changes", "git reset <commit>"),
    I("…and preserve uncommitted local changes", "git reset --keep <commit>")] }
];

const REFS = [
  ["Pro Git — The Git Bible", "git-scm.com/book"], ["Git Reference Manual", "git-scm.com/docs"],
  ["GitHub Docs", "docs.github.com"], ["GitHub Skills", "skills.github.com"],
  ["Learn Git Branching", "learngitbranching.js.org"], ["The Linux Command Line", "linuxcommand.org/tlcl.php"]
];

// Highlights <placeholders> in green
const pieces = text => text.split(/(<[^>]+>)/).map(p => p.startsWith("<") ? <span class="ph">{p}</span> : p);

function Cmd(props) {
  const [done, setDone] = createSignal(false);
  async function copy() {
    try { await navigator.clipboard.writeText(props.text); setDone(true); setTimeout(() => setDone(false), 1200); } catch {}
  }
  return (
    <button type="button" class="cmdline" onClick={copy} aria-label={"Copy " + props.text}>
      <span class="pr">$</span><code>{pieces(props.text)}</code><span class="cp">{done() ? "copied" : "copy"}</span>
    </button>
  );
}

export default function CheatSheet() {
  const [query, setQuery] = createSignal("");
  const sections = createMemo(() => {
    const q = query().trim().toLowerCase();
    return SECTIONS.map(s => ({ ...s, items: s.items.filter(i => !q || (i.d + " " + i.c.join(" ")).toLowerCase().includes(q)) })).filter(s => s.items.length);
  });

  return (
    <div>
      <div class="row sheet-search"><label for="q">?</label>
        <input id="q" placeholder="search commands, e.g. branch, undo, push" autocomplete="off" spellcheck={false} value={query()} onInput={e => setQuery(e.target.value)} /></div>
      <p class="hint">Tap any command to copy it. Green parts like &lt;branch&gt; are placeholders you replace.</p>

      <div class="sheet">
        <For each={sections()}>{s => (
          <section class="sec">
            <h3><span>{s.n}</span>{s.t}</h3>
            <For each={s.items}>{i => (
              <div class="it">
                <p>{i.d}</p>
                <Show when={i.w}><p class="warn">{i.w}</p></Show>
                <For each={i.c}>{c => <Cmd text={c} />}</For>
              </div>
            )}</For>
          </section>
        )}</For>
      </div>
      <Show when={!sections().length}><p class="empty">No commands match "{query()}".</p></Show>

      <h2>REFERENCES</h2>
      <div class="refs">
        <For each={REFS}>{([name, host]) => (
          <a href={"https://" + host} target="_blank" rel="noopener noreferrer"><b>{name}</b><small>{host}</small></a>
        )}</For>
      </div>
    </div>
  );
}
