#!/usr/bin/env python3
import subprocess, json, sys, os
from datetime import datetime, timezone

CFG_DIR = os.path.expanduser("~/.config/pr-visualizer")

def run_gh(repo_path, args):
    result = subprocess.run(
        ["/opt/homebrew/bin/gh"] + args,
        capture_output=True, text=True, cwd=repo_path
    )
    return result.stdout.strip() if result.returncode == 0 else ""

def get_current_user(repo_path):
    out = run_gh(repo_path, ["api", "user", "--jq", ".login"])
    return out.strip()

def get_repo_info(repo_path):
    result = subprocess.run(
        ["git", "remote", "get-url", "origin"],
        capture_output=True, text=True, cwd=repo_path
    )
    url = result.stdout.strip()
    # HTTPS: https://github.com/owner/repo.git
    if "github.com/" in url:
        parts = url.split("github.com/")[-1].replace(".git", "").split("/")
        if len(parts) >= 2:
            return parts[0], parts[1]
    # SSH con alias: git@github.com-emu:owner/repo.git
    if ":" in url and "/" in url:
        slug = url.split(":")[-1].replace(".git", "")
        parts = slug.split("/")
        if len(parts) >= 2:
            return parts[0], parts[1]
    return None, None

def waiting_since(pr):
    date_str = pr.get("readyForReviewAt") or pr.get("createdAt")
    if not date_str:
        return 0
    dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
    now = datetime.now(timezone.utc)
    return (now - dt).days

def is_human(login):
    return login.endswith("_meli")

def review_summary(reviews):
    states = {"APPROVED": 0, "CHANGES_REQUESTED": 0, "COMMENTED": 0}
    seen = {}
    for r in sorted(reviews, key=lambda x: x.get("submittedAt", "")):
        login = r.get("author", {}).get("login", "")
        state = r.get("state", "")
        if state not in states:
            continue
        # Bots solo cuentan si encuentran issues (CHANGES_REQUESTED)
        if not is_human(login) and state != "CHANGES_REQUESTED":
            continue
        seen[login] = state
    for s in seen.values():
        if s in states:
            states[s] += 1
    return states

def thread_stats(pr, current_user):
    threads = pr.get("reviewThreads", {}).get("nodes", [])
    total = len(threads)
    resolved = sum(1 for t in threads if t.get("isResolved"))
    my_unresolved = sum(
        1 for t in threads
        if not t.get("isResolved")
        and any(c.get("author", {}).get("login") == current_user
                for c in t.get("comments", {}).get("nodes", []))
    )
    return total, resolved, my_unresolved

def serialize_pr(pr, days, reviews, owner, repo_name):
    labels = ",".join(l["name"] for l in pr.get("labels", {}).get("nodes", []))
    rev = review_summary(reviews)
    reviewer_logins = list(dict.fromkeys([
        r.get("author", {}).get("login", "")
        for r in pr.get("reviews", {}).get("nodes", [])
        if is_human(r.get("author", {}).get("login", ""))
    ]))
    return {
        "number": pr["number"],
        "title": pr["title"][:60],
        "author": pr.get("author", {}).get("login", ""),
        "branch": pr.get("headRefName", ""),
        "isDraft": pr.get("isDraft", False),
        "days": days,
        "labels": labels,
        "approved": rev["APPROVED"],
        "changesRequested": rev["CHANGES_REQUESTED"],
        "commented": rev["COMMENTED"],
        "reviewers": reviewer_logins[:5],
        "url": f"https://github.com/{owner}/{repo_name}/pull/{pr['number']}",
        "repo": repo_name,
        "threadsTotal": 0,
        "threadsResolved": 0,
        "myUnresolved": 0
    }

GRAPHQL_QUERY = """
query($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequests(states: OPEN, first: 30, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number
        title
        isDraft
        createdAt
        headRefName
        author { login }
        labels(first: 5) { nodes { name } }
        reviewRequests(first: 10) {
          nodes { requestedReviewer { ... on User { login } } }
        }
        reviews(last: 20) {
          nodes {
            author { login }
            state
            submittedAt
          }
        }
        reviewThreads(first: 30) {
          nodes {
            isResolved
            comments(first: 5) {
              nodes {
                author { login }
              }
            }
          }
        }
      }
    }
  }
}
"""

def fetch_prs(repo_path):
    owner, repo_name = get_repo_info(repo_path)
    if not owner:
        return [], []

    current_user = get_current_user(repo_path)
    if not current_user:
        return [], []

    out = run_gh(repo_path, [
        "api", "graphql",
        "-F", f"owner={owner}",
        "-F", f"repo={repo_name}",
        "-f", f"query={GRAPHQL_QUERY}"
    ])
    if not out:
        return [], []

    try:
        data = json.loads(out)
        nodes = data["data"]["repository"]["pullRequests"]["nodes"]
    except Exception:
        return [], []

    to_review = []
    mine = []

    for pr in nodes:
        author = pr.get("author", {}).get("login", "")
        reviews = pr.get("reviews", {}).get("nodes", [])
        days = waiting_since(pr)

        requested = [
            r.get("requestedReviewer", {}).get("login", "")
            for r in pr.get("reviewRequests", {}).get("nodes", [])
        ]

        my_reviews = [r for r in reviews if r.get("author", {}).get("login", "") == current_user]
        my_review_state = my_reviews[-1]["state"] if my_reviews else None

        pr_data = serialize_pr(pr, days, reviews, owner, repo_name)
        pr_data["myReviewState"] = my_review_state

        # Stats de threads
        t_total, t_resolved, my_unresolved = thread_stats(pr, current_user)
        pr_data["threadsTotal"]    = t_total
        pr_data["threadsResolved"] = t_resolved
        pr_data["myUnresolved"]    = my_unresolved
        # 🔔 si tengo threads sin resolver
        pr_data["ownerResponded"]  = my_unresolved > 0

        if author == current_user:
            mine.append(pr_data)
        else:
            if not requested or current_user in requested:
                to_review.append(pr_data)

    return to_review, mine

def main():
    config_path = os.path.join(CFG_DIR, "config.sh")
    if not os.path.exists(config_path):
        print('{"toReview":[],"mine":[],"error":"NO_CONFIG"}')
        return

    repos_str = ""
    with open(config_path) as f:
        for line in f:
            line = line.strip()
            if line.startswith("PR_REPOS="):
                repos_str = line.split("=", 1)[1].strip().strip('"').strip("'")

    if not repos_str or "yourname" in repos_str:
        print('{"toReview":[],"mine":[],"error":"NO_REPOS"}')
        return

    repo_paths = [p.strip() for p in repos_str.split("|") if p.strip()]

    all_to_review = []
    all_mine = []

    for path in repo_paths:
        if os.path.isdir(path):
            tr, m = fetch_prs(path)
            all_to_review.extend(tr)
            all_mine.extend(m)

    print(json.dumps({"toReview": all_to_review, "mine": all_mine}))

if __name__ == "__main__":
    main()
