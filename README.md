# pr-visualizer

Übersicht widget for macOS that gives you a live summary of open GitHub PRs across multiple repos — without opening the browser.

![Widget showing collapsed badge and expanded PR list]

---

## What it shows

A collapsible panel in the bottom-right corner of your desktop:

**Collapsed (badge):**
```
🔀  12 revisar  4 míos  🔔  ↺
```
- `12 revisar` — open PRs needing your review
- `4 míos` — your own open PRs
- `🔔` — you have unresolved review threads
- `↺` — manual refresh button

**Expanded (per repo, sorted by author):**
```
fury_condor
  #1739  Backport from hotfix...     🧵1/1  ✅1
  #1666  [ADD] domain-level DNS...   🧵4/14 💬6  🔔
  #1716  fix(deploy-office)...       🧵0/0  💬1      ← your PR (blue)
```

**PR indicators:**
| Indicator | Meaning |
|-----------|---------|
| `🧵3/5` | 3 of 5 review threads resolved |
| `✅2` | 2 approvals |
| `🔁1` | 1 reviewer requested changes |
| `💬4` | 4 human reviewers commented |
| `😶` | No review activity yet |
| `🔔` | You have unresolved threads |
| `✍️` | You already reviewed this PR |

**Click interactions:**
- **Click badge** → expand/collapse panel
- **Click PR row** → expand inline detail
- **`↗`** in detail → open PR in browser
- **`⎇` `#` copy buttons** → copy branch or PR number
- **`↺`** → force refresh GitHub data

---

## Prerequisites

- [Übersicht](https://tracesof.net/uebersicht/) — desktop widget engine
- [Homebrew](https://brew.sh/)
- `gh` CLI authenticated with your GitHub account — `brew install gh && gh auth login`
- Python 3 — included with macOS
- Local clones of the repos you want to monitor

---

## Installation

**1. Clone into your Übersicht widgets folder:**
```bash
git clone https://github.com/lehentao/mac-pr-widget.git \
  ~/Library/Application\ Support/Übersicht/widgets/pr-visualizer.widget
```

**2. Create config directory and copy files:**
```bash
mkdir -p ~/.config/pr-visualizer
cp ~/Library/Application\ Support/Übersicht/widgets/pr-visualizer.widget/config.example.sh \
   ~/.config/pr-visualizer/config.sh
cp ~/Library/Application\ Support/Übersicht/widgets/pr-visualizer.widget/check_prs.py \
   ~/.config/pr-visualizer/check_prs.py
```

**3. Edit your config:**
```bash
nano ~/.config/pr-visualizer/config.sh
```

**4. Refresh Übersicht** (`⌘R`)

---

## Configuration

Edit `~/.config/pr-visualizer/config.sh` (never committed — personal data stays local):

```bash
# Absolute paths to local git repos, separated by |
PR_REPOS="/Users/yourname/repos/repo-1|/Users/yourname/repos/repo-2"

# Show draft PRs by default
PR_SHOW_DRAFTS=false
```

### Finding your repo paths

```bash
# Where did you clone your repos?
ls ~/repos/
# or
ls ~/Repos/
```

Each path must be a local git clone with a GitHub remote (`origin`). The widget reads the remote URL to determine owner/repo for the GraphQL query.

---

## Authentication

The widget uses `gh` CLI from the directory of each configured repo, so it automatically picks up the correct GitHub account for each remote.

```bash
# Check which account gh uses for a specific repo
cd /path/to/your/repo
gh api user --jq .login
```

If you use multiple GitHub accounts (e.g. corporate + personal), configure SSH host aliases in `~/.ssh/config` and set your remotes accordingly — `gh` resolves authentication from the remote URL.

---

## Bot filtering

The widget filters bots from reviewer counts and displays. Any GitHub user whose login does **not** end in `_meli` is treated as a bot. Bots only count in stats if they post `CHANGES_REQUESTED`.

To adapt this rule for your organization, edit the `is_human()` function in `check_prs.py`:

```python
def is_human(login):
    return login.endswith("_meli")  # ← change this rule
```

---

## Data refresh

GitHub data is fetched **once per hour**, only on **weekdays between 8AM–6PM**. The widget UI (expand/collapse, PR selection) refreshes every 2 seconds from a local cache.

**To force a refresh at any time:** click the `↺` button in the badge.

The cache lives at `/tmp/pr_cache.json` and is cleared on restart.

---

## Troubleshooting

**Widget doesn't appear:**
- Check that Übersicht is running
- Run `⌘R` in Übersicht to refresh all widgets

**"configurar repos →" message:**
- Edit `~/.config/pr-visualizer/config.sh` with real repo paths
- Click `↺` to force a refresh

**PRs not showing:**
```bash
# Test the script directly
python3 ~/.config/pr-visualizer/check_prs.py
```

**Wrong GitHub account:**
```bash
cd /path/to/your/repo
gh api user --jq .login   # should show your account
```
