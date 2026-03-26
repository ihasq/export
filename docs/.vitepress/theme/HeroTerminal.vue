<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from "vue";

const rotateX = ref(0);
const rotateY = ref(0);
const cursorVisible = ref(true);
const activeTab = ref("client");
const bodyRef = ref(null);

// ── Code definitions ────────────────────────────────────────

const CLIENT_SEGMENTS = [
  { text: 'import', cls: 'kw' }, { text: ' { greet, Counter } ', cls: 'p' }, { text: 'from', cls: 'kw' }, { text: ' ', cls: 'p' }, { text: '"https://my-worker.dev/"', cls: 'str' }, { text: ';', cls: 'p' },
  { text: '\n\n', cls: 'p' },
  { text: 'const', cls: 'kw' }, { text: ' msg = ', cls: 'p' }, { text: 'await', cls: 'kw' }, { text: ' ', cls: 'p' }, { text: 'greet', cls: 'fn' }, { text: '(', cls: 'p' }, { text: '"World"', cls: 'str' }, { text: ');', cls: 'p' },
  { text: ' // "Hello, World!"', cls: 'cmt' },
  { text: '\n\n', cls: 'p' },
  { text: 'const', cls: 'kw' }, { text: ' counter = ', cls: 'p' }, { text: 'await', cls: 'kw' }, { text: ' ', cls: 'p' }, { text: 'new', cls: 'kw' }, { text: ' ', cls: 'p' }, { text: 'Counter', cls: 'fn' }, { text: '(0);', cls: 'p' },
  { text: '\n\n', cls: 'p' },
  { text: 'await', cls: 'kw' }, { text: ' counter.', cls: 'p' }, { text: 'increment', cls: 'fn' }, { text: '();', cls: 'p' },
  { text: ' // 1', cls: 'cmt' },
  { text: '\n', cls: 'p' },
  { text: 'await', cls: 'kw' }, { text: ' counter.', cls: 'p' }, { text: 'increment', cls: 'fn' }, { text: '();', cls: 'p' },
  { text: ' // 2', cls: 'cmt' },
];

const SERVER_SEGMENTS = [
  { text: 'export', cls: 'kw' }, { text: ' ', cls: 'p' }, { text: 'async', cls: 'kw' }, { text: ' ', cls: 'p' }, { text: 'function', cls: 'kw' }, { text: ' ', cls: 'p' }, { text: 'greet', cls: 'fn' }, { text: '(', cls: 'p' }, { text: 'name', cls: 'p' }, { text: ': ', cls: 'p' }, { text: 'string', cls: 'tp' }, { text: ') {', cls: 'p' },
  { text: '\n', cls: 'p' },
  { text: '  ', cls: 'p' }, { text: 'return', cls: 'kw' }, { text: ' ', cls: 'p' }, { text: '`Hello, ${', cls: 'str' }, { text: 'name', cls: 'p' }, { text: '}!`', cls: 'str' }, { text: ';', cls: 'p' },
  { text: '\n', cls: 'p' },
  { text: '}', cls: 'p' },
  { text: '\n\n', cls: 'p' },
  { text: 'export', cls: 'kw' }, { text: ' ', cls: 'p' }, { text: 'class', cls: 'kw' }, { text: ' ', cls: 'p' }, { text: 'Counter', cls: 'fn' }, { text: ' {', cls: 'p' },
  { text: '\n', cls: 'p' },
  { text: '  ', cls: 'p' }, { text: 'private', cls: 'kw' }, { text: ' count: ', cls: 'p' }, { text: 'number', cls: 'tp' }, { text: ';', cls: 'p' },
  { text: '\n\n', cls: 'p' },
  { text: '  ', cls: 'p' }, { text: 'constructor', cls: 'fn' }, { text: '(initial = 0) {', cls: 'p' },
  { text: '\n', cls: 'p' },
  { text: '    ', cls: 'p' }, { text: 'this', cls: 'kw' }, { text: '.count = initial;', cls: 'p' },
  { text: '\n', cls: 'p' },
  { text: '  }', cls: 'p' },
  { text: '\n\n', cls: 'p' },
  { text: '  ', cls: 'p' }, { text: 'increment', cls: 'fn' }, { text: '() {', cls: 'p' },
  { text: '\n', cls: 'p' },
  { text: '    ', cls: 'p' }, { text: 'return', cls: 'kw' }, { text: ' ++', cls: 'p' }, { text: 'this', cls: 'kw' }, { text: '.count;', cls: 'p' },
  { text: '\n', cls: 'p' },
  { text: '  }', cls: 'p' },
  { text: '\n', cls: 'p' },
  { text: '}', cls: 'p' },
];

function flatten(segments) {
  const chars = [];
  for (const seg of segments) {
    for (const ch of seg.text) chars.push({ ch, cls: seg.cls });
  }
  return chars;
}

const TABS = {
  client: { title: "client.js", chars: flatten(CLIENT_SEGMENTS) },
  server: { title: "server.ts", chars: flatten(SERVER_SEGMENTS) },
};

// ── Typing state ────────────────────────────────────────────

const typedChars = ref(0);
const lineCount = ref(1);
const currentChars = computed(() => TABS[activeTab.value].chars);
const currentTitle = computed(() => TABS[activeTab.value].title);

let rafId = null;
let typeTimeout = null;

function clearTyping() {
  if (typeTimeout) { clearTimeout(typeTimeout); typeTimeout = null; }
}

function startTyping() {
  clearTyping();
  typedChars.value = 0;
  lineCount.value = 1;

  function typeNext() {
    const chars = currentChars.value;
    if (typedChars.value >= chars.length) {
      typeTimeout = setTimeout(() => {
        typedChars.value = 0;
        lineCount.value = 1;
        typeNext();
      }, 3000);
      return;
    }

    const c = chars[typedChars.value];
    typedChars.value++;
    if (c.ch === "\n") {
      lineCount.value++;
      if (bodyRef.value) bodyRef.value.scrollTop = bodyRef.value.scrollHeight;
    }
    const delay = c.ch === "\n" ? 300 : c.cls === "cmt" ? 25 : 45;
    typeTimeout = setTimeout(typeNext, delay);
  }

  typeNext();
}

function switchTab(tab) {
  if (activeTab.value === tab) return;
  activeTab.value = tab;
  startTyping();
}

// ── Mouse tracking ──────────────────────────────────────────

function onMouseMove(e) {
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    rotateY.value = ((e.clientX - cx) / cx) * 12;
    rotateX.value = ((cy - e.clientY) / cy) * 8;
    rafId = null;
  });
}

onMounted(() => {
  window.addEventListener("mousemove", onMouseMove);
  startTyping();
  const blink = setInterval(() => { cursorVisible.value = !cursorVisible.value; }, 530);
  onUnmounted(() => {
    window.removeEventListener("mousemove", onMouseMove);
    clearInterval(blink);
    clearTyping();
    if (rafId) cancelAnimationFrame(rafId);
  });
});
</script>

<template>
  <div class="hero-terminal-wrapper">
    <div
      class="hero-terminal"
      :style="{
        transform: `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`,
      }"
    >
      <div class="terminal-bar">
        <span class="dot red"></span>
        <span class="dot yellow"></span>
        <span class="dot green"></span>
        <div class="tab-group">
          <button
            class="tab"
            :class="{ active: activeTab === 'client' }"
            @click="switchTab('client')"
          >client.js</button>
          <button
            class="tab"
            :class="{ active: activeTab === 'server' }"
            @click="switchTab('server')"
          >server.ts</button>
        </div>
      </div>
      <div class="terminal-body" ref="bodyRef">
        <div class="line-numbers">
          <span v-for="n in lineCount" :key="n">{{ n }}</span>
        </div>
        <pre class="code"><span
  v-for="(c, i) in currentChars.slice(0, typedChars)"
  :key="`${activeTab}-${i}`"
  :class="c.cls"
>{{ c.ch }}</span><span class="cursor" :class="{ off: !cursorVisible }">|</span></pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hero-terminal-wrapper {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  padding: 0 1rem;
}

.hero-terminal {
  width: 100%;
  max-width: 520px;
  border-radius: 12px;
  overflow: hidden;
  background: #0d0d0d;
  border: 1px solid #222;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.03),
    0 20px 60px rgba(0, 0, 0, 0.6),
    0 0 40px rgba(255, 255, 255, 0.015);
  transition: transform 0.1s ease-out;
  will-change: transform;
}

.terminal-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  background: #161616;
  border-bottom: 1px solid #1e1e1e;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.dot.red { background: #ff5f57; }
.dot.yellow { background: #febc2e; }
.dot.green { background: #28c840; }

.tab-group {
  display: flex;
  gap: 2px;
  margin-left: 12px;
  flex: 1;
}

.tab {
  padding: 3px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #555;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.tab:hover {
  color: #888;
  background: rgba(255, 255, 255, 0.04);
}

.tab.active {
  color: #ccc;
  background: rgba(255, 255, 255, 0.08);
}

.terminal-body {
  display: flex;
  padding: 16px 0;
  min-height: 280px;
  max-height: 280px;
  overflow-y: auto;
  scroll-behavior: smooth;
}

.terminal-body::-webkit-scrollbar {
  width: 4px;
}
.terminal-body::-webkit-scrollbar-track {
  background: transparent;
}
.terminal-body::-webkit-scrollbar-thumb {
  background: #333;
  border-radius: 2px;
}

.line-numbers {
  display: flex;
  flex-direction: column;
  padding: 0 12px 0 16px;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  line-height: 1.7;
  color: #333;
  user-select: none;
  text-align: right;
  min-width: 36px;
}

.code {
  flex: 1;
  margin: 0;
  padding: 0 16px 0 0;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  line-height: 1.7;
  color: #d4d4d4;
  white-space: pre-wrap;
  word-break: break-all;
  overflow: hidden;
  background: none;
}

.code .kw { color: #c586c0; }
.code .str { color: #ce9178; }
.code .fn { color: #dcdcaa; }
.code .tp { color: #4ec9b0; }
.code .cmt { color: #6a9955; }
.code .p { color: #d4d4d4; }

.cursor {
  color: #d4d4d4;
  font-weight: 100;
}
.cursor.off {
  opacity: 0;
}

@media (max-width: 768px) {
  .hero-terminal {
    max-width: 100%;
  }
  .terminal-body {
    min-height: 240px;
  }
  .code, .line-numbers {
    font-size: 11px;
  }
}
</style>
