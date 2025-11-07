// Simple chat UI logic adapted to the new design and fixed model (gpt-4o-mini)
(function () {
  const form = document.getElementById('chatForm');
  const input = document.getElementById('userInput');
  const messages = document.getElementById('messages');
  const SEND_URL = '/.netlify/functions/chat-proxy';//'/api/chat';
  const FIXED_MODEL = 'gpt-4o-mini';

  // conversation in OpenAI 'messages' shape
  const conversation = [ { role: 'system', content: 'You are a helpful assistant.' } ];

  function timeNow() {
    const d = new Date();
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function createMessageRow(role, text) {
    const row = document.createElement('div');
    row.className = 'msg-row ' + (role === 'user' ? 'user' : 'assistant');

    const avatar = document.createElement('div');
    avatar.className = 'avatar ' + (role === 'user' ? 'user' : 'assistant');
    avatar.textContent = role === 'user' ? 'ME' : 'AI';

    const bubble = document.createElement('div');
    bubble.className = 'msg ' + (role === 'user' ? 'user' : 'assistant');
    bubble.textContent = text;

    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    meta.textContent = timeNow();
    bubble.appendChild(meta);

    if (role === 'user') {
      row.appendChild(bubble);
      row.appendChild(avatar);
    } else {
      row.appendChild(avatar);
      row.appendChild(bubble);
    }

    return { row, bubble };
  }

  function appendMessage(role, text, placeholder = false) {
    const { row, bubble } = createMessageRow(role, text);
    if (placeholder) bubble.classList.add('placeholder');
    messages.appendChild(row);
    messages.scrollTop = messages.scrollHeight;
    return { row, bubble };
  }

  async function sendToServer(messagesArr) {
    try {
      const res = await fetch(SEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: FIXED_MODEL, messages: messagesArr })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Network error');
      }
      const data = await res.json();
      return data.reply ?? (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) ?? JSON.stringify(data);
    } catch (err) {
      return 'Error: ' + (err.message || err);
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    // add user message to conversation and UI (right side)
    conversation.push({ role: 'user', content: text });
    appendMessage('user', text);

    input.value = '';
    input.focus();

    // optimistic placeholder for bot
    const placeholder = appendMessage('assistant', '...', true);

    // send full conversation
    const reply = await sendToServer(conversation);

    // replace placeholder text with real reply
    placeholder.bubble.classList.remove('placeholder');
    placeholder.bubble.textContent = reply;
    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    meta.textContent = timeNow();
    placeholder.bubble.appendChild(meta);

    // push assistant reply to conversation
    conversation.push({ role: 'assistant', content: reply });
  });

  // ensure input can be submitted with Ctrl/Cmd+Enter
  input.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }
  });

  // initialize welcome message
  appendMessage('assistant', 'Hello! Ask me anything.');

  const ta = document.getElementById('userInput');
  if (!ta) return;
  const wrap = ta.closest('.textarea-wrap');

  function updateWrapper() {
    if (!wrap) return;
    if (ta.value && ta.value.trim().length > 0) wrap.classList.add('has-content');
    else wrap.classList.remove('has-content');
  }

  ta.addEventListener('input', updateWrapper);
  ta.addEventListener('focus', () => {
    if (wrap) wrap.classList.add('focused');
    // hide overlay immediately on focus as well
    updateWrapper();
  });
  ta.addEventListener('blur', () => {
    if (wrap) wrap.classList.remove('focused');
    updateWrapper();
  });

  // initialize state on load
  updateWrapper();
})();
