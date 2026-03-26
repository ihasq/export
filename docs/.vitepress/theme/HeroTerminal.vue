<script setup>
import { ref, onMounted, onUnmounted } from "vue";

const el = ref(null);
const rotateX = ref(0);
const rotateY = ref(0);
const cursorVisible = ref(true);

// Each segment: { text, cls } — cls: kw (keyword), str (string), fn (function/method), cmt (comment), p (punctuation/plain)
const CODE_SEGMENTS = [
  { text: 'import', cls: 'kw' }, { text: ' { greet, Counter }', cls: 'p' },
  { text: '\n  ', cls: 'p' }, { text: 'from', cls: 'kw' }, { text: ' ', cls: 'p' }, { text: '"https://my-worker.dev/"', cls: 'str' }, { text: ';', cls: 'p' },
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

// Flatten all segments into a single character array with class info
const ALL_CHARS = [];
for (const seg of CODE_SEGMENTS) {
  for (const ch of seg.text) {
    ALL_CHARS.push({ ch, cls: seg.cls });
  }
}

let rafId = null;
let typeTimeout = null;

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

const typedChars = ref(0);
const lineCount = ref(1);

function startTyping() {
  typedChars.value = 0;
  lineCount.value = 1;

  function typeNext() {
    if (typedChars.value >= ALL_CHARS.length) {
      typeTimeout = setTimeout(() => {
        typedChars.value = 0;
        lineCount.value = 1;
        typeNext();
      }, 3000);
      return;
    }

    const c = ALL_CHARS[typedChars.value];
    typedChars.value++;
    if (c.ch === "\n") lineCount.value++;
    const delay = c.ch === "\n" ? 300 : c.cls === "cmt" ? 25 : 45;
    typeTimeout = setTimeout(typeNext, delay);
  }

  typeNext();
}

onMounted(() => {
  window.addEventListener("mousemove", onMouseMove);
  startTyping();
  const blink = setInterval(() => { cursorVisible.value = !cursorVisible.value; }, 530);
  onUnmounted(() => {
    window.removeEventListener("mousemove", onMouseMove);
    clearInterval(blink);
    if (typeTimeout) clearTimeout(typeTimeout);
    if (rafId) cancelAnimationFrame(rafId);
  });
});
</script>

<template>
  <div class="hero-terminal-wrapper" ref="el">
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
        <span class="terminal-title">client.js</span>
      </div>
      <div class="terminal-body">
        <div class="line-numbers">
          <span v-for="n in lineCount" :key="n">{{ n }}</span>
        </div>
        <pre class="code"><span
  v-for="(c, i) in ALL_CHARS.slice(0, typedChars)"
  :key="i"
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

.terminal-title {
  flex: 1;
  text-align: center;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: #555;
  margin-right: 42px;
}

.terminal-body {
  display: flex;
  padding: 16px 0;
  min-height: 280px;
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
.code .fn { color: #d4d4d4; }
.code .cmt { color: #6a9955; }

.cursor {
  color: #d4d4d4;
  font-weight: 100;
  animation: none;
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
  .code {
    font-size: 11px;
  }
  .line-numbers {
    font-size: 11px;
  }
}
</style>
