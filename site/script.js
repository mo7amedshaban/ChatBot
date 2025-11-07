// Frontend chat UI logic. This calls POST /api/chat or /api/chat/stream with { messages, model }

const messagesEl = document.getElementById('messages');
const chatForm = document.getElementById('chatForm');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const newChatBtn = document.getElementById('newChatBtn');

const FIXED_MODEL = 'gpt-4o-mini';

let conversation = [
  { role: 'system', content: 'You are a helpful assistant.' }
];

let currentStreamController = null;

function timeNow() {
  const d = new Date();
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderMessage(role, text) {
  const row = document.createElement('div');
  row.className = 'msg-row ' + (role === 'user' ? 'user' : 'assistant');

  const avatar = document.createElement('div');
  avatar.className = 'avatar ' + (role === 'user' ? 'user' : 'assistant');
  avatar.textContent = role === 'user' ? 'ME' : 'AI';

  const bubble = document.createElement('div');
  bubble.className = 'msg ' + (role === 'user' ? 'user' : 'assistant');

  // content wrapper so we can update text without removing the meta timestamp
  const content = document.createElement('div');
  content.className = 'msg-content';
  content.textContent = text;

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  meta.textContent = timeNow();

  bubble.appendChild(content);
  bubble.appendChild(meta);

  // If the message is empty (placeholder) hide bubble styling until text arrives
  if (!text || !String(text).trim()) {
    bubble.classList.add('empty');
  }

  if (role === 'user') {
    // user's messages align to right
    row.appendChild(bubble);
    row.appendChild(avatar);
  } else {
    row.appendChild(avatar);
    row.appendChild(bubble);
  }

  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return { row, bubble, content };
}

function setLoading(isLoading) {
  sendBtn.disabled = isLoading;
  sendBtn.textContent = isLoading ? 'Sending...' : 'Send';
}

// Helper to update assistant content and remove the .empty class on first character
function setAssistantText(assistantEl, text) {
  // remove empty placeholder styling when first content appears
  if (assistantEl && assistantEl.bubble && assistantEl.bubble.classList.contains('empty') && text && String(text).length > 0) {
    assistantEl.bubble.classList.remove('empty');
    assistantEl.bubble.classList.add('transition');
  }
  if (assistantEl && assistantEl.content) {
    assistantEl.content.textContent = text;
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// Simple typing simulation for offline/demo: types `text` into `targetEl` one character at a time
function simulateTyping(targetEl, text, delay = 20) {
  return new Promise((resolve) => {
    let i = 0;
    // ensure bubble styling is visible before typing
    const bubble = targetEl && targetEl.parentElement;
    if (bubble && bubble.classList.contains('empty')) {
      bubble.classList.remove('empty');
      bubble.classList.add('transition');
    }
    // add typing indicator while simulating
    targetEl.classList.add('typing');
    targetEl.textContent = '';
    const id = setInterval(() => {
      targetEl.textContent += text.charAt(i);
      i++;
      messagesEl.scrollTop = messagesEl.scrollHeight;
      if (i >= text.length) {
        clearInterval(id);
        targetEl.classList.remove('typing');
        resolve();
      }
    }, delay);
  });
}

async function sendMessage(contentText) {
  // Cancel any existing stream
  if (currentStreamController) {
    currentStreamController.abort();
    currentStreamController = null;
  }

  // add user message locally
  conversation.push({ role: 'user', content: contentText });
  renderMessage('user', contentText);
  setLoading(true);

  const model = FIXED_MODEL;

  // create assistant placeholder message (will be updated during streaming)
  const assistantEl = renderMessage('assistant', '');
  let assistantText = '';

  try {
    currentStreamController = new AbortController();
    const resp = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: conversation }),
      signal: currentStreamController.signal
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('OpenAI proxy error:', errText);
      // simulate typing an error-friendly fallback so user sees typing
      await simulateTyping(assistantEl.content, 'لا أستطيع الاتصال الآن، هذه رسالة محاكاة.');
      setLoading(false);
      return;
    }

    // add typing class so user sees caret/typing indicator
    assistantEl.content.classList.add('typing');

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      sseBuffer += chunk;

      // Process complete SSE events separated by double newline
      let sepIndex;
      while ((sepIndex = sseBuffer.indexOf('\n\n')) !== -1 || (sepIndex = sseBuffer.indexOf('\r\n\r\n')) !== -1) {
        // prefer \n\n; handle both
        if (sseBuffer.indexOf('\n\n') === -1) sepIndex = sseBuffer.indexOf('\r\n\r\n');
        const event = sseBuffer.slice(0, sepIndex);
        sseBuffer = sseBuffer.slice(sepIndex + (event.includes('\r\n\r\n') ? 4 : 2));

        const lines = event.split(/\r?\n/);
        for (let line of lines) {
          line = line.trim();
          if (!line) continue;
          if (line === 'data: [DONE]' || line === '[DONE]') {
            // finished
            sseBuffer = '';
            break;
          }
          if (line.startsWith('data: ')) {
            const jsonStr = line.replace(/^data: /, '');
            try {
              const parsed = JSON.parse(jsonStr);
              const delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content;
              if (delta) {
                assistantText += delta;
                setAssistantText(assistantEl, assistantText);
              }
            } catch (e) {
              // append raw after removing leading data: if parsing fails
              assistantText += jsonStr;
              setAssistantText(assistantEl, assistantText);
            }
          } else {
            // Try parse full line as JSON or append raw
            try {
              const parsed = JSON.parse(line);
              const delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content;
              if (delta) {
                assistantText += delta;
                setAssistantText(assistantEl, assistantText);
              }
            } catch (e) {
              assistantText += line;
              setAssistantText(assistantEl, assistantText);
            }
          }
        }
      }
    }

    // remove typing indicator once stream finishes
    assistantEl.content.classList.remove('typing');

    // leftover buffer may contain a final event without trailing newlines
    if (sseBuffer) {
      const lines = sseBuffer.split(/\r?\n/);
      for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        if (line.startsWith('data: ')) {
          const jsonStr = line.replace(/^data: /, '');
          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content;
            if (delta) {
              assistantText += delta;
              setAssistantText(assistantEl, assistantText);
            }
          } catch (e) {
            assistantText += jsonStr;
            setAssistantText(assistantEl, assistantText);
          }
        } else {
          try {
            const parsed = JSON.parse(line);
            const delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content;
            if (delta) {
              assistantText += delta;
              setAssistantText(assistantEl, assistantText);
            }
          } catch (e) {
            assistantText += line;
            setAssistantText(assistantEl, assistantText);
          }
        }
      }
    }

    // finalize
    conversation.push({ role: 'assistant', content: assistantText });

  } catch (err) {
    if (err.name === 'AbortError') {
      console.log('Stream aborted');
      assistantEl.content.textContent = '[Cancelled]';
      assistantEl.content.classList.remove('typing');
      assistantEl.bubble.classList.remove('empty');
    } else {
      console.error(err);
      // if streaming fails, simulate typing so user sees the typing effect even when OpenAI is unavailable
      // ensure bubble is visible before simulating
      if (assistantEl && assistantEl.bubble && assistantEl.bubble.classList.contains('empty')) {
        assistantEl.bubble.classList.remove('empty');
        assistantEl.bubble.classList.add('transition');
      }
      await simulateTyping(assistantEl.content, 'تعذر الاتصال بخدمة النموذج — هذه رسالة محاكية للعرض فقط.', 20);

      // fallback to non-streaming request (final content)
      try {
        const fallbackResp = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages: conversation })
        });
        if (fallbackResp.ok) {
          const data = await fallbackResp.json();
          const assistantFinal = data.reply || (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || 'No response';
          setAssistantText(assistantEl, assistantFinal);
          conversation.push({ role: 'assistant', content: assistantFinal });
        } else {
          const errText = await fallbackResp.text();
          assistantEl.content.textContent = 'Error: ' + errText;
        }
      } catch (e) {
        console.error('Fallback error', e);
      }
    }
  } finally {
    setLoading(false);
    currentStreamController = null;
  }
}

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = userInput.value.trim();
  if (!text) return;
  userInput.value = '';
  sendMessage(text);
});

newChatBtn.addEventListener('click', () => {
  // cancel any in-progress streaming
  if (currentStreamController) {
    currentStreamController.abort();
    currentStreamController = null;
  }
  conversation = [ { role: 'system', content: 'You are a helpful assistant.' } ];
  messagesEl.innerHTML = '';
});

// Helpful keyboard shortcuts
userInput.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    sendBtn.click();
  }
});

// Initial welcome message (optional)
renderMessage('assistant', 'Hello! Ask me anything.');
