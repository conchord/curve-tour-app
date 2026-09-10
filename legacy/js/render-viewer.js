// render-viewer.js — viewer-facing tabs: Scoreboard, Bracket, Players,
// Rankings (including the PNG export), and the auto-refresh interval that
// keeps Scoreboard/Bracket live for a viewer who never touches Admin.

// Shared standings-table renderer for both cumulative-standings pooling
// phases — the accumulation (T.qualTable) is identical in mechanism for
// Qualification Table and Swiss (see isStandingsRound/updateQualTable), only
// the title and the "played / of how many" denominator differ, so this stays
// one function with a small phase-driven branch rather than two near-
// duplicates. Named for what it now does (render the standings table,
// whichever phase produced it), not for "qual" specifically, since that name
// would be actively misleading once it's just as often showing Swiss
// standings — same renaming precedent as classicEliminationBuildProgression
// -> composedBuildProgression.
function renderStandingsTable() {
  var qualAdv = T.cfg.qualAdv || 24;
  var descriptor = getGamemodeDescriptor();
  var isSwiss = T.cfg.poolingPhase === 'swiss';
  var totalPoolRounds = isSwiss
    ? ((descriptor.config && descriptor.config.swissRounds) || MIN_SWISS_ROUNDS)
    : ((descriptor.config && descriptor.config.qualRounds) || QUAL_ROUNDS);
  // Only meaningful (and only actually blocks advanceRound()) on the last
  // standings round — showing it earlier would flag a "tie" based on
  // incomplete cumulative totals that's very likely to resolve itself once
  // the remaining pooling rounds are played.
  var cr = T.rounds[T.curRound];
  var isLastStandingsRound = cr && T.cfg.poolingPhase !== 'none' && isStandingsRound(cr) &&
    !(T.rounds[T.curRound + 1] && isStandingsRound(T.rounds[T.curRound + 1]));
  var cutoffTie = isLastStandingsRound ? detectQualCutoffTie() : null;
  var tiedNames = cutoffTie && !isTieResolved(cutoffTie.key, cutoffTie) ? cutoffTie.players.map(p => p.name) : [];
  var title = isSwiss ? 'Swiss Standings' : 'Qualification Table';
  var html = '<div class="card"><div class="card-title">' + title + ' <span style="color:var(--muted);font-weight:400;font-size:10px">— lower Fair Points = better</span></div>' +
    '<div style="overflow-x:auto"><table class="gs-table"><thead><tr>' +
    `<th>#</th><th>${esc(descriptor.format.unitLabel)}</th><th>Fair Points</th><th>Total Score</th><th>Rounds</th><th>Status</th>` +
    '</tr></thead><tbody>';
  T.qualTable.forEach((p, i) => {
    var rank = i + 1, passes = rank <= qualAdv;
    var isTied = tiedNames.indexOf(p.name) !== -1;
    html += `<tr class="${isTied?'tie-row':passes?'pass-row':'out-row'}">
      <td><span class="rank-cell">${rank}</span></td>
      <td>${renderUnitCell(T, p.name, false)}</td>
      <td><span class="pts-cell">${p.totalFP !== null ? p.totalFP.toFixed(5) : '—'}</span></td>
      <td>${p.totalScore || 0}</td>
      <td>${p.played}/${totalPoolRounds}</td>
      <td>${isTied ? '<span class="pill pill-tie">⚠ Tie</span>' :
           p.totalFP===null ? '<span class="pill pill-neut">No scores</span>' :
           passes ? '<span class="pill pill-adv">✔ Advances</span>' :
                    '<span class="pill pill-elim">✘ Eliminated</span>'}</td></tr>`;
  });
  html += '</tbody></table></div></div>';
  return html;
}

// Genuinely new renderer, not forced into renderStandingsTable()'s
// single-list assumption (see "Group stage" in HANDOFF.md, Part 5) — K
// separate small tables, one per group, each shaped like the standings
// table above but headed "Group A"/"Group B"/... and cut at
// qualifiersPerGroup instead of one global qualAdv. No "played / of N"
// column here (unlike renderStandingsTable()'s) — a mixed group-size
// distribution can give different groups genuinely different round-robin
// lengths (see "Group stage" in HANDOFF.md), so one shared denominator
// would misrepresent some groups' own totals; each row's `played` count
// alone is still shown, just without an implied common denominator.
function renderGroupStandingsTables() {
  var descriptor = getGamemodeDescriptor();
  var qpg = T.cfg.qualifiersPerGroup || 2;
  var cr = T.rounds[T.curRound];
  var isLastGroupStageRound = cr && cr.isGroupStage && !(T.rounds[T.curRound + 1] && T.rounds[T.curRound + 1].isGroupStage);
  var html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">';
  T.groups.forEach(g => {
    var table = T.groupStandings[g.label] || [];
    var cutoffTie = isLastGroupStageRound ? detectGroupCutoffTie(g.label) : null;
    var tiedNames = cutoffTie && !isTieResolved(cutoffTie.key, cutoffTie) ? cutoffTie.players.map(p => p.name) : [];
    html += '<div class="card"><div class="card-title">Group ' + esc(g.label) + ' <span style="color:var(--muted);font-weight:400;font-size:10px">— lower FP = better</span></div>' +
      '<div style="overflow-x:auto"><table class="gs-table"><thead><tr>' +
      `<th>#</th><th>${esc(descriptor.format.unitLabel)}</th><th>FP</th><th>Score</th><th>Pld</th><th>Status</th>` +
      '</tr></thead><tbody>';
    table.forEach((p, i) => {
      var rank = i + 1, passes = rank <= qpg;
      var isTied = tiedNames.indexOf(p.name) !== -1;
      html += `<tr class="${isTied?'tie-row':passes?'pass-row':'out-row'}">
        <td><span class="rank-cell">${rank}</span></td>
        <td>${renderUnitCell(T, p.name, false)}</td>
        <td><span class="pts-cell">${p.totalFP !== null ? p.totalFP.toFixed(5) : '—'}</span></td>
        <td>${p.totalScore || 0}</td>
        <td>${p.played}</td>
        <td>${isTied ? '<span class="pill pill-tie">⚠ Tie</span>' :
             p.totalFP===null ? '<span class="pill pill-neut">No scores</span>' :
             passes ? '<span class="pill pill-adv">✔ Advances</span>' :
                      '<span class="pill pill-elim">✘ Eliminated</span>'}</td></tr>`;
    });
    html += '</tbody></table></div></div>';
  });
  html += '</div>';
  return html;
}

// ═══════════════════════════════════════════════════════════════
// SCOREBOARD & BRACKET — Scoreboard (live only; shows the current round,
//  partial scores included — unlike Bracket, does not gate on completion)
// ═══════════════════════════════════════════════════════════════
// One row per roster unit — a player for individual formats, a team (name +
// derived score) for team formats; see renderUnitCell()/getUnitScore().
function renderScoreboard() {
  if (!T.rounds.length) return;
  document.getElementById('sb-empty').style.display = 'none';
  document.getElementById('sb-content').style.display = 'block';

  var formatDescriptor = getGamemodeDescriptor().format;
  var ri = T.curRound, round = T.rounds[ri], asgn = T.assignments[ri] || [];
  var lbl = round.isFinal ? '🏆 Grand Final' : round.isSemis ? '⚔ Semi-Finals' : 'Round '+round.roundNum;
  document.getElementById('sb-summary').innerHTML =
    statEl('Round', lbl, 'cyan') + statEl(formatDescriptor.unitLabelPlural, asgn.length) +
    statEl('Rooms', round.rooms.length) +
    statEl('Advancing', round.isNoElim?'All':(round.isFinal?'—':round.advTotal));

  var sqt = document.getElementById('sb-qual-table');
  if (T.rounds.slice(0, ri + 1).some(r => r.isGroupStage)) {
    sqt.style.display = 'block'; sqt.innerHTML = renderGroupStandingsTables();
  } else if (T.cfg.poolingPhase !== 'none' && T.rounds.slice(0, ri + 1).some(r => isStandingsRound(r))) {
    sqt.style.display = 'block'; sqt.innerHTML = renderStandingsTable();
  } else sqt.style.display = 'none';

  var lls = computeLuckyLosers(ri, round);
  var html = '';
  for (var rm = 1; rm <= round.rooms.length; rm++) {
    var players = asgn.filter(a => a.room === rm);
    var thisAdv = round.isNoElim || round.isFinal ? players.length : round.advPerRoom;
    var withScores = players.map((p, pi) => ({ name: p.name, score: getUnitScore(T, ri, rm, pi, null) }));
    var ranked = orderRoomByScore(withScores.filter(p => p.score !== null), ri, rm)
      .concat(withScores.filter(p => p.score === null));
    var sbRoomHeading = round.isGroupStage ? 'Group ' + esc(round.roomGroups[rm - 1]) + ' · Room ' + roomLabel(rm) : 'Room ' + roomLabel(rm);
    html += `<div class="room-block"><div class="room-header"><div class="room-name">${sbRoomHeading}</div><div class="room-meta">Top ${round.isNoElim?'all':thisAdv} advance</div></div>
      <table><thead><tr><th>Pos</th><th>${esc(formatDescriptor.unitLabel)}</th><th>Score</th><th>Status</th></tr></thead><tbody>`;
    ranked.forEach((p, i) => {
      // A lucky-loser candidate merges cleanly into "Advances" here — the
      // ★ Lucky Loser badge is Bracket's job now (on the round where the
      // decision actually happened), not Scoreboard's, which only ever
      // shows "the only thing that matters is that they're qualified."
      var rank = i + 1, adv = round.isNoElim || rank <= thisAdv || lls.includes(p.name);
      var cls = p.score !== null ? (adv ? 'adv-row' : 'elim-row') : '';
      var pill = p.score === null ? '<span class="pill pill-neut">—</span>' :
                 adv ? '<span class="pill pill-adv">Advances</span>' :
                       '<span class="pill pill-elim">Eliminated</span>';
      html += `<tr class="${cls}"><td><span class="pos-num${p.score!==null&&adv?' top':''}">${p.score!==null?rank:'—'}</span></td>
        <td>${renderUnitCell(T, p.name, true, ri)}</td><td style="font-family:var(--font-d);font-size:18px;font-weight:700">${p.score!==null?p.score:'—'}</td>
        <td>${pill}</td></tr>`;
    });
    html += '</tbody></table></div>';
  }
  // Bye recipient for this round ("Bye" odd-count strategy) — advancing, no
  // score, and never inside any room's table above (a room:null entry never
  // matches the per-room filter those tables are built from).
  if (T.byes && T.byes[ri] && T.byes[ri].length) {
    T.byes[ri].forEach(function (byeUnit) {
      html += `<div class="sb-bye-card"><span class="sb-bye-label">BYE</span><span class="sb-bye-name">${esc(unitDisplay(T, byeUnit).label)}</span><span class="pill pill-adv" style="margin-left:auto">Advances</span></div>`;
    });
  }
  document.getElementById('sb-rooms').innerHTML = html;
}

// --- Scoreboard & Bracket: Bracket Overview ---
// SHARED builder below (buildBracketHtml) — pure HTML builder that takes any
// tournament-shaped state object (the live T, or an archived snapshot) and
// returns the bracket columns markup. No DOM access here, so it's safe to
// reuse for the read-only Archive detail view (see ARCHIVE RENDERING).
// renderBracket() further down is the live-only DOM-writing wrapper.
// state carries gameFormat/scheduleLogic/gamemodeConfig alongside the rest of
// the tournament data (live T or an archived snapshot), so a format-aware
// label change here would read state.gameFormat the same way computeRankings
// already reads other state fields — no separate parameter needed. No
// dynamic "Player" text exists in this builder's output today (bracket cards
// show names directly, no table header), so there's nothing to wire up yet.
// Round column labels ("WB Round 1", "LB Round 2", "⚔ Semis", ...) — one
// array entry per state.rounds[ri], computed once here rather than inline
// inside buildBracketHtml()'s own loop, so any OTHER caller needing a
// round's exact on-screen label (buildFollowBannerHtml() below, previously
// via the simpler bracketRoundName()) can't drift out of sync with what the
// column header actually shows. Was previously two separate label
// derivations — a real, if cosmetic, bug: the Follow banner could say
// "Round 4" for a round the column itself labelled "LB Round 2". Derived
// at render time from round.bracket rather than stored per round, same
// "compute from existing structure" preference as the rest of this app
// (see "Double elimination" Part 5 in HANDOFF.md).
function bracketRoundLabels(state) {
  var wbCounter = 0, lbCounter = 0;
  return state.rounds.map(function (round) {
    if (round.bracket === 'winners') { wbCounter++; return { label: 'WB Round ' + wbCounter, hdrAccentCls: ' wb-hdr' }; }
    if (round.bracket === 'losers') { lbCounter++; return { label: 'LB Round ' + lbCounter, hdrAccentCls: ' lb-hdr' }; }
    if (round.bracket === 'grand-final') { return { label: '🏆 Grand Final', hdrAccentCls: ' gf-hdr' }; }
    var label = round.isFinal ? '🏆 Final' : round.isSemis ? '⚔ Semis' :
             round.isQual ? 'Round '+round.roundNum+' (Qual)' :
             round.isSwiss ? 'Round '+round.roundNum+' (Swiss)' :
             round.isGroupStage ? 'Round '+round.roundNum+' (Group)' : 'Round '+round.roundNum;
    return { label: label, hdrAccentCls: '' };
  });
}

function buildBracketHtml(state, collapseMap, follow, editable) {
  var html = '';
  var teamSize = getGamemodeDescriptorFor(state).format.teamSize;
  var roundLabels = bracketRoundLabels(state);
  state.rounds.forEach((round, ri) => {
    var asgn = state.assignments[ri] || [];
    var isCurrent = ri === state.curRound;
    // "editable" says the current round qualifies for score entry at all
    // (isAdminUnlocked() + started + Mechanism-A check — see
    // bracketScoreEntryAllowed()); isCurrent confines it to this one column,
    // matching Admin's own "only the round being played" boundary. A
    // multi-game Semis round (2026-09-08, "Multi-game Semis" in
    // HANDOFF_LOG.md — round.isFinal excludes the Final's own, separately-
    // handled Mechanism B) is deliberately excluded here too: without this,
    // an admin editing from Bracket would write to the unsuffixed key
    // getUnitScore() no longer reads once a round is multi-game, silently
    // losing the score (it "saves" with no error, never counts toward the
    // total). Falls back to the existing read-only display below instead —
    // editable multi-game entry from Bracket is a deliberate follow-up, not
    // built here, mirroring how Finals multi-game entry was Admin-only first.
    var rowsEditable = !!editable && isCurrent && !(round.numGames > 1 && !round.isFinal);
    var isPast    = ri < state.curRound;
    // Lucky-loser record for round ri's OWN card: T.luckyLosers[X] is
    // written by whichever round's advancement fed unit(s) INTO round X —
    // i.e. it's the record of who was saved advancing OUT OF round ri, which
    // is exactly the round whose card should show it (the decision happened
    // because of ri's own results, not X's — by the next round it's
    // irrelevant that someone got there as a lucky loser). Round X's card
    // intentionally never looks at luckyLosers at all; a unit who arrived as
    // a lucky loser is shown there exactly like any other participant.
    // X is ri+1 for every non-bracket round (advanceRound()'s generic path
    // always advances strictly sequentially) — but for a WB/LB round, X is
    // round.winnersTo specifically, NOT necessarily ri+1: an interposed
    // round from the other bracket can sit between a WB/LB round and its own
    // winnersTo target in T.rounds' array order (see the topology comment
    // above doubleEliminationBracketPhase in js/bracket-phases.js). Found and
    // fixed 2026-09-08 during Stage B4's rendering-verification pass — the
    // bare ri+1 lookup silently missed every WB/LB lucky-loser winner
    // whenever their own winnersTo wasn't literally the next array slot.
    var luckyLookupIdx = (round.winnersTo !== null && round.winnersTo !== undefined) ? round.winnersTo : ri + 1;
    var lls = state.luckyLosers[luckyLookupIdx] || [];

    // Tie-break badge (new — first time this appears in Bracket): every
    // participant belonging to a cluster this round has an entry for in
    // state.tieResolutions (i.e. was actually surfaced/addressed) gets a
    // small "TB" marker on round ri's own card, same "belongs to this
    // round's own outcome" rule as the lucky-loser marker above.
    var tieClusters = detectTieBreaks(ri, round, state);
    var tbNames = new Set();
    Object.keys(state.tieResolutions || {}).forEach(k => {
      if (k.indexOf(`r${ri}-`) !== 0) return;
      var cluster = tieClusters[k];
      if (cluster) cluster.players.forEach(p => tbNames.add(p.name));
    });

    // Unresolved-tie indicator (new): per-room ties AND qual/group cutoff
    // ties, both surfaced via the now state-parameterized getAllTies()/
    // isTieResolved() so this is safe to call from Archive's read-only
    // snapshot render too, without mutating live T — see "Bracket:
    // unresolved-tie indicator" in HANDOFF_LOG.md.
    var allTies = getAllTies(ri, round, state);
    var unresolvedTieNames = new Set();
    Object.keys(allTies).forEach(k => {
      if (isTieResolved(k, allTies[k], state)) return;
      allTies[k].players.forEach(p => unresolvedTieNames.add(p.name));
    });

    var rLabel = roundLabels[ri].label;
    var hdrAccentCls = roundLabels[ri].hdrAccentCls;
    // renderBracketNow() is the only caller that ever passes a collapseMap,
    // and it now includes an entry for EVERY round (2026-09-07) — so any
    // round can be folded manually, current and future included. Archive's
    // own buildBracketHtml(snap) call passes no collapseMap at all, so
    // nothing is collapsible there, which is still correct: an archived
    // tournament has no per-browser collapse state to toggle against. What's
    // collapsed by DEFAULT is still past-round-biased — see
    // bracketRoundDefaultCollapsed().
    var isCollapsible = collapseMap && collapseMap.hasOwnProperty(ri);
    var isCollapsed = isCollapsible && collapseMap[ri];
    // Emitted regardless of collapsed state — the whole point is to mark a
    // COLLAPSED round that contains the followed unit (the organiser chose
    // "indicator only": following someone never changes collapse state on
    // their behalf, so this class is how a collapsed round says "click me").
    var hasFollowed = follow && follow.rounds[ri];

    html += `<div class="bracket-round-col${isCollapsed?' is-collapsed':''}${isCurrent?' current-col':''}" data-ri="${ri}">
      <div class="bracket-round-hdr${isCurrent?' current-hdr':''}${hdrAccentCls}${isCollapsible?' collapsible':''}${isCollapsed?' is-collapsed':''}${hasFollowed?' has-followed':''}"${isCollapsible?` onclick="toggleBracketCollapse(${ri})"`:''}>${isCollapsible?'<span class="bracket-collapse-chevron">▸</span>':''}${rLabel}</div>`;

    if (isCollapsed) { html += '</div>'; return; }

    html += '<div class="bracket-round-body">';

    if (!asgn.length) {
      html += buildPlaceholderRoundHtml(state, round);
    } else {
      // Byte-identical to renderAdminRound()'s own routing condition
      // (js/render-admin.js) and to bracketScoreEntryAllowed()'s Mechanism-A/B
      // check — a Final with numGames>1, or ANY double-elimination grand
      // final, uses T.finalScores/finalScoreChanged(), not T.scores — a
      // completely different data shape the room loop below can't read at
      // all (a Final round has no T.scores entries, ever). A plain
      // single-game Final falls through to the normal room loop unchanged.
      var isFinalMulti = round.isFinal && (round.numGames > 1 || round.bracket === 'grand-final');
      if (isFinalMulti) {
        html += buildFinalColumnHtml(state, ri, round, asgn, follow, rowsEditable);
      } else {
      for (var rm = 1; rm <= round.rooms.length; rm++) {
        var players = asgn.filter(a => a.room === rm);
        var thisAdv = round.isNoElim || round.isFinal ? players.length : round.advPerRoom;
        // Group stage: label each room card with its owning group (round.
        // roomGroups[rm-1]) instead of a bare room letter, since "Room A"
        // alone doesn't say which of the K groups it belongs to.
        var roomHeading = (round.isGroupStage ? 'Group ' + esc(round.roomGroups[rm - 1]) + ' · Room ' + roomLabel(rm) : 'Room ' + roomLabel(rm)) + ' (' + players.length + ')';
        html += `<div class="bracket-room-group"><div class="bracket-room-label">${roomHeading}</div>`;

        // pi is kept on each entry (not just used inline) because orderRoomByScore()
        // below re-sorts this array the instant the room completes — after that,
        // array position no longer matches room position, so a correct score-input
        // data-key (§ score entry) has no other way to recover which room slot an
        // entry actually belongs to. Looks unused in the read-only path; isn't.
        var scoredList = players.map((p, pi) => ({ name: p.name, score: getUnitScore(state, ri, rm, pi, null), pi: pi }));
        // Only reveal a room's scores/outcome once every player in it has a
        // score entered — a partially-scored room shows exactly as it did
        // before any scores existed (plain list, no colours, no numbers).
        var roomComplete = scoredList.length > 0 && scoredList.every(p => p.score !== null);
        var showResults = (isPast || isCurrent) && roomComplete;

        var display = showResults ? orderRoomByScore(scoredList, ri, rm, state) : scoredList.slice();

        display.forEach((p, i) => {
          var rank = i + 1;
          var adv = round.isNoElim || rank <= thisAdv;
          var isLL = lls.includes(p.name);
          var isTB = tbNames.has(p.name);
          // A lucky-loser candidate always renders as the purple "lucky"
          // state on its own round's card, regardless of adv — by
          // definition they rank outside the direct cutoff (adv false)
          // here but did actually advance via this mechanism.
          var cls = showResults ? (isLL ? 'lucky' : adv ? 'adv' : 'elim') : '';
          var tbBadge = showResults && isTB ? ' <span class="bracket-tb-badge" title="Tie-break resolved this round">⚖ TB</span>' : '';
          // showResults-gated, same as tbBadge above — a partially-scored
          // room shouldn't leak an unresolved-tie marker before the room is
          // even complete enough to know who's actually tied.
          var isPendingTie = showResults && unresolvedTieNames.has(p.name);
          var pendingCls = isPendingTie ? ' tie-pending' : '';
          var pendingBadge = isPendingTie ? ' <span class="bracket-tie-pending-badge" title="Tie-break not yet resolved">⚠ TB?</span>' : '';
          var followedCls = follow && follow.key === p.name ? ' is-followed' : '';
          var editableCls = rowsEditable ? ' is-editable' : '';
          var scoreKey = `r${ri}-rm${rm}-p${p.pi}`;
          if (teamSize) {
            var info = unitDisplay(state, p.name);
            var scoreCellsHtml = '';
            if (rowsEditable) {
              // Index the RAW team.members array, never info.members (from
              // unitDisplay) — info.members is filter(Boolean)-compacted, so
              // with a vacant slot its indices no longer match the -m{mi} key
              // space getUnitScore()/Admin's renderRooms() both use. Indexing
              // the wrong array would silently write a score under the wrong
              // member's key.
              var team = teamMap(state)[p.name];
              var rawMembers = (team && team.members) || [];
              var cells = [];
              for (var mi = 0; mi < teamSize; mi++) {
                var member = rawMembers[mi];
                if (!member) { cells.push(`<label class="br-m-vacant" title="Vacant slot"><input type="number" class="score-inp" disabled placeholder="—"></label>`); continue; }
                var mkey = `${scoreKey}-m${mi}`;
                var mraw = state.scores[mkey];
                var mval = (mraw !== undefined && mraw !== null) ? mraw : '';
                cells.push(`<label><span>${esc(member.name)}</span><input type="number" class="score-inp" value="${mval}" min="0" data-key="${mkey}" data-rm="${rm}" data-ri="${ri}" oninput="bracketScoreChanged(this)"></label>`);
              }
              scoreCellsHtml = `<div class="bracket-team-scores">${cells.join('')}</div>`;
            }
            html += `<div class="bracket-team-row ${cls}${followedCls}${editableCls}${pendingCls}">
              <div class="bracket-team-line1">
                <span class="bracket-team-name">${showResults && isLL ? '★ ' : ''}${esc(info.label)}${tbBadge}${pendingBadge}</span>
                ${showResults ? `<span class="bracket-score">${p.score}</span>` : ''}
              </div>
              <div class="bracket-team-members">${markedMemberNames(state, p.name, ri, info.members || []).join(', ')}</div>
              ${scoreCellsHtml}
            </div>`;
          } else {
            var indivScoreHtml;
            if (rowsEditable) {
              var raw = state.scores[scoreKey];
              var val = (raw !== undefined && raw !== null) ? raw : '';
              indivScoreHtml = `<input type="number" class="score-inp" value="${val}" min="0" data-key="${scoreKey}" data-rm="${rm}" data-ri="${ri}" oninput="bracketScoreChanged(this)">`;
            } else {
              indivScoreHtml = showResults ? `<span class="bracket-score">${p.score}</span>` : '';
            }
            html += `<div class="bracket-player-row ${cls}${followedCls}${editableCls}${pendingCls}">
              <span>${showResults && isLL ? '★ ' : ''}${renderUnitCell(state, p.name, false)}${tbBadge}${pendingBadge}</span>
              ${indivScoreHtml}
            </div>`;
          }
        });
        html += '</div>';
      }
      } // end isFinalMulti / normal-room-loop branch
      // Bye recipient for this round ("Bye" odd-count strategy) — no room
      // card is generated for them; they get a distinct small card instead,
      // after all of this round's real rooms.
      if (state.byes && state.byes[ri] && state.byes[ri].length) {
        state.byes[ri].forEach(function (byeUnit) {
          var byeFollowedCls = follow && follow.key === byeUnit ? ' is-followed' : '';
          html += `<div class="bracket-bye-card${byeFollowedCls}"><span class="bracket-bye-label">BYE</span>${esc(unitDisplay(state, byeUnit).label)}</div>`;
        });
      }
    }
    html += '</div></div>'; // close bracket-round-body, then bracket-round-col
  });
  return html;
}

// Uniform generic placeholder for a round nobody has been seeded into yet
// (every round beyond wherever the tournament has actually reached — only
// round 0's assignments are populated at generation time; advanceRound()
// fills in each later round's state.assignments[ri] live). Deliberately
// shows dashed empty slots for every format, never a real projected
// matchup — group-stage's real pairings and double-elimination's WB/LB
// routing ARE technically knowable ahead of time, but the organiser asked
// for placeholders "instead of players' names," not a projection engine.
// Pure function of its two arguments (esc()/roomLabel() are its only
// helpers, both already pure) — preserves buildBracketHtml(snap)'s
// Archive-purity guarantee exactly like the rest of this file.
function buildPlaceholderRoundHtml(state, round) {
  var rooms = (round && round.rooms) || [];
  if (!rooms.length) return `<div style="color:var(--muted);font-size:12px">Not yet seeded</div>`; // defensive fallback; should be unreachable — every generated round has .rooms populated

  var html = '';
  for (var rm = 1; rm <= rooms.length; rm++) {
    var slots = rooms[rm - 1] || 0;
    var heading = ((round.isGroupStage && round.roomGroups)
      ? 'Group ' + esc(round.roomGroups[rm - 1]) + ' · Room ' + roomLabel(rm)
      : 'Room ' + roomLabel(rm)) + ' (' + slots + ')';
    html += `<div class="bracket-room-group"><div class="bracket-room-label">${heading}</div>`;
    for (var s = 0; s < slots; s++) html += `<div class="bracket-placeholder-row"><span>—</span></div>`;
    html += '</div>';
  }
  // Swiss round 2+ only: room COUNT is a real projection, but WHICH units
  // land where is decided live via swissFoldPair() off standings that don't
  // exist yet — same distinction renderPreview() already makes for this
  // exact flag (js/render-admin.js). Never imply a fixed pairing here.
  if (round.pairingTBD) html += `<div class="bracket-placeholder-note">Pairings determined live</div>`;
  return html;
}

// Read+write for a "Mechanism B" Final round (multi-game / grand-final
// race) — replaces the room loop entirely for this one round, not a patch to
// it: a Final always has exactly one room (a "Room A" wrapper carries no
// information here), the per-row payload is N per-game cells + a running
// total rather than one score, and orderRoomByScore()/pi-based data-keys are
// both meaningless (Finals scoring has no room/position concept at all, and
// detectTieBreaks() returns {} unconditionally for round.isFinal, so no
// ⚖ TB handling is needed either). Pure function of state — Archive's
// read-only buildBracketHtml(snap) call never passes rowsEditable, so this
// always renders fully read-only there, same purity discipline as the rest
// of buildBracketHtml.
//
// Only ONE game is ever editable at a time (progress.nextGame) — correcting
// an already-finished game is Admin-only by design, not an oversight; a
// hint says so once at least one game is complete.
function buildFinalColumnHtml(state, ri, round, asgn, follow, rowsEditable) {
  var teamSize = getGamemodeDescriptorFor(state).format.teamSize;
  var progress = finalsProgressState(state, ri, round);
  var html = '';

  if (progress.race) {
    var race = progress.race;
    var wbLabel = esc(unitDisplay(state, race.wbName).label);
    var lbLabel = esc(unitDisplay(state, race.lbName).label);
    html += `<div class="bracket-final-race">
      <span class="bfr-side bfr-wb">${wbLabel}</span> <b>${race.wbWins}</b>/${race.wbTarget}
      <span class="bfr-sep">·</span>
      <span class="bfr-side bfr-lb">${lbLabel}</span> <b>${race.lbWins}</b>/${race.lbTarget}
      ${race.decided ? `<span class="bfr-won">🏆 ${esc(unitDisplay(state, race.winnerName).label)} wins</span>` : ''}
    </div>`;
  }

  if (rowsEditable && progress.nextGame !== null) {
    html += `<div class="bracket-final-openlabel">Game ${progress.nextGame} — enter scores</div>`;
  }

  var orderedNames = progress.complete ? progress.order : asgn.map(function (p) { return p.name; });
  orderedNames.forEach(function (name, i) {
    var unit = progress.units.find(function (u) { return u.name === name; });
    var rank = i + 1;
    var cls = progress.complete ? 'adv' : '';
    var isWinner = progress.complete && rank === 1;
    var followedCls = follow && follow.key === name ? ' is-followed' : '';
    var editableCls = rowsEditable ? ' is-editable' : '';

    var gamesHtml = unit.perGame.map(function (score, gi) {
      var g = gi + 1;
      return score !== null ? `<span class="bfg">G${g} <b>${score}</b></span>` : `<span class="bfg is-pending">G${g} —</span>`;
    }).join('');

    var totalLabel = progress.isGrandFinal ? unit.wins : unit.total;
    var totalTitle = progress.isGrandFinal ? 'Games won' : 'Cumulative Final score';

    var nextGameHtml = '';
    if (rowsEditable && progress.nextGame !== null) {
      var g = progress.nextGame;
      if (teamSize) {
        // Index the RAW team.members array, never unitDisplay().members —
        // the latter is filter(Boolean)-compacted, so with a vacant slot its
        // indices no longer match the -m{mi} key space getFinalUnitScore()
        // uses. Same trap, same fix as the normal-round branch above; note
        // renderMultiGameFinals() (js/render-admin.js) already does this
        // correctly, so this mirrors an existing-correct pattern here.
        var team = teamMap(state)[name];
        var rawMembers = (team && team.members) || [];
        var cells = [];
        for (var mi = 0; mi < teamSize; mi++) {
          var member = rawMembers[mi];
          if (!member) { cells.push(`<label class="br-m-vacant" title="Vacant slot"><input type="number" class="score-inp" disabled placeholder="—"></label>`); continue; }
          var mkey = `game${g}-${name}-m${mi}`;
          var mraw = state.finalScores[mkey];
          var mval = (mraw !== undefined && mraw !== null && mraw !== '') ? mraw : '';
          cells.push(`<label><span>${esc(member.name)}</span><input type="number" class="score-inp" value="${mval}" min="0" data-fkey="${esc(mkey)}" oninput="bracketFinalScoreChanged(this)"></label>`);
        }
        nextGameHtml = `<div class="bracket-final-next"><span class="bfn-label">G${g}</span><div class="bracket-team-scores">${cells.join('')}</div></div>`;
      } else {
        var fkey = `game${g}-${name}`;
        var raw = state.finalScores[fkey];
        var val = (raw !== undefined && raw !== null && raw !== '') ? raw : '';
        nextGameHtml = `<div class="bracket-final-next"><label><span>G${g}</span><input type="number" class="score-inp" value="${val}" min="0" data-fkey="${esc(fkey)}" oninput="bracketFinalScoreChanged(this)"></label></div>`;
      }
    }

    if (teamSize) {
      var info = unitDisplay(state, name);
      html += `<div class="bracket-final-row ${cls}${isWinner ? ' is-final-winner' : ''}${followedCls}${editableCls}">
        <div class="bracket-final-line1">
          <span class="bracket-final-name">${isWinner ? '🏆 ' : ''}${esc(info.label)}</span>
          <span class="bracket-final-total" title="${totalTitle}">${totalLabel}</span>
        </div>
        <div class="bracket-team-members">${markedMemberNames(state, name, ri, info.members || []).join(', ')}</div>
        <div class="bracket-final-games">${gamesHtml}</div>
        ${nextGameHtml}
      </div>`;
    } else {
      html += `<div class="bracket-final-row ${cls}${isWinner ? ' is-final-winner' : ''}${followedCls}${editableCls}">
        <div class="bracket-final-line1">
          <span class="bracket-final-name">${isWinner ? '🏆 ' : ''}${renderUnitCell(state, name, false)}</span>
          <span class="bracket-final-total" title="${totalTitle}">${totalLabel}</span>
        </div>
        <div class="bracket-final-games">${gamesHtml}</div>
        ${nextGameHtml}
      </div>`;
    }
  });

  if (rowsEditable && progress.nextGame !== null && progress.nextGame > 1) {
    html += `<div class="bracket-final-hint">Earlier games are edited in Admin</div>`;
  }

  return html;
}

// Bracket round-collapse state — per-browser, in-memory only (never written
// to T, never synced to Firebase, resets on reload). Stores only EXPLICIT
// user toggles, keyed by round index; a round with no entry here falls back
// to the default heuristic below, computed fresh every render rather than
// stored, same "derive at render time" preference the rest of this app
// already follows for round status. Cleared in proceedGenerateSchedule() and
// proceedReset() so a stale round index never bleeds into a differently-
// shaped tournament (see HANDOFF.md "Design intent for viewer-facing tabs").
var bracketCollapseOverride = {};

// Every past round collapses by default except the one immediately before
// the current one — that's the round someone landing on Bracket is most
// likely to still care about (a recent lucky loser, a tie-break, who just
// advanced into a room they're about to watch); everything further back is
// the actual clutter a big field produces.
function bracketRoundDefaultCollapsed(ri, state) {
  return ri < state.curRound - 1;
}
function isBracketRoundCollapsed(ri, state) {
  return bracketCollapseOverride.hasOwnProperty(ri) ? bracketCollapseOverride[ri] : bracketRoundDefaultCollapsed(ri, state);
}
function toggleBracketCollapse(ri) {
  bracketCollapseOverride[ri] = !isBracketRoundCollapsed(ri, T);
  renderBracket();
}

// "Follow a player" — per-browser, localStorage-backed (unlike
// bracketCollapseOverride above, losing this on reload is a real cost for a
// returning viewer, matching ADMIN_UNLOCKED_KEY's reasoning). Stores the
// RESOLVED roster key (a player name, or a team's teamId), never the raw
// typed text, so a roster change degrades gracefully — the banner just says
// "not in this bracket" — rather than resolving to the wrong unit. Cleared
// in proceedReset() but deliberately NOT in proceedGenerateSchedule(): who
// you like to follow reasonably survives regenerating the same tournament
// for the same friend group, unlike collapse state which is tied to one
// specific round structure. This intentionally still writes in viewer mode
// (SYNC_IS_VIEWER) — it never touches T and never reaches pushSyncUpdate(),
// so there's no risk of a viewer clobbering the organiser's real state.
var BRACKET_FOLLOW_KEY = 'curveFFA_bracket_follow';
function getFollowedUnit() {
  try { return localStorage.getItem(BRACKET_FOLLOW_KEY) || null; } catch (e) { return null; }
}
function setFollowedUnit(key) {
  try { key ? localStorage.setItem(BRACKET_FOLLOW_KEY, key) : localStorage.removeItem(BRACKET_FOLLOW_KEY); } catch (e) {}
}
function clearFollow() {
  setFollowedUnit(null);
  var el = document.getElementById('br-follow-input');
  if (el) el.value = '';
  if (T.rounds.length) renderBracket();
}

// One pass over every round's assignments for a single followed key — NOT
// folded into buildBracketHtml()'s own per-round loop, deliberately: this
// needs to be known BEFORE the round-column loop runs (a collapsed round's
// "has-followed" indicator is decided at the same time collapseMap is
// built), and keeping buildBracketHtml a pure function of its inputs is what
// lets Archive keep calling buildBracketHtml(snap) with no follow argument
// at all and never show any highlighting. "Eliminated" uses the exact same
// rule computeRankings() already uses (lastAssignedRound) so it means one
// consistent thing everywhere in the app.
function bracketFollowStatus(state, key) {
  if (!key) return null;
  var rounds = {};
  var lastRi = -1, lastRoom = null, lastIsBye = false, found = false;
  state.assignments.forEach(function (asgn, ri) {
    var entry = (asgn || []).find(function (a) { return a.name === key; });
    var isBye = !entry && state.byes && state.byes[ri] && state.byes[ri].indexOf(key) !== -1;
    if (!entry && !isBye) return;
    found = true;
    var room = entry ? entry.room : null;
    rounds[ri] = { room: room, isBye: isBye || room === null };
    lastRi = ri; lastRoom = room; lastIsBye = isBye || room === null;
  });
  if (!found) return null;
  return {
    key: key, rounds: rounds, lastRi: lastRi, room: lastRoom, isBye: lastIsBye,
    eliminated: lastRi < lastAssignedRound(state)
  };
}

function buildFollowBannerHtml(state, follow) {
  var key = getFollowedUnit();
  if (!key) return '';
  if (!follow) {
    return `<div class="bracket-follow-pill is-out"><strong>Following ${esc(unitDisplay(state, key).label)}</strong> — not in this bracket</div>`;
  }
  var label = esc(unitDisplay(state, key).label);
  // Same label the column header itself shows — including WB/LB/Grand Final
  // for double-elimination — via the shared bracketRoundLabels(), not a
  // separate, simpler derivation that could drift out of sync with it.
  var roundName = bracketRoundLabels(state)[follow.lastRi].label;
  var whereHtml;
  if (follow.eliminated) {
    whereHtml = `out in ${roundName}`;
  } else if (follow.isBye) {
    whereHtml = `${roundName} · BYE, advances automatically`;
  } else {
    whereHtml = `${roundName} · Room ${roomLabel(follow.room)}`;
  }
  return `<div class="bracket-follow-pill${follow.eliminated ? ' is-out' : ''}"><strong>Following ${label}</strong> — ${whereHtml}` +
    `<button type="button" class="bracket-follow-clear" onclick="clearFollow()" title="Stop following">✕</button></div>`;
}

// Only sets the input's value when it's safe to do so — an in-progress
// partial query the viewer is still typing must never be overwritten, and a
// focused input should never have its caret position disturbed underneath
// the viewer's fingers.
function syncFollowInputValue(follow) {
  var el = document.getElementById('br-follow-input');
  if (!el || document.activeElement === el || el.value) return;
  var key = getFollowedUnit();
  if (key) el.value = unitDisplay(T, key).label;
}

var bracketFollowDebounce = null;
function followInputChanged() {
  var input = document.getElementById('br-follow-input');
  var key = resolveUnitQuery(T, input ? input.value : '');
  var changed = key !== getFollowedUnit();
  setFollowedUnit(key);
  clearTimeout(bracketFollowDebounce);
  bracketFollowDebounce = setTimeout(function () { renderBracket(changed); }, 120);
}

// Direct scrollLeft math, not scrollIntoView() — scrollIntoView() on a
// horizontally-scrolling child also scrolls the page vertically, which is
// not wanted here. Centred rather than left-aligned so the neighbouring
// rounds (who they just beat, who they play next) stay in view too.
function scrollBracketToFollowed(follow) {
  var sc = document.getElementById('br-rounds');
  var col = sc && sc.querySelector('.bracket-round-col[data-ri="' + follow.lastRi + '"]');
  if (!sc || !col) return;
  sc.scrollTo({ left: Math.max(0, col.offsetLeft - (sc.clientWidth - col.offsetWidth) / 2), behavior: 'smooth' });
}

// Whether Bracket should render live score inputs for the CURRENT round.
// Three gates beyond isAdminUnlocked():
//  - state.started: Admin structurally can't score a generated-but-not-yet-
//    started tournament either (#panel-running stays hidden pre-start) —
//    matching that boundary, not inventing a new one.
//  - !SYNC_IS_VIEWER: SYNC_IS_VIEWER is computed once at page LOAD, but
//    isAdminUnlocked() reads localStorage LIVE and is shared across every
//    tab of one browser. A tab that opened a ?t= link before being unlocked
//    keeps SYNC_IS_VIEWER===true even after Admin gets unlocked in a
//    DIFFERENT tab of the same browser — only promoteViewerToWriter() (in
//    the tab that actually unlocks) clears it. Without this gate, that
//    stale-viewer tab would show live inputs whose edits silently vanish:
//    saveState()/pushSyncUpdate() both no-op for a viewer, and the next
//    incoming Firebase snapshot hits the viewer listener's blanket
//    Object.assign(T, payload) (js/sync.js) — unlike the writer path, that
//    merge has NO dirty-key protection, so the typed score is overwritten
//    with no error and no indication. This is the same predicate
//    pushSyncUpdate() itself already gates on.
//  - Mechanism A vs B: byte-identical to js/render-admin.js's own routing
//    condition — a Final with numGames>1, or ANY double-elimination grand
//    final (bracket==='grand-final', even before numGames ever exceeds 1),
//    uses a completely different multi-game/race UI (T.finalScores,
//    finalScoreChanged()) that this build doesn't support — Bracket stays
//    fully read-only for that round, exactly as it renders today.
function bracketScoreEntryAllowed(state) {
  if (!state.started) return false;
  if (!isAdminUnlocked()) return false;
  if (typeof SYNC_IS_VIEWER !== 'undefined' && SYNC_IS_VIEWER) return false;
  var round = state.rounds[state.curRound];
  if (!round) return false;
  // This is now purely the three access gates — it no longer excludes
  // Mechanism B (Final/grand-final multi-game scoring). WHICH mechanism a
  // round uses, and whether any game is actually open for entry right now,
  // is decided inside buildBracketHtml()/buildFinalColumnHtml() from the
  // round itself (round.isFinal/numGames/bracket, finalsProgressState()'s
  // nextGame) — not here. A fully-decided Final correctly ends up with
  // nextGame===null and renders read-only despite this gate still saying
  // "editable", which is the intended separation: this function answers
  // "is this admin allowed to edit at all," not "is there anything left to
  // edit right now."
  return true;
}

// Bracket score-input focus guard — own mechanism, deliberately separate
// from Admin's adminRenderPending (js/render-admin.js): they guard different
// render functions and can never both be pending at once (exactly one tab
// is ever active), so unifying them would need a "which view" discriminator
// for no behavioural gain. Reuses isScoreInputFocused() as-is (a plain,
// view-agnostic global — just checks document.activeElement) rather than
// duplicating it.
var bracketRenderPending = false;
var bracketRenderPendingScroll = false; // preserve a scrollToFollowed signal across a deferral

// scrollToFollowed is opt-in and defaults to falsy — every existing caller
// (switchTab, both 5s pollers, both sync paths) calls this with no
// arguments and never auto-scrolls; only followInputChanged() (and
// switchTab(), on purpose, landing on Bracket) passes true, and only when
// the resolved followed key actually changed. This is what stops the
// feature from fighting a viewer who's deliberately scrolled elsewhere.
function renderBracket(scrollToFollowed) {
  if (isScoreInputFocused()) {
    bracketRenderPending = true;
    bracketRenderPendingScroll = bracketRenderPendingScroll || !!scrollToFollowed;
    return;
  }
  bracketRenderPending = false;
  var s = bracketRenderPendingScroll || scrollToFollowed;
  bracketRenderPendingScroll = false;
  renderBracketNow(s);
}

document.addEventListener('focusout', function (e) {
  if (!bracketRenderPending) return;
  if (!e.target || !e.target.classList || !e.target.classList.contains('score-inp')) return;
  setTimeout(function () {
    // One tick later, same reason as Admin's identical guard: Tab-navigation
    // between two score inputs (blur old, focus new) shouldn't trigger a
    // spurious mid-navigation repaint.
    if (bracketRenderPending && !isScoreInputFocused()) {
      bracketRenderPending = false;
      var s = bracketRenderPendingScroll; bracketRenderPendingScroll = false;
      renderBracketNow(s);
    }
  }, 0);
});

function renderBracketNow(scrollToFollowed) {
  if (!T.rounds.length) return;
  document.getElementById('br-empty').style.display = 'none';
  document.getElementById('br-content').style.display = 'block';
  var follow = bracketFollowStatus(T, getFollowedUnit());
  // EVERY round gets a collapseMap entry, which is what makes it collapsible
  // at all (see buildBracketHtml's collapseMap.hasOwnProperty(ri) check) —
  // a viewer can manually fold the current round and any future one too, not
  // just past rounds (2026-09-07). What's collapsed BY DEFAULT is unchanged:
  // bracketRoundDefaultCollapsed() is `ri < curRound - 1`, which already
  // returns false for the current round and every future one — this loop
  // simply starts consulting it for them too.
  var collapseMap = {};
  for (var ri = 0; ri < T.rounds.length; ri++) collapseMap[ri] = isBracketRoundCollapsed(ri, T);
  document.getElementById('br-follow-banner').innerHTML = buildFollowBannerHtml(T, follow);
  document.getElementById('br-rounds').innerHTML = buildBracketHtml(T, collapseMap, follow, bracketScoreEntryAllowed(T));
  syncFollowInputValue(follow);
  if (scrollToFollowed && follow) scrollBracketToFollowed(follow);
}

// scoreChanged() (js/render-admin.js) was written for Admin's own re-render
// path and never triggers a Bracket repaint on its own — otherwise it's
// confirmed safe to call verbatim regardless of which tab is active:
// recalcRoom()'s per-row DOM lookups are all `if (!rowEl) return;` guarded,
// #tie-banner-wrap is a static always-present element, and the Next-round
// button lookup is null-guarded. Do NOT reimplement or extract scoreChanged()
// — call it as-is.
function bracketScoreChanged(input) {
  scoreChanged(input);
  renderBracket(); // focus-guarded — defers until the admin is done typing/tabbing
}

// Mechanism B's equivalent of bracketScoreChanged() above — but NOT optional
// the way that one arguably was: finalScoreChanged() (js/render-admin.js)
// has ZERO DOM effects of its own (unlike scoreChanged(), which drives
// recalcRoom()/renderTieBanner()), so without this explicit renderBracket()
// call, Bracket's Finals card would never visibly update — not the history,
// not the total, not the race progress, not a newly-opened game.
//
// On a live-growing grand-final race, the new game appears ON BLUR, not
// mid-keystroke, and that's correct, not a bug: checkGrandFinalRace() (called
// inside finalScoreChanged()) mutates round.numGames immediately, then calls
// renderAdminRound() — itself focus-guarded, so it defers while this input
// still has focus. The renderBracket() call right below does the same. Both
// flush on the same focusout tick once focus genuinely leaves every
// .score-inp, and by then round.numGames has already grown, so the render
// that finally runs shows the new game immediately — just not before blur.
function bracketFinalScoreChanged(input) {
  finalScoreChanged(input);
  renderBracket();
}

// ═══════════════════════════════════════════════════════════════
// RANKINGS — live + archive-shared pure builders. The Players tab was
// retired 2026-09-08 and folded in here (current round/room + live pooling
// rank for a still-active unit, plus the pre-schedule roster list) — see
// "Merge Players tab into Rankings" in HANDOFF_LOG.md for the full account.
// ═══════════════════════════════════════════════════════════════
function roundShortLabel(round) {
  return round.isFinal ? '🏆 Final' : round.isSemis ? '⚔ Semis' :
         round.isQual  ? 'Qual R' + round.roundNum :
         round.isSwiss ? 'Swiss R' + round.roundNum :
         round.isGroupStage ? 'Group R' + round.roundNum : 'Round ' + round.roundNum;
}

// Pure HTML builder for the rankings table body — takes computeRankings()'s
// output, not a state object directly, since both live and archive callers
// already have that computed. No DOM access, safe to reuse for archive.
// Rows carry a resolved `label` (+ `members`, for team formats) attached by
// computeRankings() — this stays a pure display layer with no format lookup
// of its own.
function rankingUnitCell(entry) {
  var html = entry.members ? '<strong>' + esc(entry.label) + '</strong>' : esc(entry.label);
  if (entry.members) html += '<div style="font-size:10px;color:var(--muted);margin-top:2px">' + entry.members.map(esc).join(' &amp; ') + '</div>';
  return html;
}

// Block-level "row" (not a <tr> — see the .rk-columns CSS comment) so rows
// can flow into a CSS column-width container. rankHtml/badgeHtml are
// pre-built fragments since what goes in each varies by section (a
// still-active unit has no rank; a finalist/eliminated unit does). subHtml
// (2026-09-08, Players-tab fold-in) is an optional extra line rendered right
// after the unit cell — used for a still-active unit's current round/room;
// omitted (undefined -> '') by every other call site, so their output is
// byte-identical to before this parameter existed.
function rankingRowHtml(rankHtml, entry, badgeHtml, extraCls, subHtml) {
  return `<div class="rk-row${extraCls ? ' ' + extraCls : ''}">
    <span class="rk-rank">${rankHtml}</span>
    <span class="rk-unit">${rankingUnitCell(entry)}${subHtml || ''}</span>
    ${badgeHtml}
  </div>`;
}

// The two pieces of per-unit info the retired Players tab used to be the
// only viewer-facing surface for (2026-09-08, "Merge Players tab into
// Rankings" in HANDOFF_LOG.md) — a still-active unit's current round/room,
// and its live pooling-phase rank. Kept as small standalone builders (not
// folded into rankingRowHtml itself) so the "what extra info does a
// still-active row carry" concern stays localized to buildRankingsRows below.
function rankingStillActiveSubHtml(u, lastRound) {
  var whereHtml = u.room === null
    ? '<strong style="color:var(--amber)">BYE</strong> — advances automatically'
    : 'Room <strong style="color:var(--cyan)">' + roomLabel(u.room) + '</strong>';
  return '<div style="font-size:11px;color:var(--muted);margin-top:2px">' +
    esc(roundShortLabel(lastRound)) + ' — ' + whereHtml + '</div>';
}
function rankingPoolRankBadge(u) {
  if (!u.poolRank) return '';
  var label = (u.poolRank.groupLabel ? 'Grp ' + u.poolRank.groupLabel + ' #' + u.poolRank.rank : '#' + u.poolRank.rank) +
    (u.poolRank.fp !== null ? ' · ' + u.poolRank.fp.toFixed(3) + ' FP' : '');
  return '<div style="font-size:10px;color:var(--amber);margin-top:3px;text-align:right">' + label + '</div>';
}

// Still-active and ranked (finalists + eliminated) are two INDEPENDENT
// column-flow blocks, not one shared one — otherwise the section title
// between them could land at the bottom of one column while its own
// section's rows start in the next, which reads as broken.
function buildRankingsRows(data) {
  var activeHtml = data.stillActive.map(u => {
    var badgeHtml = '<div style="display:flex;flex-direction:column;align-items:flex-end">' +
      '<span class="pill pill-neut">Still in tournament</span>' + rankingPoolRankBadge(u) + '</div>';
    return rankingRowHtml('—', u, badgeHtml, 'rk-active', rankingStillActiveSubHtml(u, data.lastRound));
  }).join('');

  var rankedRows = [];
  if (data.finalComplete) {
    data.finalists.forEach(f => {
      rankedRows.push(rankingRowHtml(
        `<span class="pos-num${f.rank === 1 ? ' top' : ''}">${f.rank}</span>`,
        f, '<span class="pill pill-final">🏆 Reached Final</span>',
        f.rank === 1 ? 'rk-champion' : ''
      ));
    });
  }
  data.eliminatedList.forEach(e => {
    rankedRows.push(rankingRowHtml(
      `<span class="pos-num">${e.rank}</span>`,
      e, `<span class="pill pill-neut">${esc(roundShortLabel(e.round))}</span>`, ''
    ));
  });

  var out = '';
  if (activeHtml) out += `<div class="rk-section-title">Still in tournament</div><div class="rk-columns">${activeHtml}</div>`;
  if (rankedRows.length) out += `<div class="rk-section-title">Final standings</div><div class="rk-columns">${rankedRows.join('')}</div>`;
  return out || '<div style="text-align:center;color:var(--muted);padding:20px">No data yet.</div>';
}

// Pre-schedule roster view (2026-09-08, Players-tab fold-in) — a roster can
// be loaded in Admin well before Generate Schedule is clicked; computeRankings()
// itself returns null until a schedule exists (state.rounds.length === 0), so
// this is a small separate pure builder rather than a third computeRankings()
// branch, keeping that function's own null-return contract (relied on by
// Archive/PNG-export, which never need a "no schedule yet" state) unchanged.
// Reuses rosterKeys()/unitDisplay()/rankingRowHtml()/rankingUnitCell() —
// deliberately NOT the retired Players tab's playerCard() avatar-card shape,
// rendered instead through Rankings' own .rk-row/.rk-columns idiom.
function buildRosterOnlyRows(state) {
  var byLabel = (a, b) => unitDisplay(state, a).label.localeCompare(unitDisplay(state, b).label);
  var rows = '';
  rosterKeys(state.players).slice().sort(byLabel).forEach(key => {
    var info = unitDisplay(state, key);
    rows += rankingRowHtml('—', { name: key, label: info.label, members: info.members },
      '<span class="pill pill-neut">Registered</span>', '');
  });
  rosterKeys(state.reserves).slice().sort(byLabel).forEach(key => {
    var info = unitDisplay(state, key);
    rows += rankingRowHtml('—', { name: key, label: info.label, members: info.members },
      '<span class="pill pill-neut">Reserve</span>', '');
  });
  return rows ? '<div class="rk-columns">' + rows + '</div>' : '';
}

// Live-only wrapper around the shared builders above.
function renderRankings() {
  var data = computeRankings();
  var empty = document.getElementById('rk-empty'), content = document.getElementById('rk-content');
  var desc = document.getElementById('rk-desc'), dlRow = document.getElementById('rk-download-row');
  if (!data) {
    // A roster can be loaded (Registered/Reserve names exist) before any
    // schedule is generated — show that flat list instead of the "start a
    // tournament" placeholder, which is now reserved for the genuinely
    // empty case (no roster loaded at all).
    if (T.players.length || T.reserves.length) {
      empty.style.display = 'none';
      content.style.display = 'block';
      if (desc) desc.style.display = 'none';
      if (dlRow) dlRow.style.display = 'none';
      document.getElementById('rk-list').innerHTML = buildRosterOnlyRows(T) ||
        '<div style="text-align:center;color:var(--muted);padding:20px">No data yet.</div>';
    } else {
      empty.style.display = 'block';
      content.style.display = 'none';
    }
    return;
  }
  empty.style.display = 'none';
  content.style.display = 'block';
  if (desc) desc.style.display = '';
  if (dlRow) dlRow.style.display = '';
  document.getElementById('rk-list').innerHTML = buildRankingsRows(data);
}

// ═══════════════════════════════════════════════════════════════
// RANKINGS IMAGE EXPORT — a shareable PNG of the rankings table, for
//  pasting into Discord/Website posts. Hand-drawn on a <canvas> rather
//  than rasterising the live DOM, since the app has no external JS
//  libraries and no backend to render with — this is the vanilla-canvas
//  equivalent of downloadJson()'s "build a blob, trigger an anchor
//  download" pattern below, just for image/png instead of
//  application/json. Colours are the same hex values as the CSS custom
//  properties in <style> — canvas can't read CSS vars, so they're
//  mirrored here as literals; keep the two in sync if the theme changes.
// ═══════════════════════════════════════════════════════════════
var RANK_IMG_COLORS = {
  bg: '#0D0F14', border: '#252D3D', cyan: '#00E5FF',
  green: '#00E096', text: '#E8EDF5', muted: '#6B7A99'
};

// Truncates text to fit maxWidth (in the ctx's current font), appending an
// ellipsis, via binary search over string length — avoids a linear
// character-by-character measureText() scan for long names.
function truncateToWidth(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  var lo = 0, hi = text.length;
  while (lo < hi) {
    var mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + '…';
}

// Path for a rounded rect, used for the status pill behind each row — falls
// back to manual arcs on the rare browser without native ctx.roundRect().
function tracePillPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
}

// Builds the rankings graphic for `state` (live T or an archived snapshot)
// as an offscreen <canvas>, reusing computeRankings() so the image can never
// disagree with what's on-screen. Rendered at 2x and downscaled via CSS-less
// canvas pixel dimensions for a crisp export on high-DPI displays / Discord
// embeds. Returns null if there's no ranking data yet (no schedule/no
// assignments) — callers should tell the organiser rather than download a
// blank image.
// Row count -> column count for a rankings section, mirroring the DOM's
// column-width-driven "up to 3, collapsing to fewer" behavior — the canvas
// has no viewport to auto-collapse against, so column count is chosen
// directly from how many rows actually need to fit (few rows in narrow
// columns reads as sparse/cramped, not efficient).
function pickRankColumnCount(n) {
  if (n <= 6) return 1;
  if (n <= 14) return 2;
  return 3;
}

// Lays out one rankings section (still-active, or ranked) into up to 3
// newspaper-style columns (column 1 filled top-to-bottom, then column 2,
// etc. — same fill order CSS column-width uses) and returns everything
// needed to draw it: how many columns, how wide each one is, and the pixel
// height the section occupies (rowsPerColumn * rowH) so the caller can
// stack sections vertically without guessing.
function layoutRankSection(rows, usableW, colGap, rowH) {
  var cols = pickRankColumnCount(rows.length);
  var colW = (usableW - colGap * (cols - 1)) / cols;
  var rowsPerCol = Math.ceil(rows.length / cols);
  return { cols: cols, colW: colW, rowsPerCol: rowsPerCol, height: rowsPerCol * rowH, rows: rows };
}

// Draws one row (rank, badge, name — no value column, dropped along with
// the DOM's "Relative score" column) at (x, y) within a colW-wide column.
function drawRankRow(ctx, r, x, y, colW, rowH) {
  if (r.champion) {
    ctx.fillStyle = 'rgba(0,224,150,0.08)';
    ctx.fillRect(x - 6, y, colW + 6, rowH - 2);
    ctx.fillStyle = RANK_IMG_COLORS.green;
    ctx.fillRect(x - 6, y, 3, rowH - 2);
  }
  var midY = y + rowH / 2 + 4;

  ctx.font = (r.champion ? '700 16px' : '700 13px') + ' Rajdhani';
  ctx.fillStyle = r.champion ? RANK_IMG_COLORS.green : RANK_IMG_COLORS.muted;
  ctx.textAlign = 'center';
  ctx.fillText(r.rank !== null ? String(r.rank) : '—', x + 12, midY);
  ctx.textAlign = 'left';

  ctx.font = '600 10px Inter';
  var badgeW = ctx.measureText(r.badge).width + 16;
  var badgeX = x + colW - badgeW;
  ctx.fillStyle = RANK_IMG_COLORS.muted + '22';
  tracePillPath(ctx, badgeX, y + rowH / 2 - 9, badgeW, 18, 9);
  ctx.fill();
  ctx.fillStyle = RANK_IMG_COLORS.muted;
  ctx.textAlign = 'center';
  ctx.fillText(r.badge, badgeX + badgeW / 2, y + rowH / 2 + 3);
  ctx.textAlign = 'left';

  ctx.font = (r.champion ? '600 13px' : '400 12px') + ' Inter';
  ctx.fillStyle = RANK_IMG_COLORS.text;
  ctx.fillText(truncateToWidth(ctx, r.name, badgeX - 8 - (x + 26)), x + 26, midY);
}

async function buildRankingsImageCanvas(state) {
  var data = computeRankings(state);
  if (!data) return null;

  // Ensure the actual font files are loaded before measuring/drawing text —
  // canvas silently falls back to a system font if the requested one isn't
  // marked ready yet, which would make the export inconsistent with the
  // live page (which has almost certainly already triggered these loads,
  // but don't rely on incidental timing).
  await Promise.all([
    document.fonts.load('700 20px Rajdhani'),
    document.fonts.load('700 14px Rajdhani'),
    document.fonts.load('600 17px Inter'),
    document.fonts.load('600 11px Inter'),
    document.fonts.load('500 12px Inter'),
    document.fonts.load('400 13px Inter')
  ]).catch(function () {});

  // Team formats fold member names into the drawn name string ("Team Rocket
  // (Ash & Misty)") since the canvas layout has one name slot per row, not a
  // separate sub-line like the HTML card.
  function rowName(entry) {
    return entry.members ? entry.label + ' (' + entry.members.join(' & ') + ')' : entry.label;
  }
  var activeRows = data.stillActive.map(function (u) {
    return { rank: null, name: rowName(u), badge: 'STILL IN TOURNAMENT', champion: false };
  });
  var rankedRows = [];
  if (data.finalComplete) {
    data.finalists.forEach(function (f) {
      rankedRows.push({ rank: f.rank, name: rowName(f), badge: 'REACHED FINAL', champion: f.rank === 1 });
    });
  }
  data.eliminatedList.forEach(function (e) {
    var round = e.round;
    var label = round.isFinal ? 'FINAL' : round.isSemis ? 'SEMIS' :
                round.isQual ? 'QUAL R' + round.roundNum :
                round.isSwiss ? 'SWISS R' + round.roundNum :
                round.isGroupStage ? 'GROUP R' + round.roundNum : 'ROUND ' + round.roundNum;
    rankedRows.push({ rank: e.rank, name: rowName(e), badge: label, champion: false });
  });

  // Wider than the original 720px single-column layout — needed to fit up
  // to 3 columns with badges comfortably; still a fixed-width export sized
  // reasonably for pasting into Discord or a website, not blown out.
  var W = 1100, padX = 36, padTop = 26, rowH = 34, headerH = 80, footerH = 34, colGap = 20, sectionTitleH = 24, sectionGap = 16;
  var usableW = W - padX * 2;

  var sections = [];
  if (activeRows.length) sections.push({ title: 'STILL IN TOURNAMENT', section: layoutRankSection(activeRows, usableW, colGap, rowH) });
  if (rankedRows.length) sections.push({ title: 'FINAL STANDINGS', section: layoutRankSection(rankedRows, usableW, colGap, rowH) });

  // Height is derived from rows-per-column now, not total row count — with
  // columns in play, total-row-count would produce far too much empty
  // vertical space (most of it never gets drawn into).
  var contentH = sections.reduce(function (sum, s) { return sum + sectionTitleH + s.section.height + sectionGap; }, 0);
  var H = padTop + headerH + contentH + footerH;

  var scale = 2;
  var canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  var ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  ctx.fillStyle = RANK_IMG_COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  // Header: logo, player/round count, tournament title, section label
  ctx.font = '700 22px Rajdhani';
  ctx.fillStyle = RANK_IMG_COLORS.cyan;
  ctx.fillText('CFP', padX, padTop + 18);
  var brandW = ctx.measureText('CFP ').width;
  ctx.fillStyle = RANK_IMG_COLORS.text;
  ctx.fillText('TOUR HUB', padX + brandW, padTop + 18);

  ctx.font = '500 12px Inter';
  ctx.fillStyle = RANK_IMG_COLORS.muted;
  ctx.textAlign = 'right';
  var unitPlLower = (getGamemodeDescriptorFor(state).format || {}).unitLabelPlural || 'Players';
  ctx.fillText((state.players || []).length + ' ' + unitPlLower.toLowerCase() + ' · ' + (state.rounds || []).length + ' rounds', W - padX, padTop + 16);
  ctx.textAlign = 'left';

  ctx.font = '600 17px Inter';
  ctx.fillStyle = RANK_IMG_COLORS.text;
  ctx.fillText(truncateToWidth(ctx, (state.title || '').trim() || 'Unnamed Tournament', W - padX * 2), padX, padTop + 48);

  ctx.font = '600 11px Inter';
  ctx.fillStyle = RANK_IMG_COLORS.muted;
  ctx.fillText('FINAL RANKINGS', padX, padTop + 68);

  ctx.strokeStyle = RANK_IMG_COLORS.border;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(padX, padTop + headerH); ctx.lineTo(W - padX, padTop + headerH); ctx.stroke();

  // Sections — each own column-flow block, stacked vertically, same
  // structural split as the DOM (still-active first, ranked below).
  var y = padTop + headerH + 8;
  sections.forEach(function (s) {
    ctx.font = '600 11px Inter';
    ctx.fillStyle = RANK_IMG_COLORS.muted;
    ctx.fillText(s.title, padX, y + 10);
    y += sectionTitleH;

    var sec = s.section;
    for (var c = 0; c < sec.cols; c++) {
      var colX = padX + c * (sec.colW + colGap);
      var colRows = sec.rows.slice(c * sec.rowsPerCol, (c + 1) * sec.rowsPerCol);
      var ry = y;
      colRows.forEach(function (r) {
        drawRankRow(ctx, r, colX, ry, sec.colW, rowH);
        ry += rowH;
      });
    }
    y += sec.height + sectionGap;
  });

  // Footer
  ctx.strokeStyle = RANK_IMG_COLORS.border;
  ctx.beginPath(); ctx.moveTo(padX, y + 6); ctx.lineTo(W - padX, y + 6); ctx.stroke();
  ctx.font = '500 10px Inter';
  ctx.fillStyle = RANK_IMG_COLORS.muted;
  ctx.textAlign = 'center';
  ctx.fillText('Generated by Curve Fever Pro Tour Hub · ' + new Date().toLocaleDateString(), W / 2, y + 22);
  ctx.textAlign = 'left';

  return canvas;
}

// ═══════════════════════════════════════════════════════════════
//  AUTO-REFRESH — Scoreboard and Bracket poll the same in-memory
//  state every 5s so viewers don't need to manually switch tabs to
//  see updates. Only whichever of those two tabs is currently active
//  gets re-rendered (Admin, Players, Rankings are untouched here —
//  Players/Rankings still only refresh on tab visit). Reads T
//  directly, same as every other render call — no separate polling
//  or storage reads, and no saveState() call, since nothing changes.
// ═══════════════════════════════════════════════════════════════
setInterval(function() {
  var activeTab = getActiveTab();
  if (activeTab === 'scoreboard') renderScoreboard();
  else if (activeTab === 'bracket') renderBracket();
}, 5000);
