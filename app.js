// --- HỆ THỐNG GIÁM SÁT IoT 2 CẢM BIẾN TRỰC TIẾP TỪ THINGSPEAK (HC-SR04 & PIR) ---
const TS_API = 'https://api.thingspeak.com';
const THINGSPEAK_CONFIG = {
  channelId: '3576953',
  writeKey: 'LJ7PVHXT20D9T02G',
  readKey: 'RADMVAIRTOD35PA7',
};
const DEFAULT_SETTINGS = {
  pollInterval: '5000',
  resultLimit: '60',
  threshold: '15',
  chirpDuration: '2500',
};

const THINGSPEAK_COOLDOWN_MS = 15500;
const MAX_LINE_POINTS = 30;

const BUCKETS = [
  { label: '< 10',    from: 0,   to: 10 },
  { label: '10–50',   from: 10,  to: 50 },
  { label: '50–100',  from: 50,  to: 100 },
  { label: '100–200', from: 100, to: 200 },
  { label: '200–400', from: 200, to: 401 },
];

const COLORS = {
  safe: '#16a34a',
  warn: '#f59e0b',
  danger: '#dc2626',
  line: '#2563eb',
  pir: '#8b5cf6',
  mute: '#d97706',
  chirp: '#0284c7',
};

const LEVEL_TEXT = { safe: 'An toàn', warn: 'Chú ý', danger: 'Nguy hiểm' };

// Trạng thái dữ liệu đọc từ ThingSpeak
let samples = [];
let latestRawEntry = null;
let latestRemoteCmd = { field5: null, field6: null };
let syncing = true;
let pollTimer = null;
let fetching = false;

// Trạng thái điều khiển Smartkey (Mặc định AUTO)
// controlMode: 'AUTO' | 'MUTED' | 'CHIRP'
let controlMode = 'AUTO';
let chirpTimer = null;
let chirpTickTimer = null;
let chirpEndAt = 0;
let manualLedMode = null; // null (AUTO) | 1 | 0
let webSoundEnabled = true;

// Thống kê thao tác người dùng trong phiên
let totalMutes = 0;
let totalChirps = 0;

// Hàng đợi gửi lệnh Write API lên ThingSpeak (xử lý giới hạn 15s)
let lastWriteAt = 0;
let writing = false;
let pendingCommand = null;
let queueTimer = null;
let queueCountdownTimer = null;

// Web Audio API cho tiếng còi tìm xe
let audioCtx = null;
let activeOscillators = [];
let chirpBeepInterval = null;
let chirpSoundStopTimer = null;

const $ = (id) => document.getElementById(id);

function storageGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch (e) {}
}

function loadConfig() {
  Object.entries(DEFAULT_SETTINGS).forEach(([id, fallback]) => {
    const saved = storageGet('ts_live_' + id);
    $(id).value = saved !== null && saved !== '' ? saved : fallback;
  });
}

function saveConfig() {
  Object.keys(DEFAULT_SETTINGS).forEach((id) => {
    storageSet('ts_live_' + id, $(id).value.trim());
  });
}

function cloudLog(message, type = 'info') {
  const log = $('cloudLog');
  if (!log) return;
  const li = document.createElement('li');
  li.className = type;
  li.textContent = `[${new Date().toLocaleTimeString('vi-VN')}] ${message}`;
  log.prepend(li);
  while (log.children.length > 10) log.lastChild.remove();
}

function setCloudBadge(text, cls) {
  $('cloudBadge').textContent = text;
  $('cloudBadge').className = 'badge ' + (cls || '');
}

function setTopStatus(text, dotCls = '') {
  $('statusText').textContent = text;
  $('statusDot').className = 'dot' + (dotCls ? ' ' + dotCls : '');
}

// --- ÂM THANH CÒI TÌM XE (WEB AUDIO API) ---
function stopWebSound() {
  if (chirpSoundStopTimer) {
    clearTimeout(chirpSoundStopTimer);
    chirpSoundStopTimer = null;
  }
  if (chirpBeepInterval) {
    clearInterval(chirpBeepInterval);
    chirpBeepInterval = null;
  }
  activeOscillators.forEach((osc) => {
    try { osc.stop(); osc.disconnect(); } catch (e) {}
  });
  activeOscillators = [];
}

function playBeepPulse(freq = 2200, durationMs = 180) {
  if (!webSoundEnabled) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

    gain.gain.setValueAtTime(0.001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, audioCtx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + durationMs / 1000);

    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + durationMs / 1000 + 0.02);
    activeOscillators.push(osc);
    osc.onended = () => {
      activeOscillators = activeOscillators.filter((o) => o !== osc);
    };
  } catch (e) {}
}

function startChirpSound(durationMs) {
  stopWebSound();
  if (!webSoundEnabled) return;
  // Kiểu còi tìm xe Smartkey: kêu từng nhịp bíp rõ ràng trong suốt 2–3s
  playBeepPulse(2300, 220);
  chirpBeepInterval = setInterval(() => {
    if (Date.now() < chirpEndAt - 150) {
      playBeepPulse(2300, 220);
    }
  }, 450);
  chirpSoundStopTimer = setTimeout(stopWebSound, durationMs + 50);
}

// --- PHÂN TÍCH DỮ LIỆU THINGSPEAK (CHANNEL 3576953) ---
// field1: PIR (0/1), field2: Khoang cach (cm), field3: Den (0/1),
// field4: Coi (0/1), field5: Lenh bat den (0/1), field6: Lenh bat coi (0/1)
function parseBinaryField(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return n === 0 || n === 1 ? n : null;
}

function evaluateLevel(distance, pir, hwBuzzer) {
  const threshold = Number($('threshold').value) || 15;
  if (hwBuzzer === 1) return 'danger';
  if (distance !== null && distance < threshold) return 'danger';
  if (pir === 1 && distance !== null && distance < threshold * 2.5) return 'danger';
  if (pir === 1) return 'warn';
  if (distance !== null && distance < threshold * 3) return 'warn';
  return 'safe';
}

function parseSensorFeed(feed) {
  // Bỏ qua bản ghi giả lập cũ không đúng chuẩn PIR 0/1 hoặc còi > 1
  if (feed.field1 !== null && feed.field1 !== undefined && feed.field1 !== '') {
    const rawPir = Number(feed.field1);
    if (!Number.isInteger(rawPir) || (rawPir !== 0 && rawPir !== 1)) return null;
  }
  if (feed.field4 !== null && feed.field4 !== undefined && feed.field4 !== '') {
    const rawBuz = Number(feed.field4);
    if (rawBuz !== 0 && rawBuz !== 1) return null;
  }

  const pir = parseBinaryField(feed.field1);
  const hasRawDist = feed.field2 !== null && feed.field2 !== undefined && feed.field2 !== '';
  const rawDistance = hasRawDist ? Number(feed.field2) : null;

  // Bản ghi chỉ gửi lệnh điều khiển (field1 & field2 đều null) -> không đưa vào chuỗi mẫu cảm biến
  if (pir === null && rawDistance === null) return null;

  const validDistance = rawDistance !== null && Number.isFinite(rawDistance) && rawDistance >= 0
    ? Math.round(rawDistance * 100) / 100
    : null;
  const outOfRange = rawDistance !== null && Number.isFinite(rawDistance) && rawDistance < 0;

  const hwLed = parseBinaryField(feed.field3);
  const hwBuzzer = parseBinaryField(feed.field4);
  const cmdLed = parseBinaryField(feed.field5);
  const cmdBuzzer = parseBinaryField(feed.field6);

  const dt = new Date(feed.created_at);
  return {
    entryId: feed.entry_id,
    createdAt: feed.created_at,
    timeShort: dt.toLocaleTimeString('vi-VN'),
    timeFull: dt.toLocaleString('vi-VN'),
    pir,
    rawDistance,
    distance: validDistance,
    outOfRange,
    hwLed,
    hwBuzzer,
    cmdLed,
    cmdBuzzer,
    level: evaluateLevel(validDistance, pir, hwBuzzer),
  };
}

function recomputeLevels() {
  samples.forEach((s) => {
    s.level = evaluateLevel(s.distance, s.pir, s.hwBuzzer);
  });
}

function isCurrentlyAlarming() {
  const last = samples[samples.length - 1];
  if (!last) return false;
  return last.hwBuzzer === 1 || last.level === 'danger';
}

// Đồng bộ trạng thái Auto/Manual với dữ liệu ThingSpeak mới nhất
function syncAutoState() {
  if (controlMode === 'MUTED' && !isCurrentlyAlarming()) {
    controlMode = 'AUTO';
    cloudLog('Cảm biến đã hết nguy hiểm, tự động quay về chế độ AUTO.', 'info');
  }
}

// --- TRẠNG THÁI HIỂN THỊ CÒI & ĐÈN ---
function getEffectiveActuators() {
  const last = samples[samples.length - 1];
  const alarming = isCurrentlyAlarming();

  let buzzerState = 'OFF';
  if (controlMode === 'CHIRP') buzzerState = 'CHIRP';
  else if (controlMode === 'MUTED') buzzerState = 'MUTED';
  else if (alarming) buzzerState = 'ALARM';

  let ledMode = 'OFF';
  if (controlMode === 'CHIRP') {
    ledMode = 'BLUE';
  } else if (manualLedMode === 1) {
    ledMode = alarming ? 'RED' : 'GREEN';
  } else if (manualLedMode === 0) {
    ledMode = 'OFF';
  } else if (last) {
    if (buzzerState === 'ALARM') ledMode = 'RED';
    else if (buzzerState === 'MUTED' || last.level === 'warn') ledMode = 'YELLOW';
    else if (last.hwLed === 1) ledMode = 'GREEN';
    else ledMode = last.level === 'safe' ? 'GREEN' : 'OFF';
  }

  return { buzzerState, ledMode, alarming, last };
}

// --- KHỞI TẠO BIỂU ĐỒ (CHART.JS) ---
const lineChart = new Chart($('lineChart'), {
  type: 'line',
  data: {
    labels: [],
    datasets: [
      {
        label: 'Khoảng cách HC-SR04 (cm)',
        data: [],
        borderColor: COLORS.line,
        backgroundColor: 'rgba(37, 99, 235, 0.12)',
        fill: true,
        tension: 0.25,
        pointRadius: 3,
        spanGaps: false,
        yAxisID: 'y',
      },
      {
        label: 'Ngưỡng cảnh báo (cm)',
        data: [],
        borderColor: COLORS.danger,
        borderDash: [6, 4],
        pointRadius: 0,
        fill: false,
        yAxisID: 'y',
      },
      {
        label: 'Cảm biến PIR (0: Yên tĩnh, 1: Chuyển động)',
        data: [],
        borderColor: COLORS.pir,
        backgroundColor: 'rgba(139, 92, 246, 0.18)',
        stepped: true,
        pointRadius: 3,
        fill: false,
        yAxisID: 'y1',
      },
    ],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    scales: {
      y: {
        type: 'linear',
        position: 'left',
        min: 0,
        title: { display: true, text: 'Khoảng cách HC-SR04 (cm)' },
      },
      y1: {
        type: 'linear',
        position: 'right',
        min: 0,
        max: 1.25,
        grid: { drawOnChartArea: false },
        ticks: {
          stepSize: 1,
          callback: (v) => (v === 1 ? 'Chuyển động' : v === 0 ? 'Yên tĩnh' : ''),
        },
        title: { display: true, text: 'PIR (0 / 1)' },
      },
    },
  },
});

const barChart = new Chart($('barChart'), {
  type: 'bar',
  data: {
    labels: [...BUCKETS.map((b) => b.label + ' cm'), 'Ngoài tầm (-1)', 'PIR (1)'],
    datasets: [
      {
        label: 'Số mẫu ghi nhận',
        data: [0, 0, 0, 0, 0, 0, 0],
        backgroundColor: [
          COLORS.danger,
          COLORS.warn,
          COLORS.line,
          COLORS.line,
          COLORS.safe,
          '#94a3b8',
          COLORS.pir,
        ],
      },
    ],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
  },
});

const pieChart = new Chart($('pieChart'), {
  type: 'doughnut',
  data: {
    labels: ['An toàn', 'Chú ý', 'Nguy hiểm / Báo động'],
    datasets: [
      {
        data: [0, 0, 0],
        backgroundColor: [COLORS.safe, COLORS.warn, COLORS.danger],
      },
    ],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom' } },
  },
});

function updateCharts() {
  const recent = samples.slice(-MAX_LINE_POINTS);
  const threshold = Number($('threshold').value) || 15;

  lineChart.data.labels = recent.map((s) => s.timeShort);
  lineChart.data.datasets[0].data = recent.map((s) => s.distance);
  lineChart.data.datasets[1].data = recent.map(() => threshold);
  lineChart.data.datasets[2].data = recent.map((s) => (s.pir !== null ? s.pir : null));
  lineChart.update();

  const validDistances = samples.filter((s) => s.distance !== null);
  const bucketCounts = BUCKETS.map(
    (b) => validDistances.filter((s) => s.distance >= b.from && s.distance < b.to).length
  );
  const outOfRangeCount = samples.filter((s) => s.outOfRange).length;
  const pirCount = samples.filter((s) => s.pir === 1).length;
  barChart.data.datasets[0].data = [...bucketCounts, outOfRangeCount, pirCount];
  barChart.update();

  const safeCount = samples.filter((s) => s.level === 'safe').length;
  const warnCount = samples.filter((s) => s.level === 'warn').length;
  const dangerCount = samples.filter((s) => s.level === 'danger').length;
  pieChart.data.datasets[0].data = [safeCount, warnCount, dangerCount];
  pieChart.update();
}

function updateSmartkeyUI(buzzerState, alarming, last) {
  const btn = $('btnSmartHorn');
  const icon = $('hornIcon');
  const text = $('hornText');
  const desc = $('hornDesc');
  const badge = $('modeBadge');
  const backBtn = $('btnBackAuto');
  const durSelect = $('chirpDuration');
  const buzzerVal = $('buzzer');
  const buzzerHint = $('buzzerHint');
  const buzzerCard = $('buzzerCard');

  const secLabel = (Number(durSelect.value) / 1000).toString().replace('.', ',') + 's';
  buzzerCard.className = 'card stat';
  backBtn.classList.toggle('hidden', controlMode === 'AUTO' && manualLedMode === null);

  if (buzzerState === 'ALARM') {
    buzzerVal.textContent = 'ĐANG KÊU';
    buzzerHint.textContent = last && last.hwBuzzer === 1 ? 'Còi mạch đang bật (field4=1)' : 'Vượt ngưỡng cảnh báo!';
    buzzerCard.className = 'card stat buzzer-alarm';

    badge.textContent = '🤖 Chế độ: AUTO (Báo động)';
    badge.className = 'mode-pill auto';
    btn.className = 'btn btn-horn alarm';
    icon.textContent = '🔕';
    text.textContent = 'Tắt còi tạm thời (Mute)';
    desc.textContent = 'Còi đang kêu! Bấm nút để tắt còi tạm thời và gửi lệnh tắt (field6=0) lên ThingSpeak.';
  } else if (buzzerState === 'MUTED') {
    buzzerVal.textContent = 'TẮT TẠM THỜI';
    buzzerHint.textContent = 'Đã ngắt còi thủ công';
    buzzerCard.className = 'card stat buzzer-muted';

    badge.textContent = '🖐 MANUAL: Tắt còi tạm thời';
    badge.className = 'mode-pill manual';
    btn.className = 'btn btn-horn muted';
    icon.textContent = '🔔';
    text.textContent = 'Bật lại còi / Về Auto';
    desc.textContent = 'Còi đang bị tắt tạm thời. Bấm để bật lại chế độ Auto hoặc tự động mở lại khi hết nguy hiểm.';
  } else if (buzzerState === 'CHIRP') {
    const leftSec = Math.max(0.1, (chirpEndAt - Date.now()) / 1000).toFixed(1).replace('.', ',');
    buzzerVal.textContent = `KÊU ${leftSec}s`;
    buzzerHint.textContent = 'Đang phát còi tìm xe (field6=1)';
    buzzerCard.className = 'card stat buzzer-chirp';

    badge.textContent = '🖐 MANUAL: Tìm xe (2–3s)';
    badge.className = 'mode-pill chirp';
    btn.className = 'btn btn-horn chirp';
    icon.textContent = '📢';
    text.textContent = `Đang kêu tìm xe (${leftSec}s) · Bấm để dừng`;
    desc.textContent = 'Còi đang kêu tìm xe và sẽ tự động ngắt về AUTO sau khi hết thời gian.';
  } else {
    buzzerVal.textContent = 'TẮT';
    buzzerHint.textContent = last && last.hwBuzzer === 0 ? 'Chế độ Auto (field4=0)' : 'Chế độ Auto';

    badge.textContent = manualLedMode !== null ? '🖐 MANUAL (Đèn)' : '🤖 Chế độ: AUTO';
    badge.className = manualLedMode !== null ? 'mode-pill manual' : 'mode-pill auto';
    btn.className = 'btn btn-horn chirp';
    icon.textContent = '📢';
    text.textContent = `Kêu còi tìm xe (${secLabel})`;
    desc.textContent = `Mặc định AUTO. Còi đang tắt — bấm để kêu ${secLabel} (field6=1) rồi tự tắt về AUTO.`;
  }

  durSelect.disabled = buzzerState === 'ALARM' || buzzerState === 'MUTED' || buzzerState === 'CHIRP';
}

function updateStats() {
  const { buzzerState, ledMode, alarming, last } = getEffectiveActuators();

  // 1. HC-SR04 (field2)
  if (last && last.distance !== null) {
    $('current').textContent = last.distance.toFixed(1) + ' cm';
    $('levelText').textContent = `${LEVEL_TEXT[last.level]} · Entry #${last.entryId}`;
    $('currentCard').className = 'card stat main ' + last.level;
  } else if (last && last.outOfRange) {
    $('current').textContent = 'Ngoài tầm';
    $('levelText').textContent = `field2 = -1 · ${LEVEL_TEXT[last.level]}`;
    $('currentCard').className = 'card stat main ' + last.level;
  } else {
    $('current').textContent = '--';
    $('levelText').textContent = 'Chưa có dữ liệu HC-SR04';
    $('currentCard').className = 'card stat main';
  }

  // 2. PIR (field1)
  if (last && last.pir !== null) {
    if (last.pir === 1) {
      $('pirStatus').textContent = 'CHUYỂN ĐỘNG!';
      $('pirDetail').textContent = 'field1 = 1 (Có người)';
      $('pirCard').className = 'card stat pir-active';
    } else {
      $('pirStatus').textContent = 'Yên tĩnh';
      $('pirDetail').textContent = 'field1 = 0 (Không có CĐ)';
      $('pirCard').className = 'card stat';
    }
  } else {
    $('pirStatus').textContent = '--';
    $('pirDetail').textContent = 'Chưa có dữ liệu PIR';
    $('pirCard').className = 'card stat';
  }

  // 3. Smartkey Buzzer
  updateSmartkeyUI(buzzerState, alarming, last);

  // 4. Đèn LED (field3)
  const ledLight = $('ledLight');
  ledLight.className = 'led-light';
  const hwLedText = last && last.hwLed !== null ? `field3=${last.hwLed}` : 'Chưa rõ';
  if (ledMode === 'RED') {
    ledLight.classList.add('red');
    $('ledStatus').textContent = 'ĐỎ (BÁO ĐỘNG)';
    $('ledHint').textContent = `Cảnh báo nguy hiểm (${hwLedText})`;
  } else if (ledMode === 'YELLOW') {
    ledLight.classList.add('yellow');
    $('ledStatus').textContent = 'VÀNG (CHÚ Ý)';
    $('ledHint').textContent = controlMode === 'MUTED' ? 'Đã tắt còi tạm thời' : `Có mục tiêu (${hwLedText})`;
  } else if (ledMode === 'BLUE') {
    ledLight.classList.add('blue');
    $('ledStatus').textContent = 'XANH LAM (TÌM XE)';
    $('ledHint').textContent = 'Đang phát còi định vị';
  } else if (ledMode === 'GREEN') {
    ledLight.classList.add('green');
    $('ledStatus').textContent = last && last.hwLed === 1 ? 'BẬT (XANH)' : 'XANH (AN TOÀN)';
    $('ledHint').textContent = manualLedMode === 1 ? 'Đang ép bật (field5=1)' : `Theo mạch (${hwLedText})`;
  } else {
    $('ledStatus').textContent = 'TẮT';
    $('ledHint').textContent = manualLedMode === 0 ? 'Đang ép tắt (field5=0)' : `Theo mạch (${hwLedText})`;
  }

  // 5. Trung bình / Min / Max HC-SR04
  const validDistances = samples.filter((s) => s.distance !== null).map((s) => s.distance);
  if (validDistances.length) {
    const sum = validDistances.reduce((a, b) => a + b, 0);
    const minVal = Math.min(...validDistances).toFixed(1);
    const maxVal = Math.max(...validDistances).toFixed(1);
    $('avg').textContent = (sum / validDistances.length).toFixed(1) + ' cm';
    $('minMaxHint').textContent = `Min: ${minVal} · Max: ${maxVal} cm`;
  } else {
    $('avg').textContent = '--';
    $('minMaxHint').textContent = 'Min: -- · Max: --';
  }

  // 6. Tổng mẫu 2 cảm biến
  $('count').textContent = samples.length;
  $('validDistCount').textContent = `HC-SR04 đo được: ${validDistances.length}/${samples.length}`;

  // 7. Báo cáo thống kê
  const dangerCount = samples.filter((s) => s.level === 'danger').length;
  const pirDetections = samples.filter((s) => s.pir === 1).length;
  const safeCount = samples.filter((s) => s.level === 'safe').length;
  $('repAlarms').textContent = dangerCount;
  $('repPirs').textContent = pirDetections;
  $('repMutes').textContent = totalMutes;
  $('repChirps').textContent = totalChirps;
  $('repSafeRate').textContent = samples.length ? Math.round((safeCount / samples.length) * 100) + '%' : '0%';
  $('reportTimeBadge').textContent = `Phạm vi: ${samples.length} mẫu`;
}

function updateTable() {
  const rows = samples.slice(-20).reverse();
  if (!rows.length) {
    $('tableBody').innerHTML = '<tr><td colspan="8" class="empty">Chưa có bản ghi cảm biến hợp lệ trên ThingSpeak.</td></tr>';
    return;
  }

  $('tableBody').innerHTML = rows.map((s) => {
    const pirTag = s.pir === 1
      ? '<span class="tag pir-yes">1 · Chuyển động</span>'
      : s.pir === 0
      ? '<span class="tag pir-no">0 · Yên tĩnh</span>'
      : '<span class="empty">--</span>';

    const distStr = s.distance !== null
      ? `${s.distance.toFixed(2)} cm`
      : s.outOfRange
      ? '<span class="empty">Ngoài tầm (-1)</span>'
      : '<span class="empty">--</span>';

    const ledTag = s.hwLed === 1
      ? '<span class="tag led-on">1 · BẬT</span>'
      : s.hwLed === 0
      ? '<span class="tag led-off">0 · TẮT</span>'
      : '<span class="empty">--</span>';

    const buzTag = s.hwBuzzer === 1
      ? '<span class="tag buzzer-on">1 · ĐANG KÊU</span>'
      : s.hwBuzzer === 0
      ? '<span class="tag buzzer-off">0 · TẮT</span>'
      : '<span class="empty">--</span>';

    const cmdText = `Đèn: ${s.cmdLed !== null ? s.cmdLed : '-'} / Còi: ${s.cmdBuzzer !== null ? s.cmdBuzzer : '-'}`;

    return `
      <tr>
        <td>#${s.entryId}</td>
        <td>${s.timeFull}</td>
        <td>${pirTag}</td>
        <td>${distStr}</td>
        <td>${ledTag}</td>
        <td>${buzTag}</td>
        <td><small>${cmdText}</small></td>
        <td><span class="tag ${s.level}">${LEVEL_TEXT[s.level]}</span></td>
      </tr>`;
  }).join('');
}

function render() {
  updateStats();
  updateCharts();
  updateTable();
}

// --- ĐỌC DỮ LIỆU TRỰC TIẾP TỪ THINGSPEAK ---
async function loadFromThingSpeak(silent = false) {
  if (fetching) return;
  const { channelId, readKey } = THINGSPEAK_CONFIG;
  const results = $('resultLimit').value || '60';

  fetching = true;
  const params = new URLSearchParams({ results });
  if (readKey) params.append('api_key', readKey);

  try {
    const res = await fetch(`${TS_API}/channels/${encodeURIComponent(channelId)}/feeds.json?${params}`, {
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rawFeeds = data.feeds || [];

    if (rawFeeds.length) {
      latestRawEntry = rawFeeds[rawFeeds.length - 1];
      latestRemoteCmd = { field5: null, field6: null };
      for (let i = rawFeeds.length - 1; i >= 0; i--) {
        if (latestRemoteCmd.field5 === null && rawFeeds[i].field5 !== null && rawFeeds[i].field5 !== '') {
          latestRemoteCmd.field5 = parseBinaryField(rawFeeds[i].field5);
        }
        if (latestRemoteCmd.field6 === null && rawFeeds[i].field6 !== null && rawFeeds[i].field6 !== '') {
          latestRemoteCmd.field6 = parseBinaryField(rawFeeds[i].field6);
        }
      }
      $('latestEntry').textContent = `#${latestRawEntry.entry_id}`;
    } else {
      $('latestEntry').textContent = 'Trống';
    }

    const prevLastId = samples.length ? samples[samples.length - 1].entryId : null;
    samples = rawFeeds.map(parseSensorFeed).filter(Boolean);
    const newLastId = samples.length ? samples[samples.length - 1].entryId : null;

    syncAutoState();
    render();

    const nowStr = new Date().toLocaleTimeString('vi-VN');
    $('lastUpdated').textContent = nowStr;
    setCloudBadge('Đang đồng bộ', 'on');
    setTopStatus(syncing ? `ThingSpeak Live (#${latestRawEntry ? latestRawEntry.entry_id : '--'})` : 'Tạm dừng', syncing ? '' : 'paused');

    if (!silent || (newLastId && newLastId !== prevLastId)) {
      const last = samples[samples.length - 1];
      if (last) {
        const dStr = last.distance !== null ? `${last.distance}cm` : 'Ngoài tầm(-1)';
        cloudLog(`Đồng bộ #${last.entryId}: PIR=${last.pir}, HC-SR04=${dStr}, Đèn=${last.hwLed}, Còi=${last.hwBuzzer}.`, 'ok');
      } else {
        cloudLog(`Đã kết nối kênh #${channelId} (${rawFeeds.length} feeds).`, 'info');
      }
    }
  } catch (err) {
    setCloudBadge('Lỗi đọc', 'err');
    setTopStatus('Lỗi ThingSpeak', 'err');
    cloudLog('Không đọc được từ ThingSpeak: ' + err.message, 'error');
  } finally {
    fetching = false;
  }
}

// --- GỬI LỆNH ĐIỀU KHIỂN LÊN THINGSPEAK (FIELD5 / FIELD6) ---
function updateQueueStatusUI() {
  const qEl = $('commandQueueStatus');
  const wEl = $('writeStatus');
  if (!pendingCommand) {
    if (writing) {
      wEl.textContent = 'Đang gửi...';
    } else if (Date.now() - lastWriteAt < THINGSPEAK_COOLDOWN_MS && lastWriteAt > 0) {
      const left = Math.ceil((THINGSPEAK_COOLDOWN_MS - (Date.now() - lastWriteAt)) / 1000);
      wEl.textContent = `Cooldown (${left}s)`;
    } else {
      wEl.textContent = 'Sẵn sàng';
    }
    qEl.textContent = 'Sẵn sàng gửi lệnh điều khiển tới ThingSpeak (field5 / field6).';
    return;
  }

  const left = Math.max(0, Math.ceil((lastWriteAt + THINGSPEAK_COOLDOWN_MS - Date.now()) / 1000));
  const cmdDesc = Object.entries(pendingCommand.fields)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  wEl.textContent = `Chờ gửi (${left}s)`;
  qEl.textContent = `⏳ Chờ cooldown 15s ThingSpeak (${left}s) để gửi lệnh: ${cmdDesc}`;
}

function enqueueThingSpeakCommand(fields, reason) {
  pendingCommand = {
    fields: { ...(pendingCommand ? pendingCommand.fields : {}), ...fields },
    reason,
  };
  processCommandQueue();
}

async function processCommandQueue() {
  clearTimeout(queueTimer);
  clearInterval(queueCountdownTimer);

  if (!pendingCommand || writing) {
    updateQueueStatusUI();
    return;
  }

  const { writeKey } = THINGSPEAK_CONFIG;

  const elapsed = Date.now() - lastWriteAt;
  if (lastWriteAt > 0 && elapsed < THINGSPEAK_COOLDOWN_MS) {
    const waitMs = THINGSPEAK_COOLDOWN_MS - elapsed;
    updateQueueStatusUI();
    queueCountdownTimer = setInterval(updateQueueStatusUI, 500);
    queueTimer = setTimeout(processCommandQueue, waitMs + 50);
    return;
  }

  const cmd = pendingCommand;
  pendingCommand = null;
  writing = true;
  updateQueueStatusUI();

  const body = new URLSearchParams({ api_key: writeKey });
  Object.entries(cmd.fields).forEach(([k, v]) => {
    if (v !== null && v !== undefined) body.append(k, String(v));
  });

  try {
    const res = await fetch(`${TS_API}/update`, { method: 'POST', body });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const entryId = (await res.text()).trim();
    if (!entryId || entryId === '0') {
      // ThingSpeak từ chối do chưa đủ 15s (có thể ESP32 vừa ghi trước đó) -> tự động xếp hàng gửi lại
      lastWriteAt = Date.now();
      pendingCommand = {
        fields: { ...cmd.fields, ...(pendingCommand ? pendingCommand.fields : {}) },
        reason: cmd.reason,
      };
      cloudLog(`ThingSpeak đang trong chu kỳ nghỉ 15s, tự động gửi lại lệnh (${cmd.reason}) sau 15s.`, 'warn');
    } else {
      lastWriteAt = Date.now();
      const sentDesc = Object.entries(cmd.fields).map(([k, v]) => `${k}=${v}`).join(', ');
      cloudLog(`Đã gửi lệnh #${entryId} (${sentDesc}) – ${cmd.reason}`, 'ok');
    }
  } catch (err) {
    cloudLog('Lỗi gửi lệnh ThingSpeak: ' + err.message, 'error');
  } finally {
    writing = false;
    if (pendingCommand) {
      queueCountdownTimer = setInterval(updateQueueStatusUI, 500);
      queueTimer = setTimeout(processCommandQueue, THINGSPEAK_COOLDOWN_MS);
    } else {
      queueCountdownTimer = setInterval(() => {
        updateQueueStatusUI();
        if (Date.now() - lastWriteAt >= THINGSPEAK_COOLDOWN_MS) {
          clearInterval(queueCountdownTimer);
          updateQueueStatusUI();
        }
      }, 1000);
    }
    updateQueueStatusUI();
  }
}

// --- ĐIỀU KHIỂN SMARTKEY & SỰ KIỆN ---
function stopChirp(sendOffToCloud = true) {
  clearTimeout(chirpTimer);
  clearInterval(chirpTickTimer);
  chirpTimer = null;
  chirpTickTimer = null;
  stopWebSound();

  if (controlMode === 'CHIRP') {
    controlMode = 'AUTO';
    if (sendOffToCloud) {
      enqueueThingSpeakCommand({ field6: 0 }, 'Kết thúc kêu tìm xe, trả còi về AUTO');
    }
    render();
  }
}

$('btnSmartHorn').addEventListener('click', () => {
  const alarming = isCurrentlyAlarming();

  if (controlMode === 'CHIRP') {
    stopChirp(true);
    cloudLog('Đã dừng kêu còi tìm xe và quay về AUTO.', 'info');
    return;
  }

  if (controlMode === 'MUTED') {
    controlMode = 'AUTO';
    enqueueThingSpeakCommand({ field6: alarming ? 1 : 0 }, 'Người dùng bấm bật lại còi / về AUTO');
    cloudLog('Đã quay về chế độ AUTO.', 'ok');
    render();
    return;
  }

  if (alarming) {
    // Đang có báo động / còi kêu -> Tắt còi tạm thời
    controlMode = 'MUTED';
    totalMutes++;
    stopWebSound();
    enqueueThingSpeakCommand({ field6: 0 }, 'Tắt còi tạm thời (Mute)');
    cloudLog('Đã TẮT CÒI TẠM THỜI (Mute).', 'warn');
    render();
  } else {
    // Còi đang không kêu -> Cho kêu 2 - 3 giây (tìm xe) rồi tự tắt
    const durationMs = Number($('chirpDuration').value) || 2500;
    controlMode = 'CHIRP';
    totalChirps++;
    chirpEndAt = Date.now() + durationMs;

    startChirpSound(durationMs);
    enqueueThingSpeakCommand({ field6: 1 }, `Kêu còi tìm xe ${(durationMs / 1000).toFixed(1)}s`);
    cloudLog(`Kích hoạt còi tìm xe ${(durationMs / 1000).toFixed(1)} giây (field6=1).`, 'ok');

    clearTimeout(chirpTimer);
    clearInterval(chirpTickTimer);
    chirpTickTimer = setInterval(render, 200);
    chirpTimer = setTimeout(() => {
      stopChirp(true);
      cloudLog('Còi tìm xe đã tự động ngắt, trở về AUTO.', 'info');
    }, durationMs);

    render();
  }
});

$('btnBackAuto').addEventListener('click', () => {
  if (controlMode === 'CHIRP') stopChirp(false);
  controlMode = 'AUTO';
  manualLedMode = null;
  updateLedToggleBtn();
  enqueueThingSpeakCommand({ field5: 0, field6: 0 }, 'Khôi phục chế độ AUTO');
  cloudLog('Đã đưa toàn bộ điều khiển về mặc định AUTO.', 'info');
  render();
});

function updateLedToggleBtn() {
  const btn = $('btnLedToggle');
  if (manualLedMode === null) {
    btn.className = 'btn-toggle';
    btn.textContent = '💡 Lệnh đèn (field5): AUTO';
  } else if (manualLedMode === 1) {
    btn.className = 'btn-toggle active';
    btn.textContent = '💡 Lệnh đèn (field5): BẬT (1)';
  } else {
    btn.className = 'btn-toggle off';
    btn.textContent = '💡 Lệnh đèn (field5): TẮT (0)';
  }
}

$('btnLedToggle').addEventListener('click', () => {
  if (manualLedMode === null) manualLedMode = 1;
  else if (manualLedMode === 1) manualLedMode = 0;
  else manualLedMode = null;

  updateLedToggleBtn();
  const val = manualLedMode === null ? 0 : manualLedMode;
  const label = manualLedMode === null ? 'AUTO (0)' : manualLedMode === 1 ? 'BẬT (1)' : 'TẮT (0)';
  enqueueThingSpeakCommand({ field5: val }, `Lệnh đèn: ${label}`);
  render();
});

$('btnWebSound').addEventListener('click', () => {
  webSoundEnabled = !webSoundEnabled;
  const btn = $('btnWebSound');
  btn.className = 'btn-toggle ' + (webSoundEnabled ? 'active' : 'off');
  btn.textContent = webSoundEnabled ? '🔊 Âm thanh web: BẬT' : '🔇 Âm thanh web: TẮT';
  if (!webSoundEnabled) stopWebSound();
});

// --- ĐIỀU KHIỂN ĐỒNG BỘ & CẤU HÌNH ---
function startPolling() {
  clearInterval(pollTimer);
  const ms = Number($('pollInterval').value) || 5000;
  pollTimer = setInterval(() => loadFromThingSpeak(true), ms);
}

function setSyncing(on) {
  syncing = on;
  $('btnToggle').textContent = on ? '⏸ Tạm dừng đồng bộ' : '▶ Tiếp tục đồng bộ';
  setTopStatus(on ? 'Đang đồng bộ ThingSpeak' : 'Tạm dừng', on ? '' : 'paused');
  if (on) {
    loadFromThingSpeak(true);
    startPolling();
  } else {
    clearInterval(pollTimer);
  }
}

$('btnToggle').addEventListener('click', () => setSyncing(!syncing));
$('btnRefresh').addEventListener('click', () => loadFromThingSpeak(false));

$('pollInterval').addEventListener('change', () => {
  saveConfig();
  if (syncing) startPolling();
});

$('resultLimit').addEventListener('change', () => {
  saveConfig();
  loadFromThingSpeak(false);
});

$('threshold').addEventListener('change', () => {
  saveConfig();
  recomputeLevels();
  syncAutoState();
  render();
});

$('chirpDuration').addEventListener('change', () => {
  saveConfig();
  render();
});

$('btnExport').addEventListener('click', () => {
  if (!samples.length) {
    cloudLog('Chưa có dữ liệu từ ThingSpeak để xuất CSV.', 'warn');
    return;
  }
  const header = 'STT,Entry ID,Thời gian,PIR (field1),Khoảng cách HC-SR04 (field2 cm),Đèn (field3),Còi (field4),Lệnh đèn (field5),Lệnh còi (field6),Mức cảnh báo\n';
  const rows = samples.map((s, i) => {
    const pir = s.pir !== null ? s.pir : '';
    const dist = s.distance !== null ? s.distance : (s.outOfRange ? -1 : '');
    const led = s.hwLed !== null ? s.hwLed : '';
    const buz = s.hwBuzzer !== null ? s.hwBuzzer : '';
    const cLed = s.cmdLed !== null ? s.cmdLed : '';
    const cBuz = s.cmdBuzzer !== null ? s.cmdBuzzer : '';
    return `${i + 1},${s.entryId},"${s.timeFull}",${pir},${dist},${led},${buz},${cLed},${cBuz},${LEVEL_TEXT[s.level]}`;
  }).join('\n');

  const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `thingspeak_${THINGSPEAK_CONFIG.channelId}_2_cam_bien.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  cloudLog(`Đã xuất ${samples.length} bản ghi 2 cảm biến ra file CSV.`, 'ok');
});

// --- KHỞI ĐỘNG HỆ THỐNG ---
loadConfig();
updateLedToggleBtn();
updateQueueStatusUI();
loadFromThingSpeak(false);
startPolling();
