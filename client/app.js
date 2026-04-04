// ── rag-a2a Client ──────────────────────────────────────────
// Vanilla JS — no frameworks, no build step.

const API = window.location.origin;

// ── API Client ──────────────────────────────────────────────

async function search(query, mode = 'hybrid', topK = 5) {
  const res = await fetch(`${API}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, mode, topK }),
  });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  return res.json();
}

async function askStream(query, onText, onSource, onStatus, onDone, onError) {
  const res = await fetch(`${API}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Ask failed: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = 'message';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        const data = line.slice(6);
        handleSSEEvent(currentEvent, data, onText, onSource, onStatus, onDone, onError);
        currentEvent = 'message';
      }
    }
  }
}

function handleSSEEvent(event, data, onText, onSource, onStatus, onDone, onError) {
  switch (event) {
    case 'message': {
      // [DONE] is a control signal, not display text
      if (data === '[DONE]') {
        onDone();
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch {
        onText(data);
        return;
      }
      // JSON-stringified string from server's sendText()
      if (typeof parsed === 'string') {
        onText(parsed);
        return;
      }
      // Legacy protocol: objects with a type field
      if (parsed && typeof parsed === 'object' && parsed.type) {
        switch (parsed.type) {
          case 'chunk':
            onText(parsed.content);
            return;
          case 'sources':
            if (Array.isArray(parsed.sources)) {
              parsed.sources.forEach((s) => onSource(s));
            }
            return;
          case 'done':
            onDone();
            return;
          case 'error':
            onError({ message: parsed.message || parsed.content || 'Unknown error' });
            return;
        }
      }
      onText(String(parsed));
      break;
    }
    case 'source':
      try { onSource(JSON.parse(data)); } catch {}
      break;
    case 'status':
      try { onStatus(JSON.parse(data)); } catch {}
      break;
    case 'done':
      onDone();
      break;
    case 'error':
      try { onError(JSON.parse(data)); } catch { onError({ message: data }); }
      break;
  }
}

async function getHealth() {
  try {
    const res = await fetch(`${API}/api/health`);
    if (!res.ok) return { status: 'unhealthy' };
    return res.json();
  } catch {
    return { status: 'unhealthy' };
  }
}

async function getStats() {
  try {
    const res = await fetch(`${API}/api/stats`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function getAgentCard() {
  try {
    const res = await fetch(`${API}/.well-known/agent-card.json`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// ── State ───────────────────────────────────────────────────

const state = {
  results: [],
  messages: [],
  stats: null,
  agentCard: null,
  isSearching: false,
  isStreaming: false,
  activeTab: 'search',
};

// ── DOM References ──────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ── Tab Switching ───────────────────────────────────────────

function initTabs() {
  $$('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      state.activeTab = tab;
      $$('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
      $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${tab}`));
    });
  });
}

// ── Search ──────────────────────────────────────────────────

function initSearch() {
  const form = $('#search-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.isSearching) return;

    const query = $('#search-input').value.trim();
    if (!query) return;

    const mode = $('#mode-select').value;
    state.isSearching = true;
    renderSearchBtn();

    try {
      const data = await search(query, mode);
      state.results = data.results || data || [];
      renderResults();
    } catch (err) {
      state.results = [];
      renderResults(err.message);
    } finally {
      state.isSearching = false;
      renderSearchBtn();
    }
  });
}

function renderSearchBtn() {
  const btn = $('#search-btn');
  btn.disabled = state.isSearching;
  btn.innerHTML = state.isSearching
    ? '<span class="spinner"></span>Searching…'
    : 'Search';
}

function renderResults(error) {
  const container = $('#results-container');

  if (error) {
    container.innerHTML = `
      <div class="results-empty">
        <div class="results-empty-icon">⚠️</div>
        <div>${escapeHtml(error)}</div>
      </div>`;
    return;
  }

  if (!state.results.length) {
    container.innerHTML = `
      <div class="results-empty">
        <div class="results-empty-icon">🔍</div>
        <div>No results found. Try a different query or search mode.</div>
      </div>`;
    return;
  }

  container.innerHTML = `<div class="results-list">${state.results
    .map(
      (r, i) => `
    <div class="result-card" style="animation-delay: ${i * 50}ms">
      <div class="result-header">
        <span class="result-source">${escapeHtml(r.metadata?.source || r.metadata?.filename || `chunk-${r.id?.slice(0, 8) || i}`)}</span>
        <span class="result-score">${(r.score ?? 0).toFixed(3)}</span>
      </div>
      <div class="result-content">${escapeHtml(r.content || '')}</div>
    </div>`
    )
    .join('')}</div>`;
}

// ── Chat ────────────────────────────────────────────────────

function initChat() {
  const form = $('#chat-form');
  const input = $('#chat-input');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.isStreaming) return;

    const query = input.value.trim();
    if (!query) return;

    input.value = '';
    addMessage('user', query);
    state.isStreaming = true;
    renderChatBtn();

    const assistantIdx = addMessage('assistant', '', true);

    try {
      let sources = [];
      await askStream(
        query,
        (text) => appendToMessage(assistantIdx, text),
        (src) => { sources.push(src); },
        (_status) => { /* status updates could be shown in UI */ },
        () => {
          finalizeMessage(assistantIdx, sources);
          state.isStreaming = false;
          renderChatBtn();
        },
        (err) => {
          appendToMessage(assistantIdx, `\n\n_Error: ${err.message || 'Unknown error'}_`);
        }
      );
    } catch (err) {
      appendToMessage(assistantIdx, `\n\n_Error: ${err.message}_`);
      finalizeMessage(assistantIdx, []);
      state.isStreaming = false;
      renderChatBtn();
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.dispatchEvent(new Event('submit'));
    }
  });
}

function addMessage(role, content, streaming = false) {
  const idx = state.messages.length;
  state.messages.push({ role, content, streaming, sources: [] });
  renderMessages();
  return idx;
}

function appendToMessage(idx, text) {
  state.messages[idx].content += text;
  renderMessages();
}

function finalizeMessage(idx, sources) {
  state.messages[idx].streaming = false;
  state.messages[idx].sources = sources || [];
  renderMessages();
}

function renderMessages() {
  const container = $('#chat-messages');
  container.innerHTML = state.messages
    .map(
      (msg) => `
    <div class="chat-msg ${msg.role}">
      <div class="chat-avatar">${msg.role === 'user' ? 'You' : 'AI'}</div>
      <div class="chat-bubble${msg.streaming ? ' streaming-cursor' : ''}">
        ${formatMarkdown(msg.content)}
        ${
          msg.sources?.length
            ? `<div class="chat-sources">
                <div class="chat-sources-title">Sources</div>
                ${msg.sources.map((s) => `<span class="chat-source-tag">${escapeHtml(typeof s === 'string' ? s : s.source || s.filename || 'doc')}</span>`).join('')}
              </div>`
            : ''
        }
      </div>
    </div>`
    )
    .join('');

  container.scrollTop = container.scrollHeight;
}

function renderChatBtn() {
  const btn = $('#chat-send-btn');
  btn.disabled = state.isStreaming;
  btn.textContent = state.isStreaming ? 'Streaming…' : 'Send';
}

// ── Sidebar: Stats ──────────────────────────────────────────

async function loadStats() {
  const stats = await getStats();
  state.stats = stats;
  const container = $('#stats-container');
  if (!stats) {
    container.innerHTML = '<div class="stat-row"><span class="stat-label">Unavailable</span></div>';
    return;
  }
  container.innerHTML = `
    <div class="stat-row">
      <span class="stat-label">Documents</span>
      <span class="stat-value accent">${stats.documentCount ?? stats.documents ?? '—'}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Chunks</span>
      <span class="stat-value">${stats.chunkCount ?? stats.chunks ?? '—'}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Index size</span>
      <span class="stat-value">${stats.indexSize ?? stats.index_size ?? '—'}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Last ingest</span>
      <span class="stat-value">${stats.lastIngest ? new Date(stats.lastIngest).toLocaleString() : stats.last_ingest ?? '—'}</span>
    </div>
  `;
}

// ── Sidebar: Health ─────────────────────────────────────────

async function loadHealth() {
  const health = await getHealth();
  const badge = $('#health-badge');
  const label = $('#health-label');
  const status = health?.status === 'ok' || health?.status === 'healthy' ? 'healthy' : 'unhealthy';
  badge.dataset.status = status;
  label.textContent = status === 'healthy' ? 'Healthy' : 'Offline';
}

// ── Sidebar: Agent Card ─────────────────────────────────────

async function loadAgentCard() {
  const card = await getAgentCard();
  state.agentCard = card;
  const container = $('#agent-container');
  if (!card) {
    container.innerHTML = '<div class="agent-desc">Agent card not available</div>';
    return;
  }
  container.innerHTML = `
    <div class="agent-card-info">
      <div class="agent-name">${escapeHtml(card.name || 'rag-a2a')}</div>
      <div class="agent-desc">${escapeHtml(card.description || '')}</div>
      <div class="agent-url">${escapeHtml(card.url || '')}</div>
    </div>
    ${
      card.skills?.length
        ? `<div class="skills-list" style="margin-top: 12px;">
            ${card.skills.map((s) => `<div class="skill-tag"><span class="skill-name">${escapeHtml(s.name || s.id || 'skill')}</span><span class="skill-desc">${escapeHtml(s.description || '')}</span></div>`).join('')}
          </div>`
        : ''
    }
  `;
}

// ── Helpers ──────────────────────────────────────────────────

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatMarkdown(text) {
  if (!text) return '';
  let html = escapeHtml(text);
  // code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  // inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // italic
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  // newlines
  html = html.replace(/\n/g, '<br>');
  return html;
}

// ── Init ────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initSearch();
  initChat();
  loadHealth();
  loadStats();
  loadAgentCard();

  // Refresh health every 30s
  setInterval(loadHealth, 30_000);
});
