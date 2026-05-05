// pr-visualizer.widget/index.jsx
import { run } from 'uebersicht';

export const command = `
CACHE="/tmp/pr_cache.json"
CACHE_AGE=$(( $(date +%s) - $(stat -f %m "$CACHE" 2>/dev/null || echo 0) ))
DOW=$(date +%u)
HOUR=$(date +%H)
WORK_HOURS=$([ "$DOW" -le 5 ] && [ "$HOUR" -ge 8 ] && [ "$HOUR" -lt 18 ] && echo 1 || echo 0)
if [ ! -f "$CACHE" ] || ([ "$WORK_HOURS" = "1" ] && [ "$CACHE_AGE" -gt 3600 ]); then
    python3 "$HOME/.config/pr-visualizer/check_prs.py" > "$CACHE" 2>/dev/null &
fi
cat "$CACHE" 2>/dev/null || echo '{"toReview":[],"mine":[]}'
EXPANDED=$([ -f /tmp/pr_expanded ] && echo 1 || echo 0)
DRAFTS=$([ -f /tmp/pr_drafts ] && echo 1 || echo 0)
SELECTED=$(cat /tmp/pr_selected 2>/dev/null || echo "")
echo "STATE:$EXPANDED:$DRAFTS:$SELECTED"
`;

export const refreshFrequency = 2000;

export const render = ({ output, error }) => {
  if (!output) return null;

  var lines = output.trim().split("\n");
  var jsonLine = "";
  var expanded = false;
  var showDrafts = false;

  var selectedPR = null;
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].indexOf("STATE:") === 0) {
      var parts = lines[i].split(":");
      expanded   = parts[1] === "1";
      showDrafts = parts[2] === "1";
      selectedPR = parts[3] ? parseInt(parts[3]) : null;
    } else if (lines[i].indexOf("{") === 0) {
      jsonLine = lines[i];
    }
  }

  var hasError = false;
  var toReview = [];
  var mine = [];

  if (jsonLine) {
    try {
      var data = JSON.parse(jsonLine);
      if (data.error) hasError = true;
      toReview = data.toReview || [];
      mine = data.mine || [];
    } catch(e) {}
  }

  var currentUser = mine.length > 0 ? mine[0].author : "";
  var allPRs = toReview.concat(mine);
  var allVisible = showDrafts ? allPRs : allPRs.filter(function(p){ return !p.isDraft; });
  var totalDrafts = allPRs.filter(function(p){ return p.isDraft; }).length;

  function sortPRs(prs) {
    return prs.slice().sort(function(a, b) {
      var aMe = a.author === currentUser ? 1 : 0;
      var bMe = b.author === currentUser ? 1 : 0;
      if (aMe !== bMe) return aMe - bMe;
      return a.author.localeCompare(b.author);
    });
  }

  var isEmpty = !hasError && allPRs.length === 0;
  var hasResponses = allVisible.some(function(p){ return p.ownerResponded; });

  function groupByRepo(prs) {
    var groups = {};
    prs.forEach(function(pr) {
      var repo = pr.repo || "unknown";
      if (!groups[repo]) groups[repo] = [];
      groups[repo].push(pr);
    });
    return Object.keys(groups).map(function(repo) {
      var prs = groups[repo].sort(function(a, b) {
        var aReviewed = a.myReviewState ? 1 : 0;
        var bReviewed = b.myReviewState ? 1 : 0;
        return aReviewed - bReviewed || a.author.localeCompare(b.author);
      });
      return { repo: repo, prs: prs };
    });
  }

  function reviewIcon(s) {
    if (s === "APPROVED")          return "✅";
    if (s === "CHANGES_REQUESTED") return "🔁";
    if (s === "COMMENTED")         return "✍️";
    return "👁";
  }

  function daysLabel(d) {
    return d === 0 ? "hoy" : d === 1 ? "1d" : d + "d";
  }

  function PRRow(props) {
    var pr = props.pr;
    var myReview = props.myReview;
    var isSelected = selectedPR === pr.number;
    var isWaiting = !!props.myReview && !pr.ownerResponded;
    var isOwn = !!props.isOwn;

    function toggleSelect(e) {
      e.stopPropagation();
      run(isSelected ? 'rm -f /tmp/pr_selected' : 'echo "' + pr.number + '" > /tmp/pr_selected');
    }

    return (
      <div className={"pr-row-wrap" + (isSelected ? " pr-selected" : "") + (isWaiting ? " pr-reviewed" : "") + (isOwn ? " pr-own" : "")}>
        <div className="pr-row" data-tooltip={"@" + pr.author + "\n" + pr.branch} onClick={toggleSelect}>
          <span className="pr-num">
          #{pr.number}
          {pr.ownerResponded && <span className="pr-responded" title="El owner respondió">🔔</span>}
        </span>
          {pr.isDraft && <span className="pr-draft">draft </span>}
          <span className="pr-title">{pr.title}</span>
          <span className="pr-meta">
            <span className="pr-days">{daysLabel(pr.days)}</span>
            {pr.threadsTotal > 0 && (
              <span className="pr-stat" style={{opacity: pr.threadsResolved === pr.threadsTotal ? 0.4 : 1}}>
                {"🧵" + pr.threadsResolved + "/" + pr.threadsTotal}
              </span>
            )}
            {pr.approved > 0         && <span className="pr-stat">{"✅" + pr.approved}</span>}
            {pr.changesRequested > 0 && <span className="pr-stat">{"🔁" + pr.changesRequested}</span>}
            {pr.commented > 0        && <span className="pr-stat">{"💬" + pr.commented}</span>}
            {pr.approved === 0 && pr.changesRequested === 0 && pr.commented === 0 && pr.threadsTotal === 0
              && <span className="pr-stat" style={{opacity:0.4}}>😶</span>}
            {myReview && <span className="pr-my">{reviewIcon(myReview)}</span>}
          </span>
          <span className="pr-chevron">{isSelected ? "▲" : "▼"}</span>
        </div>

        {isSelected && (
          <div className="pr-detail">
            <div className="pr-detail-title">
              {pr.title}
              <span className="pr-icon-btn pr-icon-link" title="Abrir en GitHub"
                style={{marginLeft:"8px", fontSize:"14px"}}
                onClick={function(){ run('open "' + pr.url + '"'); }}>↗</span>
            </div>
            <div className="pr-detail-row">
              <span className="pr-detail-label">⎇</span>
              <span className="pr-detail-value">{pr.branch}</span>
              <span className="pr-icon-btn" title="Copiar rama" onClick={function(){ run('echo "' + pr.branch + '" | pbcopy'); }}>⧉</span>
            </div>
            <div className="pr-detail-row">
              <span className="pr-detail-label">#</span>
              <span className="pr-detail-value">{pr.number}</span>
              <span className="pr-icon-btn" title="Copiar número" onClick={function(){ run('echo "' + pr.number + '" | pbcopy'); }}>⧉</span>
            </div>
            <div className="pr-detail-row">
              <span className="pr-detail-label">👤</span>
              <span className="pr-detail-value">@{pr.author}</span>
            </div>
            {pr.reviewers && pr.reviewers.length > 0 && (
              <div className="pr-detail-row">
                <span className="pr-detail-label">👁</span>
                <span className="pr-detail-value" style={{whiteSpace:"normal"}}>{pr.reviewers.join(", ")}</span>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{
      position: "absolute",
      top: "calc(100vh - 30px)",
      left: "calc(100vw - 30px)",
      transform: "translate(-100%, -100%)",
      fontFamily: "-apple-system, system-ui"
    }}>
      <style>{`
        .pr-panel {
          background: rgba(0,0,0,0.65);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 16px;
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          color: white;
          min-width: 280px;
          max-width: 440px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        }
        .pr-badge {
          padding: 8px 14px; cursor: pointer;
          display: flex; align-items: center; gap: 8px;
          font-size: 15.6px; font-weight: 600;
          white-space: nowrap; user-select: none;
        }
        .pr-badge:hover { background: rgba(255,255,255,0.05); border-radius: 16px; }
        .pr-refresh {
          font-size: 14px; opacity: 0.3; cursor: pointer;
          transition: opacity 0.15s; user-select: none; margin-left: 2px;
        }
        .pr-refresh:hover { opacity: 1; }
        .pr-count { border-radius: 8px; padding: 2px 7px; font-size: 14.4px; }
        .pr-count.review { background: rgba(251,191,36,0.2); color: #FCD34D; }
        .pr-count.mine   { background: rgba(96,165,250,0.2); color: #93C5FD; }
        .pr-body { padding: 0 12px 12px; max-height: 60vh; overflow-y: auto; }
        .pr-body::-webkit-scrollbar { width: 4px; }
        .pr-body::-webkit-scrollbar-track { background: transparent; }
        .pr-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }
        .pr-toggle {
          font-size: 12px; color: rgba(255,255,255,0.4);
          cursor: pointer; padding: 4px 0; user-select: none;
        }
        .pr-toggle:hover { color: rgba(255,255,255,0.7); }
        .pr-section { margin-top: 10px; }
        .pr-repo-title {
          font-size: 10px; font-weight: 700; letter-spacing: 0.5px;
          color: rgba(255,255,255,0.5); margin: 8px 0 4px;
          padding-bottom: 3px; border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .pr-section-title {
          font-size: 10.8px; font-weight: 700; letter-spacing: 1px;
          color: rgba(255,255,255,0.35); margin-bottom: 6px;
        }
        .pr-row {
          display: flex; align-items: center; gap: 6px;
          padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.06);
          font-size: 14.4px; position: relative; cursor: pointer;
        }
        .pr-row:last-child { border-bottom: none; }
        .pr-row:hover { background: rgba(255,255,255,0.04); border-radius: 6px; }
        .pr-num { font-size: 12px; color: rgba(255,255,255,0.35); flex-shrink: 0; font-family: monospace; display: flex; align-items: center; gap: 3px; }
        .pr-responded { font-size: 11px; }
        .pr-draft { font-size: 10.8px; color: rgba(255,255,255,0.35); flex-shrink: 0; }
        .pr-title {
          flex: 1; white-space: nowrap; overflow: hidden;
          text-overflow: ellipsis; color: rgba(255,255,255,0.85);
        }
        .pr-meta { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
        .pr-days { color: rgba(255,255,255,0.4); font-size: 12px; }
        .pr-stat { font-size: 13.2px; }
        .pr-my {
          background: rgba(255,255,255,0.1);
          border-radius: 4px; padding: 1px 4px; font-size: 12px;
        }
        .pr-row-wrap { border-bottom: 1px solid rgba(255,255,255,0.06); }
        .pr-row-wrap:last-child { border-bottom: none; }
        .pr-row-wrap .pr-row { border-bottom: none; }
        .pr-selected { background: rgba(255,255,255,0.04); border-radius: 8px; }
        .pr-reviewed { opacity: 0.45; }
        .pr-reviewed:hover { opacity: 0.75; }
        .pr-own .pr-num { color: #93C5FD; }
        .pr-own .pr-title { color: #93C5FD; opacity: 0.9; }
        .pr-chevron { font-size: 9px; opacity: 0.35; margin-left: 4px; flex-shrink: 0; }
        .pr-detail {
          padding: 8px 10px 10px;
          border-top: 1px solid rgba(255,255,255,0.06);
          margin: 0 2px;
        }
        .pr-detail-title {
          font-size: 12px; color: rgba(255,255,255,0.7);
          margin-bottom: 8px; line-height: 1.4;
        }
        .pr-detail-row {
          display: flex; align-items: center; gap: 8px;
          margin-bottom: 5px; font-size: 11px;
        }
        .pr-detail-label { color: rgba(255,255,255,0.35); flex-shrink: 0; width: 40px; }
        .pr-detail-value {
          color: rgba(255,255,255,0.7); flex: 1;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          font-family: monospace; font-size: 11px;
        }
        .pr-icon-btn {
          cursor: pointer; color: rgba(255,255,255,0.35);
          font-size: 15px; flex-shrink: 0; user-select: none;
          transition: color 0.15s;
        }
        .pr-icon-btn:hover { color: white; }
        .pr-detail-actions { margin-top: 10px; }
        .pr-icon-link {
          font-size: 18px; color: rgba(96,165,250,0.6);
        }
        .pr-icon-link:hover { color: #93C5FD; }
        .pr-row::after {
          content: attr(data-tooltip);
          position: absolute; bottom: calc(100% + 4px); left: 0;
          background: rgba(0,0,0,0.92); color: rgba(255,255,255,0.85);
          font-size: 12px; padding: 5px 10px; border-radius: 6px;
          white-space: pre-line; pointer-events: none;
          opacity: 0; transition: opacity 0.15s;
          border: 1px solid rgba(255,255,255,0.1); z-index: 10;
        }
        .pr-row:hover::after { opacity: 1; }
      `}</style>

      <div className="pr-panel">
        <div className="pr-badge"
          onClick={function(){ run(expanded ? 'rm -f /tmp/pr_expanded /tmp/pr_selected' : 'touch /tmp/pr_expanded'); }}>
          <span>🔀</span>
          {hasResponses && <span title="Hay PRs con respuesta del owner">🔔</span>}
          {hasError && <span style={{color:"rgba(255,255,255,0.5)", fontSize:"12px"}}>configurar repos →</span>}
          {isEmpty  && <span style={{color:"rgba(255,255,255,0.5)", fontSize:"12px"}}>sin PRs 🎉</span>}
          {!hasError && !isEmpty && <span className="pr-count review">{toReview.filter(function(p){return !p.isDraft;}).length} revisar</span>}
          {!hasError && !isEmpty && <span className="pr-count mine">{mine.filter(function(p){return !p.isDraft;}).length} míos</span>}
          <span style={{marginLeft:"auto", opacity:0.4, fontSize:"10px"}}>{expanded ? "▲" : "▼"}</span>
          <span className="pr-refresh" title="Refrescar ahora"
            onClick={function(e){ e.stopPropagation(); run('/bin/rm -f /tmp/pr_cache.json /tmp/pr_cache_lock'); }}>↺</span>
        </div>

        {expanded && hasError && (
          <div className="pr-body">
            <div style={{fontSize:"11px", color:"rgba(255,255,255,0.5)", padding:"8px 0", lineHeight:"1.6"}}>
              Editá ~/.config/pr-visualizer/config.sh<br/>
              y agregá las rutas de tus repos locales.
            </div>
          </div>
        )}
        {expanded && !hasError && (
          <div className="pr-body">
            {totalDrafts > 0 && (
              <div className="pr-toggle"
                onClick={function(){ run('[ -f /tmp/pr_drafts ] && rm /tmp/pr_drafts || touch /tmp/pr_drafts'); }}>
                {showDrafts ? "▾ ocultar drafts" : "▸ mostrar " + totalDrafts + " draft" + (totalDrafts > 1 ? "s" : "")}
              </div>
            )}
            {allVisible.length > 0
              ? groupByRepo(allVisible).map(function(g) { return (
                  <div key={g.repo} className="pr-section">
                    <div className="pr-repo-title">{g.repo}</div>
                    {sortPRs(g.prs).map(function(pr){
                      return <PRRow key={pr.number} pr={pr} myReview={pr.myReviewState} isOwn={pr.author === currentUser} />;
                    })}
                  </div>
                ); })
              : <div style={{padding:"8px 0", color:"rgba(255,255,255,0.4)", fontSize:"12px"}}>Sin PRs activos 🎉</div>
            }
          </div>
        )}
      </div>
    </div>
  );
};
