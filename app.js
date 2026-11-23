// --- HỆ THỐNG GIÁM SÁT IoT 2 CẢM BIẾN (HC-SR04 & PIR) ---
const MIN_CM = 2;
const MAX_CM = 400;
const MAX_POINTS = 30;

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
  chirp: '#0284c7'
};

const LEVEL_TEXT = { safe: 'An toàn', warn: 'Chú ý', danger: 'Nguy hiểm' };

// Trạng thái hệ thống
let samples = [];
let running = true;
let timer = null;
let position = 120;
const startTime = Date.now();

// Trạng thái cảm biến
let hcsr04Enabled = true;
let pirEnabled = true;
let manualPirTrigger = false;

// Trạng thái còi & cơ cấu chấp hành
// buzzerMode: 'OFF' | 'ALARM' | 'MUTED' | 'CHIRP'
let buzzerMode = 'OFF';
let isMuted = false;
let chirpTimer = null;
let ledMode = 'OFF'; // 'OFF' | 'RED' | 'YELLOW' | 'BLUE' | 'GREEN'

// Bộ đếm thống kê báo cáo
let totalAlarms = 0;
let totalPirDetections = 0;
let totalMutes = 0;
let totalChirps = 0;

const $ = (id) => document.getElementById(id);
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// Mô phỏng đọc cảm biến siêu âm HC-SR04
function simulateDistance() {
  if (!hcsr04Enabled) return null;
  const scenario = $('scenario').value;

  if (scenario === 'random') {
    if (Math.random() < 0.08) position = MIN_CM + Math.random() * 250;
    else position += (Math.random() - 0.5) * 30;
  } else if (scenario === 'approach') {
    position -= 6 + Math.random() * 6;
    if (position < 4) position = 200 + Math.random() * 80;
  } else if (scenario === 'intruder') {
    position = 5 + Math.random() * 8; // Đột nhập rất gần
  } else {
    // stable
    position = 60;
  }

  position = clamp(position, MIN_CM, MAX_CM);
  const noise = (Math.random() - 0.5) * 2;
  return Math.round(clamp(position + noise, MIN_CM, MAX_CM) * 10) / 10;
}

// Mô phỏng đọc cảm biến hồng ngoại PIR
function simulatePIR(distance) {
  if (!pirEnabled) return null;

  if (manualPirTrigger) {
    manualPirTrigger = false;
    return 1;
  }

  const scenario = $('scenario').value;
  if (scenario === 'intruder') return 1;
  if (scenario === 'approach') {
    // Vật đến gần càng dễ phát hiện chuyển động
    const prob = distance !== null && distance < 60 ? 0.85 : 0.6;
    return Math.random() < prob ? 1 : 0;
  }
  if (scenario === 'random') {
    return Math.random() < 0.28 ? 1 : 0;
  }
  // stable
  return Math.random() < 0.04 ? 1 : 0;
}

// Xác định mức độ cảnh báo kết hợp 2 cảm biến
function evaluateLevel(distance, pir) {
  const threshold = Number($('threshold').value) || 15;

  // Nếu cả hai cảm biến đều tắt
  if (distance === null && pir === null) return 'safe';

  // Điều kiện nguy hiểm (Alarm):
  // 1. Khoảng cách < ngưỡng
  // 2. Hoặc PIR phát hiện chuyển động khi khoảng cách ở vùng gần (< ngưỡng * 2.5)
  // 3. Hoặc chỉ bật PIR mà có chuyển động
  if (distance !== null && distance < threshold) return 'danger';
  if (pir === 1 && distance !== null && distance < threshold * 2.5) return 'danger';
  if (pir === 1 && distance === null) return 'danger';

  // Điều kiện chú ý:
  if (pir === 1) return 'warn';
  if (distance !== null && distance < threshold * 3) return 'warn';

  return 'safe';
}

// Cập nhật trạng thái Còi & Đèn dựa trên mức cảnh báo
function updateActuators(level) {
  // Nếu đang trong chế độ Bíp ngắn tìm xe (Chirp) do người dùng chủ động bấm
  if (buzzerMode === 'CHIRP') {
    ledMode = 'BLUE';
    return;
  }

  if (level === 'danger') {
    if (isMuted) {
      buzzerMode = 'MUTED';
      ledMode = 'YELLOW';
    } else {
      buzzerMode = 'ALARM';
      ledMode = 'RED';
    }
  } else {
    // Khi thoát khỏi vùng nguy hiểm, tự động giải phóng cờ Mute cho lần báo động sau
    if (isMuted) isMuted = false;
    buzzerMode = 'OFF';
    ledMode = level === 'warn' ? 'YELLOW' : 'GREEN';
  }
}

// --- KHỞI TẠO BIỂU ĐỒ (CHART.JS) ---
// 1. Biểu đồ đường kép (Dual-Axis Line Chart): Trục trái khoảng cách (cm), trục phải PIR (0/1)
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
        label: 'Cảm biến PIR (0: Yên, 1: Chuyển động)',
        data: [],
        borderColor: COLORS.pir,
        backgroundColor: 'rgba(139, 92, 246, 0.18)',
        stepped: true,
        pointRadius: 2,
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
        title: { display: true, text: 'Khoảng cách (cm)' },
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

// 2. Biểu đồ cột: Phân bố khoảng cách HC-SR04 & Lượt chuyển động PIR
const barChart = new Chart($('barChart'), {
  type: 'bar',
  data: {
    labels: [...BUCKETS.map((b) => b.label + ' cm'), 'PIR Chuyển động'],
    datasets: [
      {
        label: 'Số mẫu ghi nhận',
        data: [0, 0, 0, 0, 0, 0],
        backgroundColor: [
          COLORS.danger,
          COLORS.warn,
          COLORS.line,
          COLORS.line,
          COLORS.safe,
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

// 3. Biểu đồ tròn: Tỉ lệ trạng thái hệ thống
const pieChart = new Chart($('pieChart'), {
  type: 'doughnut',
  data: {
    labels: ['An toàn', 'Chú ý', 'Báo động (Nguy hiểm)', 'Tắt còi tạm thời (Muted)'],
    datasets: [
      {
        data: [0, 0, 0, 0],
        backgroundColor: [COLORS.safe, COLORS.warn, COLORS.danger, COLORS.mute],
      },
    ],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom' },
    },
  },
});

function updateCharts() {
  const recent = samples.slice(-MAX_POINTS);
  const threshold = Number($('threshold').value) || 15;

  lineChart.data.labels = recent.map((s) => s.time);
  lineChart.data.datasets[0].data = recent.map((s) => s.distance);
  lineChart.data.datasets[1].data = recent.map(() => threshold);
  lineChart.data.datasets[2].data = recent.map((s) => (s.pir !== null ? s.pir : null));
  lineChart.update();

  // Dữ liệu cột
  const validDistances = samples.filter((s) => s.distance !== null);
  const bucketCounts = BUCKETS.map(
    (b) => validDistances.filter((s) => s.distance >= b.from && s.distance < b.to).length
  );
  const pirCount = samples.filter((s) => s.pir === 1).length;
  barChart.data.datasets[0].data = [...bucketCounts, pirCount];
  barChart.update();

  // Dữ liệu tròn (4 trạng thái)
  const safeCount = samples.filter((s) => s.level === 'safe').length;
  const warnCount = samples.filter((s) => s.level === 'warn').length;
  const dangerActive = samples.filter((s) => s.level === 'danger' && s.buzzerState === 'ALARM').length;
  const dangerMuted = samples.filter((s) => s.buzzerState === 'MUTED').length;
  pieChart.data.datasets[0].data = [safeCount, warnCount, dangerActive, dangerMuted];
  pieChart.update();
}

function updateStats(last) {
  // 1. Thẻ khoảng cách HC-SR04
  if (last && last.distance !== null) {
    $('current').textContent = last.distance.toFixed(1) + ' cm';
    $('levelText').textContent = LEVEL_TEXT[last.level];
    $('currentCard').className = 'card stat main ' + last.level;
  } else {
    $('current').textContent = hcsr04Enabled ? '--' : 'ĐÃ TẮT';
    $('levelText').textContent = hcsr04Enabled ? '--' : 'Cảm biến nghỉ';
    $('currentCard').className = 'card stat main';
  }

  // 2. Thẻ cảm biến chuyển động PIR
  if (last && last.pir !== null) {
    if (last.pir === 1) {
      $('pirStatus').textContent = 'CHUYỂN ĐỘNG!';
      $('pirDetail').textContent = 'Phát hiện mục tiêu';
      $('pirCard').className = 'card stat pir-active';
    } else {
      $('pirStatus').textContent = 'Yên tĩnh';
      $('pirDetail').textContent = 'Không có chuyển động';
      $('pirCard').className = 'card stat';
    }
  } else {
    $('pirStatus').textContent = pirEnabled ? '--' : 'ĐÃ TẮT';
    $('pirDetail').textContent = pirEnabled ? '--' : 'Cảm biến nghỉ';
    $('pirCard').className = 'card stat';
  }

  // 3. Thẻ Còi báo (Buzzer) & Nút Còi thông minh thích ứng
  updateBuzzerUI();

  // 4. Thẻ Đèn LED
  const ledLight = $('ledLight');
  ledLight.className = 'led-light';
  if (ledMode === 'RED') {
    ledLight.classList.add('red');
    $('ledStatus').textContent = 'ĐỎ (BÁO ĐỘNG)';
    $('ledHint').textContent = 'Cảnh báo nguy hiểm';
  } else if (ledMode === 'YELLOW') {
    ledLight.classList.add('yellow');
    $('ledStatus').textContent = 'VÀNG (CHÚ Ý)';
    $('ledHint').textContent = isMuted ? 'Đã tắt còi - báo động im lặng' : 'Có mục tiêu lại gần';
  } else if (ledMode === 'BLUE') {
    ledLight.classList.add('blue');
    $('ledStatus').textContent = 'XANH LAM (TÌM XE)';
    $('ledHint').textContent = 'Đang bíp định vị 1.5s';
  } else if (ledMode === 'GREEN') {
    ledLight.classList.add('green');
    $('ledStatus').textContent = 'XANH (AN TOÀN)';
    $('ledHint').textContent = 'Hệ thống hoạt động tốt';
  } else {
    $('ledStatus').textContent = 'TẮT';
    $('ledHint').textContent = 'Bình thường';
  }

  // 5. Thống kê khoảng cách Min / Max / Avg
  const validDistances = samples.filter((s) => s.distance !== null).map((s) => s.distance);
  if (validDistances.length) {
    const sum = validDistances.reduce((a, b) => a + b, 0);
    const minVal = Math.min(...validDistances).toFixed(1);
    const maxVal = Math.max(...validDistances).toFixed(1);
    $('avg').textContent = (sum / validDistances.length).toFixed(1) + ' cm';
    $('minMaxHint').textContent = `Min: ${minVal} · Max: ${maxVal}`;
  } else {
    $('avg').textContent = '--';
    $('minMaxHint').textContent = 'Min: -- · Max: --';
  }

  // 6. Tổng số mẫu & Cảm biến bật
  $('count').textContent = samples.length;
  const activeCount = (hcsr04Enabled ? 1 : 0) + (pirEnabled ? 1 : 0);
  $('activeSensors').textContent = `${activeCount}/2 cảm biến bật`;

  // 7. Báo cáo thống kê hoạt động
  updateReportSection();
}

// Cập nhật giao diện nút bấm còi thông minh thích ứng theo ngữ cảnh
function updateBuzzerUI() {
  const btn = $('btnSmartHorn');
  const icon = $('hornIcon');
  const text = $('hornText');
  const desc = $('hornDesc');
  const buzzerVal = $('buzzer');
  const buzzerHint = $('buzzerHint');
  const buzzerCard = $('buzzerCard');

  buzzerCard.className = 'card stat';

  if (buzzerMode === 'ALARM') {
    buzzerVal.textContent = 'HÚ BÁO ĐỘNG';
    buzzerHint.textContent = 'Phát hiện nguy hiểm!';
    buzzerCard.className = 'card stat buzzer-alarm';

    btn.className = 'btn btn-horn alarm';
    icon.textContent = '🔕';
    text.textContent = 'Tắt còi tạm thời (Mute)';
    desc.textContent = 'Đang có báo động! Bấm ngay để ngắt tiếng còi, giữ yên tĩnh.';
  } else if (buzzerMode === 'MUTED') {
    buzzerVal.textContent = 'TẮT TẠM THỜI';
    buzzerHint.textContent = 'Đã tắt còi thủ công';
    buzzerCard.className = 'card stat buzzer-muted';

    btn.className = 'btn btn-horn muted';
    icon.textContent = '🔔';
    text.textContent = 'Bật lại còi báo động';
    desc.textContent = 'Còi đang bị tắt tạm thời. Bấm nút này để kích hoạt lại còi báo động.';
  } else if (buzzerMode === 'CHIRP') {
    buzzerVal.textContent = 'BÍP TÌM XE';
    buzzerHint.textContent = 'Đang phát bíp ngắn 1.5s';
    buzzerCard.className = 'card stat buzzer-chirp';

    btn.className = 'btn btn-horn chirp';
    icon.textContent = '📢';
    text.textContent = 'Đang kêu tìm xe...';
    desc.textContent = 'Còi đang phát tín hiệu định vị ngắn, sẽ tự động ngắt sau giây lát.';
  } else {
    buzzerVal.textContent = 'TẮT';
    buzzerHint.textContent = 'Trạng thái an toàn';

    btn.className = 'btn btn-horn chirp';
    icon.textContent = '📢';
    text.textContent = 'Thử còi / Tìm xe (Bíp ngắn)';
    desc.textContent = 'Hệ thống an toàn. Bấm để thử còi bíp ngắn 1.5s giống remote tìm xe ô tô.';
  }
}

// Cập nhật Báo cáo Thống kê
function updateReportSection() {
  $('repAlarms').textContent = totalAlarms;
  $('repPirs').textContent = totalPirDetections;
  $('repMutes').textContent = totalMutes;
  $('repChirps').textContent = totalChirps;

  if (samples.length > 0) {
    const safeCount = samples.filter((s) => s.level === 'safe').length;
    const safeRate = Math.round((safeCount / samples.length) * 100);
    $('repSafeRate').textContent = safeRate + '%';
  } else {
    $('repSafeRate').textContent = '100%';
  }

  // Thời gian chạy
  const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
  const mins = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
  const secs = String(elapsedSec % 60).padStart(2, '0');
  $('reportTimeBadge').textContent = `Thời gian chạy: ${mins}:${secs}`;
}

// Cập nhật bảng 10 mẫu gần nhất
function updateTable() {
  const rows = samples.slice(-10).reverse();
  $('tableBody').innerHTML = rows
    .map((s, i) => {
      const distStr = s.distance !== null ? s.distance.toFixed(1) : '<span class="empty">TẮT</span>';
      const pirTag = s.pir === 1
        ? '<span class="tag pir-yes">Có chuyển động</span>'
        : s.pir === 0
        ? '<span class="tag pir-no">Yên tĩnh</span>'
        : '<span class="empty">TẮT</span>';

      let buzzerTag = '<span class="tag buzzer-off">TẮT</span>';
      if (s.buzzerState === 'ALARM') buzzerTag = '<span class="tag buzzer-on">HÚ CÒI</span>';
      else if (s.buzzerState === 'MUTED') buzzerTag = '<span class="tag buzzer-mute">TẮT TẠM THỜI</span>';
      else if (s.buzzerState === 'CHIRP') buzzerTag = '<span class="tag buzzer-chirp">BÍP TÌM XE</span>';

      const ledTag = s.ledState !== 'OFF'
        ? `<span class="tag led-on">${s.ledState}</span>`
        : '<span class="tag led-off">TẮT</span>';

      let note = 'Bình thường';
      if (s.buzzerState === 'ALARM') note = 'Cảnh báo nguy hiểm!';
      else if (s.buzzerState === 'MUTED') note = 'Đã ngắt còi bằng tay';
      else if (s.buzzerState === 'CHIRP') note = 'Bấm thử tìm xe';
      else if (s.level === 'warn') note = 'Chú ý cự ly/chuyển động';

      return `
        <tr>
          <td>${samples.length - i}</td>
          <td>${s.time}</td>
          <td>${distStr}</td>
          <td>${pirTag}</td>
          <td><span class="tag ${s.level}">${LEVEL_TEXT[s.level]}</span></td>
          <td>${buzzerTag}</td>
          <td>${ledTag}</td>
          <td><small>${note}</small></td>
        </tr>`;
    })
    .join('');
}

function render() {
  updateStats(samples[samples.length - 1]);
  updateCharts();
  updateTable();
}

function tick() {
  const dist = simulateDistance();
  const pir = simulatePIR(dist);
  const level = evaluateLevel(dist, pir);

  if (level === 'danger') totalAlarms++;
  if (pir === 1) totalPirDetections++;

  updateActuators(level);

  samples.push({
    time: new Date().toLocaleTimeString('vi-VN'),
    distance: dist,
    pir,
    level,
    buzzerState: buzzerMode,
    ledState: ledMode,
  });

  if (dist !== null) cloudWindow.push(dist);
  render();
}

function start() {
  clearInterval(timer);
  timer = setInterval(tick, Number($('interval').value));
}

function setRunning(on) {
  running = on;
  $('btnToggle').textContent = on ? '⏸ Tạm dừng' : '▶ Tiếp tục';
  $('statusText').textContent = on ? 'Đang chạy' : 'Tạm dừng';
  $('statusDot').className = 'dot' + (on ? '' : ' paused');
  if (on) start(); else clearInterval(timer);
}

// --- BẮT SỰ KIỆN ĐIỀU KHIỂN & BẬT TẮT BẰNG TAY ---
// 1. Tạm dừng / Tiếp tục
$('btnToggle').addEventListener('click', () => setRunning(!running));

// 2. Làm mới toàn bộ
$('btnReset').addEventListener('click', () => {
  samples = [];
  cloudWindow = [];
  position = 120;
  isMuted = false;
  buzzerMode = 'OFF';
  totalAlarms = 0;
  totalPirDetections = 0;
  totalMutes = 0;
  totalChirps = 0;
  if (chirpTimer) clearTimeout(chirpTimer);
  render();
});

// 3. Đổi chu kỳ đọc
$('interval').addEventListener('change', () => { if (running) start(); });

// 4. Đổi ngưỡng cảnh báo
$('threshold').addEventListener('change', () => {
  render();
});

// 5. Nút Còi thông minh (Bật/Tắt bằng tay kiểu tìm xe ô tô)
$('btnSmartHorn').addEventListener('click', () => {
  if (buzzerMode === 'ALARM') {
    // Đang có báo động -> Bấm để Tắt còi tạm thời (Mute)
    isMuted = true;
    buzzerMode = 'MUTED';
    totalMutes++;
    cloudLog('Người dùng bấm TẮT CÒI TẠM THỜI khi đang có báo động.', 'warn');
  } else if (buzzerMode === 'MUTED') {
    // Đang bị tắt tạm thời -> Bấm để Bật lại còi báo động
    isMuted = false;
    buzzerMode = 'ALARM';
    cloudLog('Người dùng BẬT LẠI còi báo động.', 'ok');
  } else {
    // Đang bình thường -> Bấm để Bíp ngắn tìm xe ô tô (Chirp)
    totalChirps++;
    buzzerMode = 'CHIRP';
    ledMode = 'BLUE';
    cloudLog('Người dùng bấm THỬ CÒI / TÌM XE: Bíp ngắn 1,5 giây.', 'ok');

    if (chirpTimer) clearTimeout(chirpTimer);
    chirpTimer = setTimeout(() => {
      if (buzzerMode === 'CHIRP') {
        const last = samples[samples.length - 1];
        const curLevel = last ? last.level : 'safe';
        updateActuators(curLevel);
        render();
        cloudLog('Còi tìm xe đã tự động ngắt.', 'info');
      }
    }, 1500);
  }
  render();
});

// 6. Bật / Tắt cảm biến HC-SR04 bằng tay
$('toggleHcsr04').addEventListener('click', () => {
  hcsr04Enabled = !hcsr04Enabled;
  const btn = $('toggleHcsr04');
  btn.className = 'btn-toggle ' + (hcsr04Enabled ? 'active' : 'off');
  btn.textContent = hcsr04Enabled ? '📡 HC-SR04: BẬT' : '📡 HC-SR04: TẮT';
  cloudLog(`Đã ${hcsr04Enabled ? 'BẬT' : 'TẮT'} cảm biến khoảng cách HC-SR04.`, 'info');
  render();
});

// 7. Bật / Tắt cảm biến PIR bằng tay
$('togglePir').addEventListener('click', () => {
  pirEnabled = !pirEnabled;
  const btn = $('togglePir');
  btn.className = 'btn-toggle ' + (pirEnabled ? 'active' : 'off');
  btn.textContent = pirEnabled ? '👁 PIR: BẬT' : '👁 PIR: TẮT';
  cloudLog(`Đã ${pirEnabled ? 'BẬT' : 'TẮT'} cảm biến chuyển động PIR.`, 'info');
  render();
});

// 8. Nút kích hoạt PIR tức thì
$('btnTriggerPir').addEventListener('click', () => {
  if (!pirEnabled) {
    cloudLog('Cần bật cảm biến PIR trước khi kích hoạt.', 'warn');
    return;
  }
  manualPirTrigger = true;
  cloudLog('Kích hoạt chuyển động PIR tức thì!', 'ok');
  tick();
});

// 9. Xuất báo cáo CSV đầy đủ 2 cảm biến & còi
$('btnExport').addEventListener('click', () => {
  const header = 'STT,Thời gian,Khoảng cách HC-SR04 (cm),Cảm biến PIR (0/1),Mức cảnh báo,Trạng thái Còi,Đèn LED\n';
  const rows = samples.map((s, i) => {
    const dist = s.distance !== null ? s.distance : 'TAT';
    const pir = s.pir !== null ? s.pir : 'TAT';
    return `${i + 1},${s.time},${dist},${pir},${LEVEL_TEXT[s.level]},${s.buzzerState},${s.ledState}`;
  }).join('\n');

  const csv = header + rows;
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'bao_cao_iot_2_cam_bien.csv';
  a.click();
  URL.revokeObjectURL(a.href);
  cloudLog('Đã xuất báo cáo CSV dữ liệu 2 cảm biến.', 'ok');
});

// --- CLOUD THINGSPEAK INTEGRATION ---
const TS_API = 'https://api.thingspeak.com';
const LEVEL_CODE = { safe: 0, warn: 1, danger: 2 };
const CODE_LEVEL = ['safe', 'warn', 'danger'];
const BUZZER_CODE = { OFF: 0, ALARM: 1, MUTED: 2, CHIRP: 3 };
const CODE_BUZZER = ['TẮT', 'HÚ BÁO ĐỘNG', 'TẮT TẠM THỜI', 'BÍP TÌM XE'];
const CLOUD_FIELDS = ['channelId', 'writeKey', 'readKey', 'uploadInterval'];

let cloudWindow = [];
let cloudOn = false;
let cloudTimer = null;
let countdownTimer = null;
let nextSendAt = 0;
let sentCount = 0;
let sending = false;

function storageGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch (e) {}
}

function loadCloudConfig() {
  CLOUD_FIELDS.forEach((id) => {
    const saved = storageGet('iot2sens_' + id) || storageGet('hcsr04_' + id);
    if (saved !== null) $(id).value = saved;
  });
}

function saveCloudConfig() {
  CLOUD_FIELDS.forEach((id) => storageSet('iot2sens_' + id, $(id).value.trim()));
}

function cloudLog(message, type = 'info') {
  const log = $('cloudLog');
  if (!log) return;
  const li = document.createElement('li');
  li.className = type;
  li.textContent = `[${new Date().toLocaleTimeString('vi-VN')}] ${message}`;
  log.prepend(li);
  while (log.children.length > 8) log.lastChild.remove();
}

function setBadge(text, cls) {
  $('cloudBadge').textContent = text;
  $('cloudBadge').className = 'badge ' + (cls || '');
}

// Đóng gói Payload 6 trường cho 2 cảm biến & cơ cấu chấp hành
function buildPayload() {
  const last = samples[samples.length - 1];
  if (!last) return null;
  const windowValues = cloudWindow.length ? cloudWindow : (last.distance !== null ? [last.distance] : [0]);
  const avg = windowValues.reduce((a, b) => a + b, 0) / windowValues.length;

  return {
    field1: last.distance !== null ? last.distance.toFixed(1) : '-1', // -1: Tắt cảm biến
    field2: LEVEL_CODE[last.level],
    field3: last.pir !== null ? last.pir : -1,
    field4: BUZZER_CODE[last.buzzerState] !== undefined ? BUZZER_CODE[last.buzzerState] : 0,
    field5: last.ledState !== 'OFF' ? 1 : 0,
    field6: avg.toFixed(1),
  };
}

async function sendToCloud() {
  if (sending) return;
  const payload = buildPayload();
  if (!payload) return;
  if (!running) {
    cloudLog('Mô phỏng đang tạm dừng, bỏ qua lần gửi này.', 'warn');
    return;
  }

  sending = true;
  const body = new URLSearchParams({ api_key: $('writeKey').value.trim() });
  Object.entries(payload).forEach(([k, v]) => body.append(k, v));

  try {
    const res = await fetch(TS_API + '/update', { method: 'POST', body });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const entryId = (await res.text()).trim();
    if (!entryId || entryId === '0') {
      throw new Error('ThingSpeak trả về 0 (gửi quá nhanh hoặc sai Write API Key)');
    }
    cloudWindow = [];
    sentCount++;
    $('sentCount').textContent = sentCount;
    $('lastSent').textContent = new Date().toLocaleTimeString('vi-VN');
    setBadge('Đang lưu', 'on');
    cloudLog(`Đã lưu entry #${entryId}: HC-SR04=${payload.field1}cm, PIR=${payload.field3}, Còi=${payload.field4}, TB=${payload.field6}cm.`, 'ok');
  } catch (err) {
    setBadge('Lỗi gửi', 'err');
    cloudLog('Không gửi được: ' + err.message, 'error');
  } finally {
    sending = false;
  }
}

function scheduleNext() {
  nextSendAt = Date.now() + Number($('uploadInterval').value) * 1000;
}

function updateCountdown() {
  if (!cloudOn) { $('nextSend').textContent = '--'; return; }
  const left = Math.max(0, Math.ceil((nextSendAt - Date.now()) / 1000));
  $('nextSend').textContent = left + ' giây';
}

function startCloud() {
  if (!$('channelId').value.trim() || !$('writeKey').value.trim()) {
    cloudLog('Cần nhập Channel ID và Write API Key trước khi bật lưu cloud.', 'error');
    return;
  }
  saveCloudConfig();
  cloudOn = true;
  cloudWindow = [];
  $('btnCloud').textContent = '■ Dừng lưu cloud';
  setBadge('Đang lưu', 'on');
  cloudLog(`Bật lưu cloud 2 cảm biến, gửi mỗi ${$('uploadInterval').value} giây.`);
  sendToCloud();
  scheduleNext();
  clearInterval(cloudTimer);
  cloudTimer = setInterval(() => {
    if (Date.now() >= nextSendAt) {
      scheduleNext();
      sendToCloud();
    }
  }, 500);
  clearInterval(countdownTimer);
  countdownTimer = setInterval(updateCountdown, 500);
  updateCountdown();
}

function stopCloud() {
  cloudOn = false;
  clearInterval(cloudTimer);
  clearInterval(countdownTimer);
  $('btnCloud').textContent = '☁ Bật lưu cloud';
  setBadge('Đã dừng');
  updateCountdown();
  cloudLog('Đã dừng lưu cloud.');
}

async function loadFromCloud() {
  const channelId = $('channelId').value.trim();
  if (!channelId) {
    cloudLog('Cần nhập Channel ID để tải dữ liệu.', 'error');
    return;
  }
  saveCloudConfig();
  const params = new URLSearchParams({ results: 20 });
  const readKey = $('readKey').value.trim();
  if (readKey) params.append('api_key', readKey);

  try {
    const res = await fetch(`${TS_API}/channels/${encodeURIComponent(channelId)}/feeds.json?${params}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const feeds = (data.feeds || []).slice().reverse();
    renderCloudTable(feeds);
    cloudLog(`Đã tải ${feeds.length} bản ghi từ kênh ${channelId}.`, 'ok');
  } catch (err) {
    cloudLog('Không tải được dữ liệu: ' + err.message + ' (kiểm tra Channel ID / Read API Key).', 'error');
  }
}

function renderCloudTable(feeds) {
  if (!feeds.length) {
    $('cloudBody').innerHTML = '<tr><td colspan="8" class="empty">Kênh chưa có dữ liệu.</td></tr>';
    return;
  }
  $('cloudBody').innerHTML = feeds.map((f) => {
    const level = CODE_LEVEL[Number(f.field2)];
    const tag = level ? `<span class="tag ${level}">${LEVEL_TEXT[level]}</span>` : '--';
    const num = (v) => (v === null || v === undefined || v === '' || v === '-1' ? '--' : Number(v).toFixed(1));
    const pirStr = f.field3 === '1' ? '<span class="tag pir-yes">Có CĐ</span>' : f.field3 === '0' ? '<span class="tag pir-no">Yên</span>' : '--';
    const buzzerCode = Number(f.field4);
    const buzzerStr = CODE_BUZZER[buzzerCode] || '--';
    const ledStr = f.field5 === '1' ? '<span class="tag led-on">BẬT</span>' : '<span class="tag led-off">TẮT</span>';

    return `
      <tr>
        <td>${f.entry_id}</td>
        <td>${new Date(f.created_at).toLocaleString('vi-VN')}</td>
        <td>${num(f.field1)}</td>
        <td>${tag}</td>
        <td>${pirStr}</td>
        <td>${buzzerStr}</td>
        <td>${ledStr}</td>
        <td>${num(f.field6)}</td>
      </tr>`;
  }).join('');
}

$('btnCloud').addEventListener('click', () => (cloudOn ? stopCloud() : startCloud()));
$('btnLoadCloud').addEventListener('click', loadFromCloud);
$('uploadInterval').addEventListener('change', () => {
  saveCloudConfig();
  if (cloudOn) { scheduleNext(); cloudLog(`Đổi chu kỳ gửi thành ${$('uploadInterval').value} giây.`); }
});

// --- KHỞI ĐỘNG HỆ THỐNG ---
loadCloudConfig();
tick();
start();
