// render-admin.js — Admin-side rendering: the pre-start preview, the live
// running round (rooms, scoring, ties), and the multi-game Finals UI.

// Builds and writes the tie-break banner(s) into #tie-banner-wrap for the
// given round (or clears it if there's nothing unresolved). Shared by
// renderAdminRound (round entry) and scoreChanged (live re-check on every
// score edit). Returns the list of still-unresolved tie keys so callers
// that also need to gate a "Next round" button can check its length. Each
// unresolved cluster shows a button per not-yet-ordered player — clicking
// one appends them to that cluster's resolved order (see resolveTie); the
// banner re-renders showing only the remaining unordered players until the
// last one is implied automatically.
function renderTieBanner(ri, round) {
  var tieWrap = document.getElementById('tie-banner-wrap');
  var ties = getAllTies(ri, round);
  var unresolvedKeys = Object.keys(ties).filter(k => !isTieResolved(k, ties[k]));
  if (unresolvedKeys.length) {
    var bannerHtml = '';
    unresolvedKeys.forEach(k => {
      var t = ties[k];
      var resolvedSoFar = tieResolutionList(T, k);
      var remaining = t.players.filter(p => resolvedSoFar.indexOf(p.name) === -1);
      var dispName = n => esc(unitDisplay(T, n).label);
      var names = t.players.map(p => dispName(p.name)).join(', ');
      var soFarText = resolvedSoFar.length
        ? `Ranked so far: ${resolvedSoFar.map(dispName).join(' > ')} — ` : '';
      var heading = t.rm
        ? `⚠ Tie-break required — Room ${roomLabel(t.rm)} (score ${t.score})`
        : t.groupLabel
        ? `⚠ Tie-break required — Group ${t.groupLabel} qualification cutoff (${t.fp.toFixed(5)} FP)`
        : `⚠ Tie-break required — Qualification cutoff (${t.fp.toFixed(5)} FP)`;
      bannerHtml += `<div class="tie-banner">
        <div><div class="tie-banner-text">${heading}</div>
        <div class="tie-banner-sub">${soFarText}${esc(getGamemodeDescriptor().format.unitLabelPlural)} tied: ${names} — pick who ranks next</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">`;
      remaining.forEach(p => {
        bannerHtml += `<button class="btn btn-sm btn-amber" onclick="resolveTie('${k}','${escAttr(p.name)}')">${dispName(p.name)} ranks next</button>`;
      });
      bannerHtml += `</div></div>`;
    });
    tieWrap.innerHTML = bannerHtml;
  } else {
    tieWrap.innerHTML = '';
  }
  return unresolvedKeys;
}

// --- Round Rendering: schedule preview (shown after Generate, before Start) ---
function renderPreview() {
  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Round</th><th>Players</th><th>Rooms</th><th>Direct advance</th><th>Lucky losers</th><th>Phase</th>' +
    '</tr></thead><tbody>';
  T.rounds.forEach(r => {
    var nm = r.isFinal ? '🏆 Final' : r.isSemis ? '⚔ Semis (R'+r.roundNum+')' :
             r.isQual ? 'R'+r.roundNum+' (Qual)' : r.isSwiss ? 'R'+r.roundNum+' (Swiss)' :
             r.isGroupStage ? 'R'+r.roundNum+' (Group)' : 'Round '+r.roundNum;
    var directAdv = r.isFinal ? '—' : r.isNoElim ? 'All ('+r.players+')' :
              'Top '+r.advPerRoom+' per room = '+(r.advPerRoom*r.rooms.length);
    var lucky = r.luckyCount > 0 ? r.luckyCount + ' (best 7th-place %)' : '—';
    var phase = r.isFinal ? '<span class="pill pill-final">Final</span>' :
                r.isSemis ? '<span class="pill pill-semis">Semis</span>' :
                r.isQual  ? '<span class="pill pill-neut">Qual</span>' :
                r.isSwiss ? '<span class="pill pill-neut">Swiss</span>' :
                r.isGroupStage ? '<span class="pill pill-neut">Group</span>' :
                r.isNoElim ? '<span class="pill pill-neut">No elim</span>' :
                             '<span class="pill pill-adv">Elim</span>';
    // r.byeCount is a generation-time projection only ("Bye" odd-count
    // strategy) — the actual round that ends up needing a bye can shift
    // slightly once live scores/lucky-losers are in play, but this is a
    // reasonable heads-up for what the preview otherwise can't show (rooms
    // summing to one less than players, with no visible reason why).
    var playersCell = r.byeCount ? r.players + ' <span style="color:var(--amber)">(incl. ' + r.byeCount + ' bye)</span>' : r.players;
    // r.pairingTBD (Swiss round 2+ only): the room *count* above is a real
    // projection, but which units land in which room isn't — those pairings
    // depend on live standings that don't exist yet, computed only once
    // advanceRound() actually reaches that round (see swissFoldPair). Say so
    // explicitly rather than let the room-count table imply a fixed,
    // specific pairing that will actually be overwritten.
    var roomsCell = descRooms(r.rooms) + (r.pairingTBD ? ' <span style="color:var(--amber);font-size:10px">(pairings determined live)</span>' : '');
    html += `<tr><td>${nm}</td><td>${playersCell}</td><td>${roomsCell}</td><td>${directAdv}</td><td>${lucky}</td><td>${phase}</td></tr>`;
  });
  html += '</tbody></table></div>';
  document.getElementById('preview-content').innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════
// ROUND RENDERING — Admin Round Render (live only; the main organiser view)
//
// renderAdminRound() is a thin, focus-aware guard around the real work in
// renderAdminRoundNow() — renderRooms()/renderMultiGameFinals() below both
// tear down and rebuild every score <input> via innerHTML, which would
// destroy a focused input (and un-focus the admin mid-keystroke) if called
// while they're actively typing. This matters now that a remote update from
// another admin can trigger a re-render at any moment — see "Multiple
// concurrent admins" in HANDOFF.md. Deferred renders flush on blur via the
// delegated listener below.
// ═══════════════════════════════════════════════════════════════
var adminRenderPending = false;

function isScoreInputFocused() {
  var el = document.activeElement;
  return !!(el && el.classList && el.classList.contains('score-inp'));
}

function renderAdminRound() {
  if (isScoreInputFocused()) { adminRenderPending = true; return; }
  adminRenderPending = false;
  renderAdminRoundNow();
}

// Delegated rather than attached per-input — renderRooms()/
// renderMultiGameFinals() destroy and recreate every .score-inp on each
// render, so a directly-attached listener would need re-attaching every
// time. Attached once, here, at script load.
document.addEventListener('focusout', function (e) {
  if (!adminRenderPending) return;
  if (!e.target || !e.target.classList || !e.target.classList.contains('score-inp')) return;
  setTimeout(function () {
    // One tick later so Tab-navigation between two score inputs (blur the
    // old one, focus the new one) doesn't trigger a spurious mid-navigation
    // repaint — only flush once focus has actually left every score input.
    if (adminRenderPending && !isScoreInputFocused()) { adminRenderPending = false; renderAdminRoundNow(); }
  }, 0);
});

function renderAdminRoundNow() {
  checkReserveWindow();
  var ri = T.curRound, round = T.rounds[ri], asgn = T.assignments[ri] || [];
  document.getElementById('hdr-round').textContent = round.roundNum;
  updateTitleDisplay();

  // Tie-break banner
  var unresolved = renderTieBanner(ri, round);

  // Summary
  var lbl = round.isFinal ? '🏆 Grand Final' : round.isSemis ? '⚔ Semi-Finals' :
            round.isQual ? 'Round '+round.roundNum+' (Qual)' :
            round.isSwiss ? 'Round '+round.roundNum+' (Swiss)' :
            round.isGroupStage ? 'Round '+round.roundNum+' (Group)' :
            round.isNoElim ? 'Round '+round.roundNum+' (No elim)' : 'Round '+round.roundNum;
  document.getElementById('admin-summary').innerHTML =
    statEl('Round', lbl, 'cyan') + statEl(getGamemodeDescriptor().format.unitLabelPlural, asgn.length) +
    statEl('Rooms', round.rooms.length) +
    statEl('Advancing', round.isNoElim ? 'All' : (round.isFinal?'—':(round.advTotal + (round.luckyCount?' + '+round.luckyCount+' LL':''))));

  // Timeline
  var tl = '<div class="timeline">';
  T.rounds.forEach((r, i) => {
    var lbl = r.isFinal ? '🏆' : r.isSemis ? 'S' : r.isQual ? 'Q'+r.roundNum : r.isSwiss ? 'SW'+r.roundNum : r.isGroupStage ? 'G'+r.roundNum : r.roundNum;
    var cls = i < ri ? 'done' : i === ri ? 'current' : '';
    if (i > 0) tl += `<div class="tl-line${i <= ri ? ' done' : ''}"></div>`;
    tl += `<div class="tl-item"><div class="tl-dot ${cls}">${i < ri ? '✓' : lbl}</div>` +
          `<div class="tl-label">${r.isFinal?'Final':r.isSemis?'Semis':'R'+r.roundNum}</div></div>`;
  });
  tl += '</div>';
  document.getElementById('admin-timeline').innerHTML = tl;

  // Reserve panel
  renderReservePanel();
  renderManagePlayers();

  // Standings table (Qualification Table or Swiss), or K per-group tables
  // (Group Stage) — mutually exclusive, never both.
  var isStandingsPhase = T.cfg.poolingPhase !== 'none' && T.rounds.slice(0, ri + 1).some(r => isStandingsRound(r));
  var isGroupStagePhase = T.rounds.slice(0, ri + 1).some(r => r.isGroupStage);
  var qtWrap = document.getElementById('admin-qual-table');
  if (isGroupStagePhase) { qtWrap.style.display = 'block'; qtWrap.innerHTML = renderGroupStandingsTables(); }
  else if (isStandingsPhase) { qtWrap.style.display = 'block'; qtWrap.innerHTML = renderStandingsTable(); }
  else qtWrap.style.display = 'none';

  // Seeding
  var seedHtml = '';
  if (ri > 0 && asgn.length && !isStandingsRound(round) && !round.isGroupStage) {
    var lls = T.luckyLosers[ri] || [];
    seedHtml = '<div class="seed-panel"><div class="seed-title">Room Assignments — ' +
      (round.isFinal ? 'Grand Final' : round.isSemis ? 'Semi-Finals' : 'Round '+round.roundNum) + '</div>';
    if (lls.length) seedHtml += `<div style="font-size:11px;color:var(--purple);margin-bottom:8px">★ = Lucky Loser (best relative score among 7th-place finishers)</div>`;
    seedHtml += '<div class="seed-grid">';
    // A bye entry (room:null) sorts to the front of its comparison (null-0
    // via a.room - b.room) — harmless, it's a single card either way.
    asgn.slice().sort((a,b) => (a.room||0) - (b.room||0) || a.name.localeCompare(b.name)).forEach(p => {
      var isLL = lls.includes(p.name);
      var isBye = p.room === null;
      seedHtml += `<div class="seed-card${(isLL||isBye)?' seed-lucky':''}">
        <span class="seed-player">${isLL?'★ ':''}${renderUnitCell(T, p.name, false)}</span>
        <span class="seed-room${(isLL||isBye)?' lucky':''}">${isBye?'BYE':roomLabel(p.room)}</span></div>`;
    });
    seedHtml += '</div></div>';
  }
  document.getElementById('admin-seeding').innerHTML = seedHtml;

  // Rooms
  // A double-elimination grand final always uses the multi-game/race UI,
  // even while only 1 game has been played so far (round.numGames starts at
  // 1 and grows live — see "Grand-final race format" in HANDOFF.md) — it
  // can never be known in advance to be a single-game Final the way a
  // normal Final's organiser-chosen numGames can.
  if (round.isFinal && (round.numGames > 1 || round.bracket === 'grand-final')) {
    document.getElementById('admin-rooms').style.display = 'none';
    document.getElementById('finals-multi').style.display = 'block';
    renderMultiGameFinals(asgn, round);
  } else {
    document.getElementById('admin-rooms').style.display = 'block';
    document.getElementById('finals-multi').style.display = 'none';
    renderRooms(ri, round, asgn);
  }

  // Buttons
  // A double-elimination grand final round is always the effective end of
  // the line for the "Next Round" button — its own race completion (see
  // checkGrandFinalRace()), not a round advancement, is what ends the
  // tournament.
  var isLast = ri >= T.rounds.length - 1 || round.bracket === 'grand-final';
  var hasTies = unresolved.length > 0;
  var btns = '';
  if (!isLast) btns += `<button class="btn btn-success" onclick="advanceRound()"${hasTies?' disabled title="Resolve tie-breaks first"':''}>Next Round →</button>`;
  if (ri > 0)  btns += `<button class="btn btn-secondary" onclick="goBack()">← Previous</button>`;
  btns += `<button class="btn btn-purple" onclick="saveToArchive()">💾 Save to Archive</button>`;
  btns += `<button class="btn btn-secondary" onclick="resetTournament()">↺ Reset</button>`;
  document.getElementById('admin-btns').innerHTML = btns;
}

function renderReservePanel() {
  var panel = document.getElementById('admin-reserve-panel');
  var isTeam = getGamemodeDescriptor().format.teamSize;
  if (!T.reserves.length && !T.reserveOpen) { panel.innerHTML = ''; return; }
  var html = '<div class="reserve-panel"><div class="reserve-title">Reserves</div>';
  if (!T.reserveOpen) {
    html += '<div class="reserve-status" style="color:var(--red)">⛔ Reserve window closed — eliminations have started.</div></div>';
    panel.innerHTML = html; return;
  }
  if (isTeam) {
    // No "walk-up whole team" quick-add here — a brand-new team needs both
    // a name and its members, which doesn't fit this panel's single text
    // field; walk-up individuals filling a vacant slot in an existing team
    // are handled in Manage Teams instead (see fillVacantSlot()).
    if (T.reserves.length) {
      html += '<div class="reserve-list">';
      T.reserves.forEach(team => {
        html += `<div class="reserve-chip">
          <span class="r-name">${renderUnitCell(T, team.teamId, true)}</span>
          <button onclick="addTeamReserve('${escAttr(team.teamId)}')">＋</button>
          <button onclick="removeTeamReserve('${escAttr(team.teamId)}')">✕</button>
        </div>`;
      });
      html += '</div>';
      html += '<div class="reserve-status">Click ＋ to add a reserve team to the smallest available room. Reserve window closes when eliminations begin.</div>';
    } else {
      html += '<div class="reserve-status">No reserve teams on the bench.</div>';
    }
    html += '</div>';
    panel.innerHTML = html;
    return;
  }
  html += `<div style="display:flex;gap:8px;align-items:flex-end;margin-bottom:12px">
    <div style="flex:1;max-width:260px">
      <input type="text" id="new-player-name" placeholder="Name of a new/walk-up player" onkeydown="if(event.key==='Enter')addNewPlayer()">
    </div>
    <button class="btn btn-amber btn-sm" onclick="addNewPlayer()">＋ Add new player</button>
  </div>`;
  if (T.reserves.length) {
    html += '<div class="reserve-list">';
    T.reserves.forEach(name => {
      html += `<div class="reserve-chip">
        <span class="r-name">${esc(name)}</span>
        <button onclick="addReserve('${escAttr(name)}')">＋</button>
        <button onclick="removeReserve('${escAttr(name)}')">✕</button>
      </div>`;
    });
    html += '</div>';
    html += '<div class="reserve-status">Click ＋ to add a reserve to the smallest available room. Reserve window closes when eliminations begin.</div>';
  } else {
    html += '<div class="reserve-status">No reserves on the bench. Use the field above to add a walk-up player directly.</div>';
  }
  html += '</div>';
  panel.innerHTML = html;
}

// --- Round Rendering: per-room score tables (called from renderAdminRound) ---
// formatDescriptor (optional, defaults to the current gamemode's format).
// Individual formats: one row per player, one score input. Team formats:
// still one <tr> per position (so recalcRoom's existing pos-/stat-/row- DOM
// targeting and CSS row-tinting work completely unchanged), but that row's
// "unit" cell shows the team name + members and its score cell holds one
// input PER MEMBER — scoreChanged() doesn't care that the key has an extra
// "-m{mi}" suffix, so no new score-handling function is needed.
function renderRooms(ri, round, asgn, formatDescriptor) {
  formatDescriptor = formatDescriptor || getGamemodeDescriptor().format;
  var lls = computeLuckyLosers(ri, round);
  var teamSize = formatDescriptor.teamSize;
  // Multi-game Semis (2026-09-08, "Multi-game Semis" in HANDOFF_LOG.md) — a
  // room-based round's Score cell renders numGames small inputs + a running
  // total instead of one input, when this round is multi-game. numGames===1
  // (the overwhelming majority of rounds, and every round before this
  // feature existed) takes the exact original single-input path, unchanged.
  var numGames = round.numGames > 1 ? round.numGames : 1;
  var scoreColWidth = numGames > 1 ? (teamSize ? 90 + 44 * numGames : 60 + 50 * numGames) : (teamSize ? 150 : 110);
  var html = '';
  for (var rm = 1; rm <= round.rooms.length; rm++) {
    var players = asgn.filter(a => a.room === rm);
    var thisAdv = round.isNoElim || round.isFinal ? players.length : round.advPerRoom;

    var roomHeading = round.isGroupStage ? 'Group ' + esc(round.roomGroups[rm - 1]) + ' · Room ' + roomLabel(rm) : 'Room ' + roomLabel(rm);
    html += `<div class="room-block">
      <div class="room-header">
        <div class="room-name">${roomHeading}</div>
        <div class="room-meta">${players.length} ${esc(formatDescriptor.unitLabelPlural.toLowerCase())} · top ${round.isNoElim?'all':thisAdv} advance directly${round.luckyCount?' + lucky losers':''}</div>
      </div>
      <table><thead><tr><th style="width:44px">Pos</th><th>${esc(formatDescriptor.unitLabel)}</th>
      <th style="width:${scoreColWidth}px">Score${numGames>1?' ('+numGames+' games)':''}</th><th style="width:120px">Status</th></tr></thead><tbody>`;

    players.forEach((p, pi) => {
      var key = `r${ri}-rm${rm}-p${pi}`;
      if (teamSize) {
        var team = teamMap(T)[p.name];
        var teamName = team ? team.teamName : p.name;
        var members = (team && team.members) || []; // team truthy doesn't guarantee .members — see renderManageTeams()'s matching fix
        var scoreCell = [];
        for (var mi = 0; mi < teamSize; mi++) {
          var member = members[mi];
          if (!member) {
            scoreCell.push(`<div style="display:flex;align-items:center;gap:6px;margin-bottom:${mi<teamSize-1?4:0}px">
              <input type="number" class="score-inp" style="width:70px" disabled placeholder="—">
              <span style="font-size:11px;color:var(--muted);font-style:italic">Vacant slot</span></div>`);
            continue;
          }
          if (numGames > 1) {
            var memberInputs = [];
            for (var g = 1; g <= numGames; g++) {
              var mgkey = `${key}-g${g}-m${mi}`;
              var mgscore = T.scores[mgkey] !== undefined && T.scores[mgkey] !== null ? T.scores[mgkey] : '';
              memberInputs.push(`<input type="number" class="score-inp" value="${mgscore}" min="0" title="Game ${g}"
                data-key="${mgkey}" data-rm="${rm}" data-ri="${ri}" oninput="scoreChanged(this)">`);
            }
            scoreCell.push(`<div class="score-multi" style="margin-bottom:${mi<teamSize-1?4:0}px">${memberInputs.join('')}<span style="font-size:11px;color:var(--muted)">${esc(member.name)}</span></div>`);
          } else {
            var mkey = `${key}-m${mi}`;
            var mscore = T.scores[mkey] !== undefined && T.scores[mkey] !== null ? T.scores[mkey] : '';
            scoreCell.push(`<div style="display:flex;align-items:center;gap:6px;margin-bottom:${mi<teamSize-1?4:0}px">
              <input type="number" class="score-inp" style="width:70px" value="${mscore}" min="0"
                data-key="${mkey}" data-rm="${rm}" data-ri="${ri}" oninput="scoreChanged(this)">
              <span style="font-size:11px;color:var(--muted)">${esc(member.name)}</span></div>`);
          }
        }
        if (numGames > 1) scoreCell.push(`<div style="margin-top:2px">Total: <span id="total-${key}" class="score-total">—</span></div>`);
        html += `<tr id="row-${key}">
          <td><span class="pos-num" id="pos-${key}">—</span></td>
          <td><strong>${esc(teamName)}</strong></td>
          <td>${scoreCell.join('')}</td>
          <td id="stat-${key}"><span class="pill pill-neut">—</span></td></tr>`;
      } else if (numGames > 1) {
        var gameInputs = [];
        for (var gg = 1; gg <= numGames; gg++) {
          var gkey = `${key}-g${gg}`;
          var gscore = T.scores[gkey] !== undefined && T.scores[gkey] !== null ? T.scores[gkey] : '';
          gameInputs.push(`<input type="number" class="score-inp" value="${gscore}" min="0" title="Game ${gg}"
            data-key="${gkey}" data-rm="${rm}" data-ri="${ri}" oninput="scoreChanged(this)">`);
        }
        html += `<tr id="row-${key}">
          <td><span class="pos-num" id="pos-${key}">—</span></td>
          <td>${esc(p.name)}</td>
          <td><div class="score-multi">${gameInputs.join('')}<span id="total-${key}" class="score-total">—</span></div></td>
          <td id="stat-${key}"><span class="pill pill-neut">—</span></td></tr>`;
      } else {
        var score = T.scores[key] !== undefined && T.scores[key] !== null ? T.scores[key] : '';
        html += `<tr id="row-${key}">
          <td><span class="pos-num" id="pos-${key}">—</span></td>
          <td>${esc(p.name)}</td>
          <td><input type="number" class="score-inp" value="${score}" min="0"
            data-key="${key}" data-rm="${rm}" data-ri="${ri}"
            oninput="scoreChanged(this)"></td>
          <td id="stat-${key}"><span class="pill pill-neut">—</span></td></tr>`;
      }
    });
    html += '</tbody></table>';
    if (!round.isNoElim && !round.isFinal)
      html += `<div class="adv-marker">▲ Top ${thisAdv} advance directly${round.luckyCount ? ' · '+round.luckyCount+' lucky loser spot(s) awarded across all rooms by best relative score' : ''}</div>`;
    html += '</div>';
  }
  // Bye recipient for this round ("Bye" odd-count strategy) — no room/score
  // entry for them; a bye entry (room:null) never matches the per-room
  // filter the loop above uses, so they're already excluded from every
  // room's table above without any special-casing there.
  if (T.byes && T.byes[ri] && T.byes[ri].length) {
    T.byes[ri].forEach(function (byeUnit) {
      html += `<div class="sb-bye-card" style="margin-bottom:16px"><span class="sb-bye-label">BYE</span><span class="sb-bye-name">${esc(unitDisplay(T, byeUnit).label)}</span><span style="margin-left:auto;font-size:11px;color:var(--muted)">Advances automatically — no room this round</span></div>`;
    });
  }
  document.getElementById('admin-rooms').innerHTML = html;
  recalcAll();
}

// ═══════════════════════════════════════════════════════════════
// SCORING & TIE-BREAKS — Scoring (organiser data entry, live only)
// ═══════════════════════════════════════════════════════════════
function scoreChanged(input) {
  var key = input.dataset.key;
  var rm = parseInt(input.dataset.rm), ri = parseInt(input.dataset.ri);
  T.scores[key] = input.value === '' ? null : parseInt(input.value);
  if (typeof syncDirtyScoreKeys !== 'undefined') syncDirtyScoreKeys.add(key);
  invalidateStaleTieResolutions(ri, rm);
  recalcRoom(rm, ri);
  if (T.rounds[T.curRound] && isStandingsRound(T.rounds[T.curRound])) updateQualTable();
  if (T.rounds[T.curRound] && T.rounds[T.curRound].isGroupStage) updateGroupStandings();
  // Re-render tie banner if needed
  var unresolved = renderTieBanner(T.curRound, T.rounds[T.curRound]);
  // Update Next button
  var nextBtn = document.querySelector('#admin-btns .btn-success');
  if (nextBtn) nextBtn.disabled = unresolved.length > 0;
  markDirty();
  saveState();
}

function recalcAll() {
  var ri = T.curRound, round = T.rounds[ri];
  for (var rm = 1; rm <= round.rooms.length; rm++) recalcRoom(rm, ri);
}

function recalcRoom(rm, ri) {
  var round = T.rounds[ri];
  var asgn = (T.assignments[ri] || []).filter(a => a.room === rm);
  var thisAdv = round.isNoElim || round.isFinal ? asgn.length : round.advPerRoom;
  var lls = computeLuckyLosers(ri, round);

  var raw = [];
  var piByName = {};
  // Partial-sum total, tracked alongside the rank-affecting score (2026-09-08,
  // "Multi-game Semis" in HANDOFF_LOG.md) — fallback=0 so the live #total-*
  // display grows game by game as a multi-game room is scored, matching
  // Bracket's own Finals total (finalsProgressState()'s identical fallback:0
  // reasoning), rather than sitting at "—" until every game is in like the
  // rank-affecting `parsed` (fallback=null) below correctly does.
  var scoreByPi = {};
  asgn.forEach((p, pi) => {
    var parsed = getUnitScore(T, ri, rm, pi, null);
    piByName[p.name] = pi;
    scoreByPi[pi] = getUnitScore(T, ri, rm, pi, 0);
    if (parsed !== null) raw.push({ pi, name: p.name, score: parsed });
  });
  var scored = orderRoomByScore(raw, ri, rm);
  var rankMap = {};
  scored.forEach((s, idx) => { rankMap[s.pi] = idx + 1; });

  // Map each tied player's position index to the cluster key covering them,
  // so a still-unresolved tie shows the ⚠ pill regardless of round type.
  var ties = detectTieBreaks(ri, round);
  var tieKeyByPi = {};
  Object.keys(ties).forEach(k => {
    if (ties[k].rm !== rm) return;
    ties[k].players.forEach(p => { if (piByName[p.name] !== undefined) tieKeyByPi[piByName[p.name]] = k; });
  });

  asgn.forEach((p, pi) => {
    var key = `r${ri}-rm${rm}-p${pi}`;
    var rank = rankMap[pi];
    var rowEl = document.getElementById('row-' + key);
    var posEl = document.getElementById('pos-' + key);
    var stEl  = document.getElementById('stat-' + key);
    if (!rowEl) return;

    // Multi-game Semis running total — present only when this round is
    // multi-game (renderRooms() only emits the element then); updates live,
    // including while still partially scored.
    var totalEl = document.getElementById('total-' + key);
    if (totalEl) totalEl.textContent = scoreByPi[pi];

    rowEl.className = '';
    if (rank === undefined) {
      posEl.textContent = '—'; posEl.className = 'pos-num';
      stEl.innerHTML = '<span class="pill pill-neut">—</span>'; return;
    }

    posEl.textContent = rank;
    posEl.className = 'pos-num' + (rank <= thisAdv ? ' top' : '');

    var pTieKey = tieKeyByPi[pi];
    if (pTieKey && !isTieResolved(pTieKey, ties[pTieKey])) {
      stEl.innerHTML = '<span class="pill pill-tie">⚠ Tie</span>';
      rowEl.className = 'tie-row';
    } else if (round.isNoElim) {
      stEl.innerHTML = '<span class="pill pill-adv">Advances</span>';
      rowEl.className = 'adv-row';
    } else if (rank <= thisAdv) {
      stEl.innerHTML = '<span class="pill pill-adv">Advances</span>';
      rowEl.className = 'adv-row';
    } else if (lls.includes(p.name)) {
      stEl.innerHTML = '<span class="pill pill-lucky">★ Lucky Loser</span>';
      rowEl.className = 'lucky-row';
    } else {
      stEl.innerHTML = '<span class="pill pill-elim">Eliminated</span>';
      rowEl.className = 'elim-row';
    }
  });
}

// Appends winnerName to this tie key's resolved order — "ranks next among
// the still-tied players." A 2-way tie resolves in one click, same as
// before; a larger cluster takes one click per player until only one
// remains, at which point it's implied and hasPendingTies() clears.
function resolveTie(key, winnerName) {
  var list = tieResolutionList(T, key).slice();
  if (list.indexOf(winnerName) === -1) list.push(winnerName);
  T.tieResolutions[key] = list;
  renderAdminRound();
  markDirty();
  saveState();
}

// --- Round Rendering: multi-game Final (best-of-N cumulative scoring), and
// the double-elimination grand final's own open-ended race variant ---
// T.finalScores keyed "game{g}-{playerName}" for individual formats, or
// "game{g}-{teamId}-m{mi}" per member for team formats — finalScoreChanged()
// just stores whatever key it's given, so no team-aware variant is needed
// there; only the HTML generation (one row vs. one row with N inputs) differs.
function renderMultiGameFinals(asgn, round) {
  var ng = round.numGames;
  var isGrandFinal = round.bracket === 'grand-final';
  var teamSize = getGamemodeDescriptor().format.teamSize;
  var raceHtml = '';
  if (isGrandFinal) {
    var race = computeGrandFinalRaceState(T, T.curRound, round);
    if (race) {
      raceHtml = `<div style="margin-bottom:10px;font-size:13px">
        <span style="color:var(--cyan)">${esc(unitDisplay(T, race.wbName).label)}</span> (Winners' bracket): <strong>${race.wbWins}</strong> / ${race.wbTarget} &nbsp;·&nbsp;
        <span style="color:var(--amber)">${esc(unitDisplay(T, race.lbName).label)}</span> (Losers' bracket): <strong>${race.lbWins}</strong> / ${race.lbTarget}
        ${race.decided ? ' &nbsp;·&nbsp; 🏆 ' + esc(unitDisplay(T, race.winnerName).label) + ' wins the Grand Final!' : ''}
      </div>`;
    }
  }
  var tabs = '<div class="game-tabs">';
  for (var g = 1; g <= ng; g++) tabs += `<div class="game-tab${g===1?' active':''}" onclick="switchGameTab(${g})" id="gtab-${g}">Game ${g}</div>`;
  tabs += `<div class="game-tab" onclick="switchGameTab(0)" id="gtab-0">📊 Total</div></div>`;
  var content = '<div id="fg-wrap">';
  for (var g = 1; g <= ng; g++) {
    content += `<div id="fg-${g}" style="${g===1?'':'display:none'}"><table><thead><tr><th>${teamSize?'Team':'Player'}</th><th>Score G${g}</th></tr></thead><tbody>`;
    asgn.forEach(p => {
      if (teamSize) {
        var team = teamMap(T)[p.name];
        var teamName = team ? team.teamName : p.name;
        var members = (team && team.members) || []; // team truthy doesn't guarantee .members — see renderManageTeams()'s matching fix
        var cells = [];
        for (var mi = 0; mi < teamSize; mi++) {
          var member = members[mi];
          if (!member) { cells.push(`<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><input type="number" class="score-inp" style="width:70px" disabled placeholder="—"><span style="font-size:11px;color:var(--muted);font-style:italic">Vacant</span></div>`); continue; }
          var mkey = `game${g}-${p.name}-m${mi}`;
          var mval = T.finalScores[mkey] !== undefined ? T.finalScores[mkey] : '';
          cells.push(`<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><input type="number" class="score-inp" style="width:70px" value="${mval}" min="0" data-fkey="${esc(mkey)}" oninput="finalScoreChanged(this)"><span style="font-size:11px;color:var(--muted)">${esc(member.name)}</span></div>`);
        }
        content += `<tr><td><strong>${esc(teamName)}</strong></td><td>${cells.join('')}</td></tr>`;
      } else {
        var key = `game${g}-${p.name}`;
        var val = T.finalScores[key] !== undefined ? T.finalScores[key] : '';
        content += `<tr><td>${esc(p.name)}</td><td><input type="number" class="score-inp" value="${val}" min="0" data-fkey="${esc(key)}" oninput="finalScoreChanged(this)"></td></tr>`;
      }
    });
    content += '</tbody></table></div>';
  }
  content += `<div id="fg-0" style="display:none">${renderFinalsTotal(asgn, ng)}</div></div>`;
  document.getElementById('finals-multi').innerHTML = raceHtml + tabs + content;
}

function renderFinalsTotal(asgn, ng) {
  var teamSize = getGamemodeDescriptor().format.teamSize;
  var rows = asgn.map(p => {
    var total = 0;
    for (var g = 1; g <= ng; g++) total += getFinalUnitScore(T, p.name, g, 0);
    return { name: p.name, total };
  }).sort((a, b) => b.total - a.total);
  var html = `<table><thead><tr><th>Pos</th><th>${teamSize?'Team':'Player'}</th>`;
  for (var g = 1; g <= ng; g++) html += `<th>G${g}</th>`;
  html += '<th>Total</th></tr></thead><tbody>';
  rows.forEach((p, i) => {
    html += `<tr class="${i===0?'adv-row':''}"><td><span class="pos-num${i===0?' top':''}">${i+1}</span></td><td>${renderUnitCell(T, p.name, false)}</td>`;
    for (var g = 1; g <= ng; g++) { var s = getFinalUnitScore(T, p.name, g, null); html += `<td>${s!==null?s:'—'}</td>`; }
    html += `<td style="font-family:var(--font-d);font-size:16px;font-weight:700;color:var(--cyan)">${p.total}</td></tr>`;
  });
  return html + '</tbody></table>';
}

function switchGameTab(g) {
  document.querySelectorAll('.game-tab').forEach(t => t.classList.remove('active'));
  var gtab = document.getElementById('gtab-' + g);
  if (gtab) gtab.classList.add('active');
  document.querySelectorAll('[id^="fg-"]').forEach(el => el.style.display = 'none');
  var panel = document.getElementById('fg-' + g);
  if (panel) {
    panel.style.display = 'block';
    if (g === 0) panel.innerHTML = renderFinalsTotal(T.assignments[T.curRound] || [], T.rounds[T.curRound].numGames);
  }
}

function finalScoreChanged(input) {
  T.finalScores[input.dataset.fkey] = input.value === '' ? '' : parseInt(input.value);
  if (typeof syncDirtyFinalScoreKeys !== 'undefined') syncDirtyFinalScoreKeys.add(input.dataset.fkey);
  markDirty();
  saveState();
  if (checkGrandFinalRace()) return; // grand-final race still undecided — not over yet
  checkAutoArchive();
}
