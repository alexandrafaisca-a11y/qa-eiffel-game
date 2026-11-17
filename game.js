/* ============================================================
   Process Eiffel Tower Challenge — Game Logic
   ============================================================ */

const TOTAL_SUBPROCS = 73;
const POINTS_PER_TASK = 10;
const MAX_POINTS = TOTAL_SUBPROCS * POINTS_PER_TASK;
const MIN_ANSWER_CHARS = 0;
const POLL_INTERVAL = 30000; // 30s

let state = {
  teams: [],
  currentTeamIdx: null,
  currentPhaseIdx: 0,
  currentProcessIdx: null,
  currentSubprocId: null
};

function ensureTeamFields(team) {
  if (!team.completed)  team.completed  = {};
  if (!team.answers)    team.answers    = {};
  if (!team.approvals)  team.approvals  = {};
  return team;
}

let pollTimer = null;

/* ===== API ===== */
const API = {
  getTeams:            ()                          => fetch('/api/teams').then(r => r.json()),
  login:               (idx, pw)                   => fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({idx, password: pw}) }).then(r => r.json()),
  completeTask:        (teamId, subprocId, ans)    => fetch(`/api/teams/${teamId}/complete`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({subprocId, answer: ans}) }).then(r => r.json()),
  approveTask:         (teamId, subprocId, adminPw)=> fetch(`/api/teams/${teamId}/approve`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({subprocId, adminPassword: adminPw}) }).then(r => r.json()),
  reset:               (pw)                        => fetch('/api/reset', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({password: pw}) }).then(r => r.json()),
  resetSuggestions:    (pw)                        => fetch('/api/reset/suggestions', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({password: pw}) }).then(r => r.json()),
  exportCSV:           ()                          => fetch('/api/export').then(r => r.text()),
  changePassword:      (teamId, cur, nw)           => fetch(`/api/teams/${teamId}/password`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({currentPassword: cur, newPassword: nw}) }).then(r => r.json()),
  adminChangePassword: (adminPw, teamIdx, newPw)   => fetch('/api/admin/password', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({adminPassword: adminPw, teamIdx, newPassword: newPw}) }).then(r => r.json()),
  getSuggestions:      (subprocId)                 => fetch(`/api/suggestions/${subprocId}`).then(r => r.json()),
  addSuggestion:       (subprocId, teamId, text)   => fetch('/api/suggestions', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({subprocId, teamId, text}) }).then(r => r.json()),
  implementTask:       (teamId, subprocId, adminPw)=> fetch(`/api/teams/${teamId}/implement`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({subprocId, adminPassword: adminPw}) }).then(r => r.json())
};

/* ===== SESSION PERSISTENCE ===== */
function saveSession() {
  if (state.currentTeamIdx === null) return;
  const team = state.teams[state.currentTeamIdx];
  if (!team) return;
  sessionStorage.setItem('petc_session', JSON.stringify({
    teamIdx: team.idx,
    currentPhaseIdx: state.currentPhaseIdx,
    currentProcessIdx: state.currentProcessIdx,
    currentSubprocId: state.currentSubprocId
  }));
}

function loadSession() {
  try {
    const s = sessionStorage.getItem('petc_session');
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

function clearSession() {
  sessionStorage.removeItem('petc_session');
}

/* ===== SOUNDS ===== */
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function getAudio() {
  if (!audioCtx) audioCtx = new AudioCtx();
  return audioCtx;
}

function playSound(type) {
  try {
    const ctx = getAudio();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (type === 'points') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523, ctx.currentTime);
      osc.frequency.setValueAtTime(659, ctx.currentTime + 0.1);
      osc.frequency.setValueAtTime(784, ctx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
    } else if (type === 'tower') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.15);
      osc.frequency.setValueAtTime(1320, ctx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.4, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.7);
    } else if (type === 'victory') {
      [523,659,784,1047].forEach((f, i) => {
        const o2 = ctx.createOscillator();
        const g2 = ctx.createGain();
        o2.connect(g2); g2.connect(ctx.destination);
        o2.type = 'sine';
        o2.frequency.value = f;
        g2.gain.setValueAtTime(0.3, ctx.currentTime + i*0.15);
        g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i*0.15 + 0.4);
        o2.start(ctx.currentTime + i*0.15);
        o2.stop(ctx.currentTime + i*0.15 + 0.4);
      });
    }
  } catch(e) { /* silently ignore if audio not available */ }
}

/* ===== SCREEN NAV ===== */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => { s.classList.remove('active'); s.style.display = 'none'; });
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = 'flex';
  el.classList.add('active');
  if (id === 'screen-login') renderLoginScreen();
  if (id === 'screen-game')  { saveSession(); renderGameScreen(); startPolling(); }
  if (id === 'screen-login') stopPolling();
}

/* ===== POLLING ===== */
function startPolling() {
  stopPolling();
  pollTimer = setInterval(async () => {
    const fresh = await API.getTeams().catch(() => null);
    if (!fresh) return;
    /* update other teams; keep current team's local state */
    fresh.forEach(ft => {
      const idx = state.teams.findIndex(t => t.id === ft.id);
      if (idx === -1) return;
      if (idx === state.currentTeamIdx) return; // don't overwrite own team mid-session
      state.teams[idx] = ft;
    });
  }, POLL_INTERVAL);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

/* ===== LOAD STATE ===== */
async function loadState() {
  const teams = await API.getTeams().catch(() => []);
  state.teams = teams.map(ensureTeamFields);
}

/* ===== LOGIN ===== */
const TEAM_DEFS = [
  { idx:0, name:'Automation/DATA MNV',  color:'#7C3AED' },
  { idx:1, name:'Contrats Maintenance', color:'#DB2777' },
  { idx:2, name:'Indemnisation',        color:'#0891B2' },
  { idx:3, name:'SCG',                  color:'#059669' },
  { idx:4, name:'Contrats Projet',      color:'#9333EA' },
  { idx:5, name:'IARD/SANTE',           color:'#DC2626' }
];

let selectedTeamIdx = 0;

function renderLoginScreen() {
  const picker = document.getElementById('teamPicker');
  if (!picker) return;
  picker.innerHTML = '';
  TEAM_DEFS.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'team-pick-btn' + (t.idx === selectedTeamIdx ? ' selected' : '');
    btn.style.setProperty('--tc', t.color);
    btn.innerHTML = `<span class="pick-dot" style="background:${t.color}"></span>${escHtml(t.name)}`;
    btn.onclick = () => {
      selectedTeamIdx = t.idx;
      document.getElementById('loginPassword').value = '';
      document.getElementById('loginError').textContent = '';
      document.getElementById('loginPassword').focus();
      renderLoginScreen();
    };
    picker.appendChild(btn);
  });
  renderLoginRanking();
}

function renderLoginRanking() {
  const el = document.getElementById('loginRanking');
  if (!el) return;
  const sorted = [...state.teams].sort((a,b) => b.points - a.points);
  el.innerHTML = sorted.map((t, rank) => {
    const pct = Math.round((t.points / MAX_POINTS) * 100);
    const medals = ['🥇','🥈','🥉'];
    return `<div class="ranking-row">
      <div class="ranking-pos ${['gold','silver','bronze'][rank]||''}">${medals[rank]||(rank+1)}</div>
      <div class="ranking-name" style="color:${t.color}">${escHtml(t.name)}</div>
      <div class="ranking-bar-wrap"><div class="ranking-bar"><div class="ranking-bar-fill" style="width:${pct}%;background:${t.color}"></div></div></div>
      <div class="ranking-pts">${t.points} pts</div>
    </div>`;
  }).join('');
}

async function doLogin() {
  const pw = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  if (!pw) { errEl.textContent = 'Please enter your password.'; return; }

  const result = await API.login(selectedTeamIdx, pw);
  if (!result.ok) {
    errEl.textContent = result.error === 'Wrong password' ? '❌ Incorrect password. Try again.' : result.error;
    document.getElementById('loginPassword').value = '';
    document.getElementById('loginPassword').focus();
    return;
  }

  const fresh = ensureTeamFields(result.team);
  const idx = state.teams.findIndex(t => t.idx === fresh.idx);
  if (idx !== -1) state.teams[idx] = fresh;
  state.currentTeamIdx = idx !== -1 ? idx : 0;
  state.currentPhaseIdx = 0;
  document.getElementById('loginPassword').value = '';
  showScreen('screen-game');
}

function togglePw() {
  const inp = document.getElementById('loginPassword');
  const btn = document.getElementById('pwToggle');
  inp.type = inp.type === 'password' ? 'text' : 'password';
  btn.textContent = inp.type === 'password' ? '👁' : '🙈';
}

/* ===== GAME SCREEN ===== */
function renderGameScreen() {
  if (state.currentTeamIdx === null) { showScreen('screen-login'); return; }
  const team = state.teams[state.currentTeamIdx];
  const badge = document.getElementById('currentTeamBadge');
  badge.textContent = team.name;
  badge.style.background = team.color;
  badge.style.color = team.text_color;
  updateTower();
  renderPhaseNav();
  showPhaseView();
}

/* ===== TOWER ===== */
let prevCompletedProcesses = -1;

function updateTower() {
  const team = state.teams[state.currentTeamIdx];
  const pct = team.points / MAX_POINTS;

  document.getElementById('towerProgressFill').style.width = (pct * 100) + '%';
  document.getElementById('towerProgressText').textContent = Math.round(pct * 100) + '%';
  document.getElementById('currentPoints').textContent = team.points;

  let completedProcesses = 0;
  GAME_DATA.fases.forEach(fase => {
    fase.processos.forEach(proc => {
      const total = proc.subprocessos.length;
      const done  = proc.subprocessos.filter(sp => (team.approvals[sp.id] || 'none') === 'approved').length;
      if (done === total && total > 0) completedProcesses++;
    });
  });

  /* Play tower sound + dramatic animation when a new section lights up */
  if (prevCompletedProcesses >= 0 && completedProcesses > prevCompletedProcesses) {
    playSound('tower');
    /* Find newly lit section and animate it */
    const newlyLitSection = 23 - completedProcesses; /* section number that just lit */
    const sec = document.getElementById('ts' + newlyLitSection);
    if (sec) {
      sec.classList.add('lit');
      sec.classList.add('tower-flash');
      spawnTowerParticles(sec);
      setTimeout(() => sec.classList.remove('tower-flash'), 900);
    }
  }
  prevCompletedProcesses = completedProcesses;

  for (let i = 1; i <= 22; i++) {
    const sec = document.getElementById('ts' + i);
    if (!sec) continue;
    const rank = 23 - i;
    rank <= completedProcesses ? sec.classList.add('lit') : sec.classList.remove('lit');
  }
}

/* ===== PHASE NAV ===== */
function renderPhaseNav() {
  const nav = document.getElementById('phaseNav');
  nav.innerHTML = '';
  const team = state.teams[state.currentTeamIdx];
  GAME_DATA.fases.forEach((fase, i) => {
    const total = fase.processos.reduce((s,p) => s + p.subprocessos.length, 0);
    const done  = fase.processos.reduce((s,p) => s + p.subprocessos.filter(sp => (team.approvals[sp.id] || 'none') === 'approved').length, 0);
    const tab = document.createElement('button');
    tab.className = 'phase-tab' + (i === state.currentPhaseIdx ? ' active' : '');
    if (i === state.currentPhaseIdx) { tab.style.background = fase.cor; tab.style.color = '#fff'; tab.style.borderColor = fase.cor; }
    else { tab.style.color = fase.cor; tab.style.borderColor = fase.cor + '66'; }
    tab.textContent = `${fase.id} (${done}/${total})`;
    tab.onclick = () => { state.currentPhaseIdx = i; state.currentProcessIdx = null; state.currentSubprocId = null; saveSession(); renderPhaseNav(); showPhaseView(); };
    nav.appendChild(tab);
  });
}

/* ===== VIEWS ===== */
function showPhaseView() {
  setView('view-phase');
  const fase = GAME_DATA.fases[state.currentPhaseIdx];
  const team = state.teams[state.currentTeamIdx];
  const total = fase.processos.reduce((s,p) => s + p.subprocessos.length, 0);
  const done  = fase.processos.reduce((s,p) => s + p.subprocessos.filter(sp => (team.approvals[sp.id] || 'none') === 'approved').length, 0);

  const header = document.getElementById('phaseHeader');
  header.style.borderLeftColor = fase.cor;
  header.innerHTML = `<h2 style="color:${fase.cor}">${escHtml(fase.nome)}</h2><p>${done} / ${total} sub-processes completed</p>`;

  const list = document.getElementById('processList');
  list.innerHTML = '';
  fase.processos.forEach((proc, pi) => {
    const ptotal = proc.subprocessos.length;
    const pdone  = proc.subprocessos.filter(sp => (team.approvals[sp.id] || 'none') === 'approved').length;
    const ppct   = ptotal > 0 ? (pdone / ptotal) * 100 : 0;
    const card = document.createElement('div');
    card.className = 'process-card';
    card.innerHTML = `
      <div class="process-number" style="background:${fase.cor};color:#fff">${proc.id}</div>
      <div class="process-info">
        <div class="process-name">${escHtml(proc.nome)}</div>
        <div class="process-progress">
          <div class="process-bar"><div class="process-bar-fill" style="width:${ppct}%;background:${fase.cor}"></div></div>
          <span class="process-count">${pdone}/${ptotal}</span>
        </div>
      </div>
      <div class="process-arrow">${pdone===ptotal&&ptotal>0?'✅':'›'}</div>
    `;
    card.onclick = () => showProcessView(pi);
    list.appendChild(card);
  });
}

function showProcessView(procIdx) {
  if (procIdx !== undefined) state.currentProcessIdx = procIdx;
  state.currentSubprocId = null;
  saveSession();
  setView('view-process');
  const fase = GAME_DATA.fases[state.currentPhaseIdx];
  const proc = fase.processos[state.currentProcessIdx];
  const team = state.teams[state.currentTeamIdx];

  document.getElementById('breadcrumb').innerHTML =
    `<span onclick="showPhaseView()" style="color:${fase.cor};cursor:pointer">${escHtml(fase.nome)}</span>
     <span class="sep">›</span><span>Process ${proc.id}</span>`;
  document.getElementById('processTitle').textContent = `${proc.id}. ${proc.nome}`;
  document.getElementById('processTitle').style.color = fase.cor;

  const list = document.getElementById('subprocList');
  list.innerHTML = '';
  proc.subprocessos.forEach(sp => {
    const submitted = !!team.completed[sp.id];
    const approval  = submitted ? (team.approvals[sp.id] || 'none') : 'none';
    const approved  = approval === 'approved';
    const pending   = approval === 'pending';
    const card = document.createElement('div');
    card.className = 'subproc-card' + (approved ? ' completed' : submitted ? ' submitted' : '');
    card.innerHTML = `
      <div class="subproc-num" style="${approved?'background:#059669;color:#fff':submitted?'background:#D97706;color:#fff':''}">${approved?'✓':submitted?'…':sp.id}</div>
      <div class="subproc-info">
        <div class="subproc-name">${escHtml(sp.nome)}</div>
        <div class="subproc-en">${escHtml(sp.descricao)}</div>
      </div>
      <div class="subproc-status">${approved?'✅':pending?'⏳':submitted?'📋':'›'}</div>
    `;
    card.onclick = () => showTaskView(sp.id);
    list.appendChild(card);
  });
}

function showTaskView(subprocId) {
  state.currentSubprocId = subprocId;
  saveSession();
  setView('view-task');
  const fase = GAME_DATA.fases[state.currentPhaseIdx];
  const proc = fase.processos[state.currentProcessIdx];
  const sp   = proc.subprocessos.find(s => s.id === subprocId);
  const team = state.teams[state.currentTeamIdx];
  const done = !!team.completed[subprocId];

  document.getElementById('breadcrumbTask').innerHTML =
    `<span onclick="showPhaseView()" style="color:${fase.cor};cursor:pointer">${escHtml(fase.nome)}</span>
     <span class="sep">›</span>
     <span onclick="showProcessView()" style="cursor:pointer;color:#666">Process ${proc.id}</span>
     <span class="sep">›</span><span>#${sp.id}</span>`;

  document.getElementById('taskTitle').textContent    = sp.nome;
  document.getElementById('taskDesc').textContent     = sp.descricao;
   document.getElementById('taskTemplate').innerHTML = sp.template;

  const answer = document.getElementById('taskAnswer');
  const approval = done ? (team.approvals[subprocId] || 'none') : 'none';
  const approved = approval === 'approved';
  const pending = done && !approved;
  const draft = !done ? (sessionStorage.getItem(`draft_${team.idx}_${subprocId}`) || '') : '';
  answer.value    = done ? (team.answers[subprocId] || '') : draft;
  answer.disabled = done;

  answer.oninput = () => {
    if (!approved) {
      sessionStorage.setItem(`draft_${team.idx}_${subprocId}`, answer.value);
  updateCharCount(answer.value.length);
  window._currentSubprocId = subprocId;
  loadSuggestions(subprocId);
    }
  };

  updateCharCount(answer.value.length);

  const btn = document.getElementById('validateBtn');
  const editBtn = document.getElementById('editBtn');
  const clearBtn = document.getElementById('clearBtn');
  const taskCard = document.querySelector('.task-card');
  taskCard.querySelector('.task-completed-banner')?.remove();
  taskCard.querySelector('.task-approval-section')?.remove();

  if (done) {
    btn.style.display = 'none';
    editBtn.style.display = pending ? 'inline-block' : 'none';
    clearBtn.style.display = pending ? 'inline-block' : 'none';
    const approval = team.approvals[subprocId] || 'none';

    const banner = document.createElement('div');
    banner.className = 'task-completed-banner';
    if (approval === 'approved') {
      banner.innerHTML = '✅ Answer approved! +10 points earned.';
      banner.style.background = '#f0fdf4';
      banner.style.color = '#059669';
    } else if (approval === 'implemented') {
      banner.innerHTML = '🔵 Process marked as implemented. No points awarded.';
      banner.style.background = '#eff6ff';
      banner.style.color = '#2563eb';
      banner.style.borderColor = '#2563eb';
    } else {
      banner.innerHTML = '📋 Answer submitted. Awaiting final approval to earn points.';
      banner.style.background = '#fffbeb';
      banner.style.color = '#D97706';
      banner.style.borderColor = '#D97706';
    }
    taskCard.appendChild(banner);

    const approvalSection = document.createElement('div');
    approvalSection.className = 'task-approval-section';

    if (approval === 'approved') {
      approvalSection.innerHTML = `
        <div class="approval-badge approved">✅ Final Approved — +10 pts</div>`;
    } else if (approval === 'implemented') {
      approvalSection.innerHTML = `
        <div class="approval-badge implemented">🔵 Marked as Implemented — no points</div>`;
    } else {
      approvalSection.innerHTML = `
        <button class="approval-btn approve-btn" onclick="doManagerApproval(${subprocId})">Final Approval</button>
        <button class="approval-btn implement-btn" onclick="doMarkImplemented(${subprocId})">Mark as Implemented</button>`;
    }
    taskCard.appendChild(approvalSection);
  } else {
    btn.style.display = 'inline-block';
    editBtn.style.display = 'none';
    clearBtn.style.display = 'none';
  }
}

function enableTaskEdit() {
  const answer = document.getElementById('taskAnswer');
  const btn = document.getElementById('validateBtn');
  const editBtn = document.getElementById('editBtn');
  const clearBtn = document.getElementById('clearBtn');
  const taskCard = document.querySelector('.task-card');
  
  answer.disabled = false;
  answer.focus();
  btn.style.display = 'inline-block';
  editBtn.style.display = 'none';
  clearBtn.style.display = 'inline-block';
  
  taskCard.querySelector('.task-completed-banner')?.remove();
  taskCard.querySelector('.task-approval-section')?.remove();
}

function clearTaskAnswer() {
  const answer = document.getElementById('taskAnswer');
  const team = state.teams[state.currentTeamIdx];
  const spId = state.currentSubprocId;
  
  if (!confirm('Clear the answer? This cannot be undone.')) return;
  
  answer.value = '';
  sessionStorage.removeItem(`draft_${team.idx}_${spId}`);
  updateCharCount(0);
  
  const btn = document.getElementById('validateBtn');
  const editBtn = document.getElementById('editBtn');
  const clearBtn = document.getElementById('clearBtn');
  btn.style.display = 'inline-block';
  editBtn.style.display = 'none';
  clearBtn.style.display = 'inline-block';
  answer.focus();
}

async function doManagerApproval(subprocId) {
  const pw = prompt('Approver password (Final Approval):');
  if (!pw) return;
  const team = state.teams[state.currentTeamIdx];
  const result = await API.approveTask(team.id, subprocId, pw).catch(() => ({ ok: false }));
  if (!result.ok) { showToast('❌ ' + (result.error || 'Wrong password')); return; }
  
  team.approvals[subprocId] = 'approved';
  team.points = (result.points || team.points);
  
  updateTower();
  renderPhaseNav();
  playSound('points');
  showPointsAnim();
  checkPhaseCompletion();
  
  if (team.points >= MAX_POINTS) { setTimeout(() => { playSound('victory'); showVictory(); }, 800); return; }
  
  showToast('✅ Task approved! +10 points earned.');
  showTaskView(subprocId);
}

async function doMarkImplemented(subprocId) {
  const pw = prompt('Approver password (Mark as Implemented):');
  if (!pw) return;
  const team = state.teams[state.currentTeamIdx];
  const result = await API.implementTask(team.id, subprocId, pw).catch(() => ({ ok: false }));
  if (!result.ok) { showToast('❌ ' + (result.error || 'Wrong password')); return; }

  team.approvals[subprocId] = 'implemented';
  team.points = (result.points || team.points);

  updateTower();
  renderPhaseNav();

  showToast('🔵 Process marked as implemented.');
  showTaskView(subprocId);
}

function updateCharCount() {}

/* ===== SUGGESTIONS ===== */
async function loadSuggestions(subprocId) {
  const wrap = document.getElementById('suggestionsWrap');
  const list = document.getElementById('suggestionsList');
  if (!wrap || !list) return;
  try {
    const rows = await API.getSuggestions(subprocId);
    if (rows.length === 0) {
      list.innerHTML = '<p class="suggestions-empty">No suggestions yet. Be the first to share a tip!</p>';
    } else {
      list.innerHTML = rows.map(s => {
        const date = new Date(s.created_at).toLocaleString('pt-PT', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
        return `<div class="suggestion-item">
          <div class="suggestion-author">
            <span class="suggestion-dot" style="background:${escHtml(s.team_color)}"></span>
            <strong style="color:${escHtml(s.team_color)}">${escHtml(s.team_name)}</strong>
            <span class="suggestion-date">${date}</span>
          </div>
          <p class="suggestion-text">${escHtml(s.text)}</p>
        </div>`;
      }).join('');
    }
  } catch(e) {
    list.innerHTML = '<p class="suggestions-empty">Could not load suggestions.</p>';
  }
}

async function submitSuggestion(subprocId) {
  const input = document.getElementById('suggestionInput');
  const btn   = document.getElementById('suggestionBtn');
  const text  = input.value.trim();
  const spId  = subprocId || window._currentSubprocId;
  const team  = state.teams[state.currentTeamIdx];

  if (!spId || !team || !team.id) { showToast('❌ Session error. Please reload.'); return; }
  if (!text || text.length < 5) {
    input.style.borderColor = '#DC2626';
    setTimeout(() => { input.style.borderColor = ''; }, 2000);
    return;
  }
  console.log('[submitSuggestion] spId:', spId, 'team.id:', team.id, 'text:', text);
  btn.disabled = true;
  btn.textContent = '...';
  try {
    const result = await API.addSuggestion(spId, team.id, text);
    if (result.ok) {
      input.value = '';
      await loadSuggestions(spId);
      showToast('💡 Suggestion shared!');
    } else {
      showToast('❌ ' + (result.error || 'Error'));
    }
  } catch(e) {
    showToast('❌ Network error');
  } finally {
    btn.disabled = false;
    btn.textContent = '💡 Share';
  }
}

/* ===== VALIDATE ===== */
async function validateTask() {
  const answer = document.getElementById('taskAnswer').value.trim();
  const ta = document.getElementById('taskAnswer');

  if (!answer) {
    ta.style.borderColor = '#DC2626';
    setTimeout(() => { ta.style.borderColor = ''; }, 2000);
    return;
  }

  const team = state.teams[state.currentTeamIdx];
  const spId = state.currentSubprocId;
  if (team.completed[spId] && team.approvals[spId] === 'approved') { showTaskView(spId); return; }

  const btn = document.getElementById('validateBtn');
  btn.disabled = true;
  btn.textContent = 'Submitting...';

  try {
    const result = await API.completeTask(team.id, spId, answer);

    sessionStorage.removeItem(`draft_${team.idx}_${spId}`);

    team.completed[spId] = true;
    team.answers[spId]   = answer;
    if (team.approvals[spId] !== 'approved') team.approvals[spId] = 'none';
    team.points          = result.points;

    updateTower();
    renderPhaseNav();
    showToast('✅ Task submitted! Now send for approval to earn points.');
    showTaskView(spId);
  } catch(e) {
    console.error('Validate error:', e);
  } finally {
    btn.disabled = false;
    btn.textContent = '📤 Submit Answer';
  }
}

/* ===== PHASE CELEBRATION ===== */
function checkPhaseCompletion() {
  const team = state.teams[state.currentTeamIdx];
  const fase = GAME_DATA.fases[state.currentPhaseIdx];
  const total = fase.processos.reduce((s,p) => s + p.subprocessos.length, 0);
  const done  = fase.processos.reduce((s,p) => s + p.subprocessos.filter(sp => (team.approvals[sp.id] || 'none') === 'approved').length, 0);
  if (done === total && total > 0) {
    const key = `phase_celebrated_${team.idx}_${fase.id}`;
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, '1');
      setTimeout(() => showPhaseCelebration(fase), 600);
    }
  }
}

function showPhaseCelebration(fase) {
  playSound('tower');
  const overlay = document.createElement('div');
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:20000;display:flex;align-items:center;justify-content:center;animation:fadeInBg .3s ease;`;
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:24px;padding:44px 40px;text-align:center;max-width:400px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.3);animation:popIn .4s cubic-bezier(.34,1.56,.64,1);">
      <div style="font-size:3.5rem;margin-bottom:8px;">🎉</div>
      <div style="font-size:1rem;font-weight:700;color:#6b7280;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;">Phase Complete!</div>
      <h2 style="color:${fase.cor};font-size:1.6rem;font-weight:900;margin-bottom:12px;">${escHtml(fase.nome)}</h2>
      <p style="color:#6b7280;font-size:.9rem;margin-bottom:28px;">Your team conquered this phase.<br>Keep building the tower! 🗼</p>
      <button onclick="this.closest('div[style]').parentElement.remove()" style="background:${fase.cor};color:#fff;border:none;padding:13px 36px;border-radius:50px;font-size:1rem;font-weight:700;cursor:pointer;">Continue →</button>
    </div>`;
  const st = document.createElement('style');
  st.textContent = `@keyframes fadeInBg{from{opacity:0}to{opacity:1}} @keyframes popIn{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:scale(1)}}`;
  document.head.appendChild(st);
  document.body.appendChild(overlay);
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  setTimeout(() => overlay.remove(), 8000);
}

function showPointsAnim() {
  const el = document.createElement('div');
  el.textContent = '+10 pts!';
  el.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
    background:#7C3AED;color:#fff;font-size:2rem;font-weight:900;
    padding:16px 32px;border-radius:50px;z-index:9999;pointer-events:none;
    animation:ptsAnim .8s ease forwards;`;
  const st = document.createElement('style');
  st.textContent = `@keyframes ptsAnim{0%{opacity:0;transform:translate(-50%,-50%) scale(.5)}
    40%{opacity:1;transform:translate(-50%,-70%) scale(1.1)}
    100%{opacity:0;transform:translate(-50%,-130%) scale(1)}}`;
  document.head.appendChild(st);
  document.body.appendChild(el);
  setTimeout(() => { el.remove(); st.remove(); }, 850);
}

function setView(id) {
  document.querySelectorAll('.game-view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

/* ===== VICTORY ===== */
function showVictory() {
  const team = state.teams[state.currentTeamIdx];
  document.getElementById('victoryTeamName').textContent = team.name;
  document.getElementById('victoryTeamName').style.color = team.color;
  buildPodium();
  showScreen('screen-victory');
  launchConfetti();
  loadState().then(buildPodium);
}

function buildPodium() {
  const sorted = [...state.teams].sort((a,b) => b.points - a.points);
  const podium = document.getElementById('victoryPodium');
  podium.innerHTML = '';
  ['🥇','🥈','🥉'].forEach((medal, i) => {
    if (!sorted[i]) return;
    const t = sorted[i];
    const item = document.createElement('div');
    item.className = 'podium-item';
    item.style.borderColor = t.color;
    item.innerHTML = `<div class="podium-pos">${medal}</div>
      <div class="podium-name" style="color:${t.color}">${escHtml(t.name)}</div>
      <div class="podium-pts">${t.points} pts</div>`;
    podium.appendChild(item);
  });
}

function launchConfetti() {
  const c = document.getElementById('confettiContainer');
  c.innerHTML = '';
  const colors = ['#7C3AED','#DB2777','#0891B2','#059669','#D97706','#DC2626','#FFD700'];
  for (let i = 0; i < 100; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    const col = colors[Math.floor(Math.random()*colors.length)];
    const sz  = 6 + Math.random()*10;
    p.style.cssText = `left:${Math.random()*100}%;width:${sz}px;height:${sz}px;
      background:${col};border-radius:${Math.random()>.5?'50%':'0'};
      animation-duration:${2+Math.random()*3}s;animation-delay:${Math.random()*2}s;`;
    c.appendChild(p);
  }
}

/* ===== CHANGE PASSWORD (team) ===== */
function showChangePwModal() {
  const team = state.teams[state.currentTeamIdx];
  const overlay = document.createElement('div');
  overlay.id = 'changePwOverlay';
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10000;display:flex;align-items:center;justify-content:center;`;
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:32px 28px;max-width:380px;width:90%;box-shadow:0 8px 40px rgba(0,0,0,.2);">
      <h3 style="color:#7C3AED;margin-bottom:20px;font-size:1.1rem;">🔑 Change Password — ${escHtml(team.name)}</h3>
      <label style="display:block;font-size:.8rem;color:#6b7280;margin-bottom:6px;">Current password</label>
      <input id="cpCurrent" type="password" placeholder="Current password" style="width:100%;padding:10px 12px;border:1.5px solid #e5e0ff;border-radius:8px;font-size:.95rem;margin-bottom:14px;font-family:inherit;"/>
      <label style="display:block;font-size:.8rem;color:#6b7280;margin-bottom:6px;">New password</label>
      <input id="cpNew" type="password" placeholder="New password (min 4 chars)" style="width:100%;padding:10px 12px;border:1.5px solid #e5e0ff;border-radius:8px;font-size:.95rem;margin-bottom:6px;font-family:inherit;"/>
      <input id="cpConfirm" type="password" placeholder="Confirm new password" style="width:100%;padding:10px 12px;border:1.5px solid #e5e0ff;border-radius:8px;font-size:.95rem;margin-bottom:8px;font-family:inherit;"/>
      <div id="cpError" style="color:#DC2626;font-size:.8rem;min-height:18px;margin-bottom:14px;"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button onclick="document.getElementById('changePwOverlay').remove()" style="padding:10px 20px;border:1px solid #e5e0ff;border-radius:50px;background:#fff;cursor:pointer;font-size:.9rem;color:#6b7280;">Cancel</button>
        <button onclick="doChangePassword()" style="padding:10px 22px;border:none;border-radius:50px;background:#7C3AED;color:#fff;font-weight:700;cursor:pointer;font-size:.9rem;">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('cpCurrent').focus();
}

async function doChangePassword() {
  const cur = document.getElementById('cpCurrent').value;
  const nw  = document.getElementById('cpNew').value;
  const cf  = document.getElementById('cpConfirm').value;
  const errEl = document.getElementById('cpError');
  errEl.textContent = '';
  if (!cur || !nw || !cf) { errEl.textContent = 'Fill all fields.'; return; }
  if (nw.length < 4) { errEl.textContent = 'New password must be at least 4 characters.'; return; }
  if (nw !== cf) { errEl.textContent = 'Passwords do not match.'; return; }
  const team = state.teams[state.currentTeamIdx];
  const result = await API.changePassword(team.id, cur, nw).catch(() => ({ ok: false, error: 'Network error' }));
  if (!result.ok) { errEl.textContent = result.error === 'Wrong current password' ? '❌ Current password is incorrect.' : result.error; return; }
  document.getElementById('changePwOverlay').remove();
  showToast('✅ Password changed successfully!');
}

/* ===== ADMIN CHANGE PASSWORDS ===== */
function showAdminPwPanel() {
  const overlay = document.createElement('div');
  overlay.id = 'adminPwOverlay';
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10000;display:flex;align-items:center;justify-content:center;`;
  const teamOptions = TEAM_DEFS.map(t => `<option value="${t.idx}">${escHtml(t.name)}</option>`).join('');
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:32px 28px;max-width:400px;width:90%;box-shadow:0 8px 40px rgba(0,0,0,.2);">
      <h3 style="color:#7C3AED;margin-bottom:20px;font-size:1.1rem;">⚙ Admin — Change Team Password</h3>
      <label style="display:block;font-size:.8rem;color:#6b7280;margin-bottom:6px;">Admin password</label>
      <input id="apAdmin" type="password" placeholder="admin123" style="width:100%;padding:10px 12px;border:1.5px solid #e5e0ff;border-radius:8px;font-size:.95rem;margin-bottom:14px;font-family:inherit;"/>
      <label style="display:block;font-size:.8rem;color:#6b7280;margin-bottom:6px;">Team</label>
      <select id="apTeam" style="width:100%;padding:10px 12px;border:1.5px solid #e5e0ff;border-radius:8px;font-size:.95rem;margin-bottom:14px;font-family:inherit;background:#fff;">${teamOptions}</select>
      <label style="display:block;font-size:.8rem;color:#6b7280;margin-bottom:6px;">New password</label>
      <input id="apNew" type="password" placeholder="New password (min 4 chars)" style="width:100%;padding:10px 12px;border:1.5px solid #e5e0ff;border-radius:8px;font-size:.95rem;margin-bottom:8px;font-family:inherit;"/>
      <div id="apError" style="color:#DC2626;font-size:.8rem;min-height:18px;margin-bottom:14px;"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button onclick="document.getElementById('adminPwOverlay').remove()" style="padding:10px 20px;border:1px solid #e5e0ff;border-radius:50px;background:#fff;cursor:pointer;font-size:.9rem;color:#6b7280;">Cancel</button>
        <button onclick="doAdminChangePassword()" style="padding:10px 22px;border:none;border-radius:50px;background:#7C3AED;color:#fff;font-weight:700;cursor:pointer;font-size:.9rem;">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('apAdmin').focus();
}

async function doAdminChangePassword() {
  const adminPw = document.getElementById('apAdmin').value;
  const teamIdx = parseInt(document.getElementById('apTeam').value);
  const newPw   = document.getElementById('apNew').value;
  const errEl   = document.getElementById('apError');
  errEl.textContent = '';
  if (!adminPw || !newPw) { errEl.textContent = 'Fill all fields.'; return; }
  if (newPw.length < 4) { errEl.textContent = 'New password must be at least 4 characters.'; return; }
  const result = await API.adminChangePassword(adminPw, teamIdx, newPw).catch(() => ({ ok: false, error: 'Network error' }));
  if (!result.ok) { errEl.textContent = result.error === 'Wrong admin password' ? '❌ Admin password is incorrect.' : result.error; return; }
  document.getElementById('adminPwOverlay').remove();
  const teamName = TEAM_DEFS.find(t => t.idx === teamIdx)?.name || '';
  showToast(`✅ Password for ${teamName} changed!`);
}

/* ===== TOAST ===== */
function showToast(msg) {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = `position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:#1e1b4b;color:#fff;padding:12px 24px;border-radius:50px;font-size:.9rem;font-weight:600;z-index:9999;pointer-events:none;animation:toastIn .3s ease;`;
  const st = document.createElement('style');
  st.textContent = `@keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}`;
  document.head.appendChild(st);
  document.body.appendChild(el);
  setTimeout(() => { el.remove(); st.remove(); }, 3000);
}

/* ===== ADMIN RESET SUGGESTIONS ===== */
async function adminResetSuggestions() {
  const pw = prompt('Admin password:');
  if (!pw) return;
  if (!confirm('Reset ALL suggestions? This cannot be undone.')) return;
  const result = await API.resetSuggestions(pw);
  if (!result.ok) { alert(result.error || 'Incorrect password.'); return; }
  showToast('✅ All suggestions cleared.');
}

/* ===== ADMIN RESET ===== */
async function adminReset() {
  const pw = prompt('Admin password:');
  if (!pw) return;
  if (!confirm('Reset ALL teams progress? This cannot be undone.')) return;
  const result = await API.reset(pw);
  if (!result.ok) { alert(result.error || 'Incorrect password.'); return; }
  clearSession();
  await loadState();
  showScreen('screen-login');
}

/* ===== EXPORT CSV ===== */
async function exportCSV() {
  const pw = prompt('Admin password:');
  if (!pw) return;
  if (pw !== 'admin123') { alert('Incorrect password.'); return; }
  try {
    const csv = await API.exportCSV();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'process-eiffel-results.csv'; a.click();
    URL.revokeObjectURL(url);
  } catch(e) { alert('Export failed: ' + e.message); }
}

/* ===== TOWER PARTICLES ===== */
function spawnTowerParticles(sectionEl) {
  const rect = sectionEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const colors = ['#FFD700','#FFE566','#FFA500','#fff','#B8860B'];
  for (let i = 0; i < 18; i++) {
    const p = document.createElement('div');
    const angle = (i / 18) * Math.PI * 2;
    const dist  = 40 + Math.random() * 40;
    const tx = Math.cos(angle) * dist;
    const ty = Math.sin(angle) * dist;
    const sz = 4 + Math.random() * 6;
    p.style.cssText = `
      position:fixed;left:${cx}px;top:${cy}px;width:${sz}px;height:${sz}px;
      background:${colors[Math.floor(Math.random()*colors.length)]};
      border-radius:50%;pointer-events:none;z-index:9000;
      transform:translate(-50%,-50%);
      animation:particle .8s ease forwards;
      --tx:${tx}px;--ty:${ty}px;`;
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 850);
  }
  /* Inject keyframe once */
  if (!document.getElementById('particleStyle')) {
    const st = document.createElement('style');
    st.id = 'particleStyle';
    st.textContent = `@keyframes particle{0%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(calc(-50% + var(--tx)),calc(-50% + var(--ty))) scale(0)}}`;
    document.head.appendChild(st);
  }
}


/* ===== HELPERS ===== */
function escHtml(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str));
  return d.innerHTML;
}

/* ===== INIT ===== */
(async () => {
  await loadState();

  /* Restore session if page was refreshed */
  const session = loadSession();
  if (session) {
    const idx = state.teams.findIndex(t => t.idx === session.teamIdx);
    if (idx !== -1) {
      state.currentTeamIdx = idx;
      state.currentPhaseIdx = session.currentPhaseIdx || 0;
      state.currentProcessIdx = session.currentProcessIdx !== undefined ? session.currentProcessIdx : null;
      state.currentSubprocId = session.currentSubprocId || null;
      prevCompletedProcesses = -1;
      showScreen('screen-game');
      if (state.currentSubprocId !== null && state.currentProcessIdx !== null) {
        showTaskView(state.currentSubprocId);
      } else if (state.currentProcessIdx !== null) {
        showProcessView();
      }
      return;
    }
  }
  showScreen('screen-login');
})();
