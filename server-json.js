const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'game-data.json');
const PUBLIC = __dirname;

const FIXED_TEAMS = [
  { idx: 0, name: 'Automation/DATA MNV',  color: '#7C3AED', textColor: '#fff', password: 'auto2026'         },
  { idx: 1, name: 'Contrats Maintenance', color: '#DB2777', textColor: '#fff', password: 'contratmaint2026'  },
  { idx: 2, name: 'Indemnisation',        color: '#0891B2', textColor: '#fff', password: 'indim2026'         },
  { idx: 3, name: 'SCG',                  color: '#059669', textColor: '#fff', password: 'datamnv2026'       },
  { idx: 4, name: 'Contrats Projet',      color: '#9333EA', textColor: '#fff', password: 'contratproj2026'   },
  { idx: 5, name: 'IARD/SANTE',           color: '#DC2626', textColor: '#fff', password: 'iard2026'          }
];
const ADMIN_PASSWORD    = 'admin123';
const APPROVER_PASSWORD = 'approver123';

let gameData = {
  game: { id: 1, created_at: new Date().toISOString() },
  teams: [],
  completions: [],
  suggestions: []
};

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      gameData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading data:', e.message);
  }
  initTeams();
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(gameData, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving data:', e.message);
  }
}

function initTeams() {
  FIXED_TEAMS.forEach(t => {
    const exists = gameData.teams.find(team => team.idx === t.idx);
    if (!exists) {
      gameData.teams.push({
        id: gameData.teams.length + 1,
        idx: t.idx,
        name: t.name,
        color: t.color,
        text_color: t.textColor,
        password: t.password,
        points: 0
      });
    } else {
      exists.name = t.name;
      exists.color = t.color;
      exists.text_color = t.textColor;
      exists.password = t.password;
    }
  });
  saveData();
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function sendErr(res, msg, status = 400) {
  sendJson(res, { error: msg }, status);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch(e) { reject(e); } });
    req.on('error', reject);
  });
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, (e, data) => {
    if (e) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });
}

function getTeams(res) {
  const result = gameData.teams.map(t => {
    const completed = {}, answers = {}, approvals = {};
    gameData.completions
      .filter(c => c.team_id === t.id)
      .forEach(c => {
        completed[c.subproc_id] = true;
        answers[c.subproc_id]   = c.answer;
        approvals[c.subproc_id] = c.approval || 'none';
      });
    return { id: t.id, idx: t.idx, name: t.name, color: t.color, text_color: t.text_color, points: t.points, completed, answers, approvals };
  });
  sendJson(res, result);
}

function loginTeam(res, body) {
  const { idx, password } = body;
  if (idx === undefined || !password) return sendErr(res, 'idx and password required', 400);
  const team = gameData.teams.find(t => t.idx === idx);
  if (!team) return sendErr(res, 'Team not found', 404);
  const currentPw = team.password || (FIXED_TEAMS.find(t => t.idx === idx) || {}).password;
  if (password !== currentPw) return sendErr(res, 'Wrong password', 401);
  
  const completed = {}, answers = {}, approvals = {};
  gameData.completions
    .filter(c => c.team_id === team.id)
    .forEach(c => {
      completed[c.subproc_id] = true;
      answers[c.subproc_id] = c.answer;
      approvals[c.subproc_id] = c.approval || 'none';
    });
  sendJson(res, { ok: true, team: { id: team.id, idx: team.idx, name: team.name, color: team.color, text_color: team.text_color, points: team.points, completed, answers, approvals } });
}

function changeTeamPassword(res, teamId, body) {
  const { currentPassword, newPassword } = body;
  if (!currentPassword || !newPassword) return sendErr(res, 'currentPassword and newPassword required');
  if (newPassword.length < 4) return sendErr(res, 'New password must be at least 4 characters');
  const team = gameData.teams.find(t => t.id === teamId);
  if (!team) return sendErr(res, 'Team not found', 404);
  const storedPw = team.password || (FIXED_TEAMS.find(t => t.idx === team.idx) || {}).password;
  if (currentPassword !== storedPw) return sendErr(res, 'Wrong current password', 401);
  team.password = newPassword;
  saveData();
  sendJson(res, { ok: true });
}

function adminChangePassword(res, body) {
  const { adminPassword, teamIdx, newPassword } = body;
  if (adminPassword !== ADMIN_PASSWORD) return sendErr(res, 'Wrong admin password', 401);
  if (teamIdx === undefined || !newPassword) return sendErr(res, 'teamIdx and newPassword required');
  if (newPassword.length < 4) return sendErr(res, 'New password must be at least 4 characters');
  const team = gameData.teams.find(t => t.idx === teamIdx);
  if (team) { team.password = newPassword; saveData(); }
  sendJson(res, { ok: true });
}

function completeTask(res, teamId, body) {
  const { subprocId, answer } = body;
  if (!subprocId) return sendErr(res, 'subprocId required');
  const team = gameData.teams.find(t => t.id === teamId);
  if (!team) return sendErr(res, 'Team not found', 404);
  
  let completion = gameData.completions.find(c => c.team_id === teamId && c.subproc_id === subprocId);
  if (!completion) {
    completion = {
      id: gameData.completions.length + 1,
      team_id: teamId,
      subproc_id: subprocId,
      answer: answer || '',
      completed_at: new Date().toISOString(),
      approval: 'none',
      approved_at: null
    };
    gameData.completions.push(completion);
  } else if (completion.approval !== 'approved') {
    completion.answer = answer || '';
  }
  saveData();
  sendJson(res, { ok: true, points: team.points });
}

function approveTask(res, teamId, body) {
  const { subprocId, adminPassword } = body;
  if (!subprocId) return sendErr(res, 'subprocId required');
  if (adminPassword !== ADMIN_PASSWORD && adminPassword !== APPROVER_PASSWORD) return sendErr(res, 'Wrong password', 401);
  const completion = gameData.completions.find(c => c.team_id === teamId && c.subproc_id === subprocId);
  if (!completion) return sendErr(res, 'Task not completed yet');
  
  completion.approval = 'approved';
  completion.approved_at = new Date().toISOString();
  
  const team = gameData.teams.find(t => t.id === teamId);
  const approvedCount = gameData.completions.filter(c => c.team_id === teamId && c.approval === 'approved').length;
  team.points = approvedCount * 10;
  saveData();
  
  sendJson(res, { ok: true, approval: 'approved', points: team.points });
}

function implementTask(res, teamId, body) {
  const { subprocId, adminPassword } = body;
  if (!subprocId) return sendErr(res, 'subprocId required');
  if (adminPassword !== ADMIN_PASSWORD && adminPassword !== APPROVER_PASSWORD) return sendErr(res, 'Wrong password', 401);
  const completion = gameData.completions.find(c => c.team_id === teamId && c.subproc_id === subprocId);
  if (!completion) return sendErr(res, 'Task not completed yet');
  
  completion.approval = 'implemented';
  completion.approved_at = new Date().toISOString();
  
  const team = gameData.teams.find(t => t.id === teamId);
  const approvedCount = gameData.completions.filter(c => c.team_id === teamId && c.approval === 'approved').length;
  team.points = approvedCount * 10;
  saveData();
  
  sendJson(res, { ok: true, approval: 'implemented', points: team.points });
}

function getSuggestions(res, subprocId) {
  const rows = gameData.suggestions
    .filter(s => s.subproc_id === subprocId)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  sendJson(res, rows);
}

function addSuggestion(res, body) {
  const { subprocId, teamId, text } = body;
  if (subprocId === undefined || subprocId === null || !teamId || !text || !text.trim()) return sendErr(res, 'subprocId, teamId and text required');
  if (text.trim().length < 5) return sendErr(res, 'Suggestion too short (min 5 chars)');
  const team = gameData.teams.find(t => t.id === teamId);
  if (!team) return sendErr(res, 'Team not found (id=' + teamId + ')', 404);
  
  gameData.suggestions.push({
    id: gameData.suggestions.length + 1,
    subproc_id: subprocId,
    team_id: teamId,
    team_name: team.name,
    team_color: team.color,
    text: text.trim(),
    created_at: new Date().toISOString()
  });
  saveData();
  sendJson(res, { ok: true });
}

function resetGame(res, body) {
  if (body.password !== ADMIN_PASSWORD) return sendErr(res, 'Wrong admin password', 401);
  gameData.completions = [];
  gameData.teams.forEach(t => t.points = 0);
  saveData();
  sendJson(res, { ok: true });
}

function resetSuggestions(res, body) {
  if (body.password !== ADMIN_PASSWORD) return sendErr(res, 'Wrong admin password', 401);
  gameData.suggestions = [];
  saveData();
  sendJson(res, { ok: true });
}

function exportCSV(res) {
  const rows = ['Team,Points,Completed Tasks,Total Tasks'];
  gameData.teams.forEach(t => {
    const done = gameData.completions.filter(c => c.team_id === t.id).length;
    rows.push(`"${t.name}",${t.points},${done},73`);
  });
  rows.push('');
  rows.push('Team,SubProcess ID,Answer,Completed At');
  gameData.teams.forEach(t => {
    gameData.completions
      .filter(c => c.team_id === t.id)
      .sort((a, b) => a.subproc_id - b.subproc_id)
      .forEach(c => {
        rows.push(`"${t.name}",${c.subproc_id},"${(c.answer||'').replace(/"/g,'""')}","${c.completed_at}"`);
      });
  });
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="process-eiffel-results.csv"', 'Access-Control-Allow-Origin': '*' });
  res.end(rows.join('\r\n'));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  const m = req.method;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (m === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (p.startsWith('/api/')) {
    let body = {};
    if (m === 'POST') { try { body = await readBody(req); } catch { return sendErr(res, 'Invalid JSON'); } }

    if (p === '/api/teams' && m === 'GET') return getTeams(res);
    if (p === '/api/login' && m === 'POST') return loginTeam(res, body);
    if (p === '/api/reset' && m === 'POST') return resetGame(res, body);
    if (p === '/api/reset/suggestions' && m === 'POST') return resetSuggestions(res, body);
    if (p === '/api/export' && m === 'GET') return exportCSV(res);
    if (p === '/api/admin/password' && m === 'POST') return adminChangePassword(res, body);

    const suggestionsGetMatch = p.match(/^\/api\/suggestions\/(\d+)$/);
    if (suggestionsGetMatch && m === 'GET') return getSuggestions(res, parseInt(suggestionsGetMatch[1]));
    if (p === '/api/suggestions' && m === 'POST') return addSuggestion(res, body);

    const completeMatch = p.match(/^\/api\/teams\/(\d+)\/complete$/);
    if (completeMatch && m === 'POST') return completeTask(res, parseInt(completeMatch[1]), body);

    const approveMatch = p.match(/^\/api\/teams\/(\d+)\/approve$/);
    if (approveMatch && m === 'POST') return approveTask(res, parseInt(approveMatch[1]), body);

    const implementMatch = p.match(/^\/api\/teams\/(\d+)\/implement$/);
    if (implementMatch && m === 'POST') return implementTask(res, parseInt(implementMatch[1]), body);

    const pwMatch = p.match(/^\/api\/teams\/(\d+)\/password$/);
    if (pwMatch && m === 'POST') return changeTeamPassword(res, parseInt(pwMatch[1]), body);

    res.writeHead(404); res.end('API not found');
    return;
  }

  let filePath = path.join(PUBLIC, p === '/' ? 'index.html' : p);
  if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  serveFile(res, filePath);
});

function tryListen(port) {
  server.listen({ port, host: '0.0.0.0' }, () => {
    const ifaces = require('os').networkInterfaces();
    const ips = Object.values(ifaces).flat().filter(i => i.family === 'IPv4' && !i.internal).map(i => i.address);
    console.log(`\nQA Tour Eiffel - Server started on port ${port}!\n`);
    console.log(`   Local:   http://localhost:${port}`);
    ips.forEach(ip => console.log(`   Network: http://${ip}:${port}`));
    console.log(`\n   Share the Network link with the other teams!`);
    console.log(`   To stop: close this window\n`);
  });
}

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    const next = (server.address() ? server.address().port : PORT) + 1;
    console.log(`Port ${PORT} busy, trying ${next}...`);
    server.close(() => tryListen(next));
  } else throw e;
});

process.on('SIGINT',  () => { process.exit(0); });
process.on('SIGTERM', () => { process.exit(0); });
process.on('uncaughtException', e => console.error('Error:', e.message));

loadData();
tryListen(PORT);
