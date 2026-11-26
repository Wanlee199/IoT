import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
  getDatabase,
  ref,
  set,
  remove,
  onValue,
  query,
  limitToLast
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-database.js';

const DIA_CHI_FIREBASE = 'https://iot-nhom-10-default-rtdb.asia-southeast1.firebasedatabase.app';

const CAC_KHOANG_CU_LY = [
  { nhan: '< 10', tu: 0, den: 10 },
  { nhan: '10–50', tu: 10, den: 50 },
  { nhan: '50–100', tu: 50, den: 100 },
  { nhan: '100–200', tu: 100, den: 200 },
  { nhan: '200–400', tu: 200, den: 401 },
];

const BANG_MAU = {
  safe: '#16a34a',
  warn: '#f59e0b',
  danger: '#dc2626',
  line: '#2563eb',
  pir: '#8b5cf6',
};

const NHAN_MUC_DO = {
  safe: 'An toàn',
  warn: 'Chú ý',
  danger: 'Nguy hiểm',
};

let danhSachBanGhi = [];
let duLieuHienTai = null;
let lenhDenHienTai = 0;
let lenhCoiHienTai = 0;
let nguongCanhBaoHienTai = 10;
let huyLangNgheLichSu = null;

const layPhanTu = (id) => document.getElementById(id);

function danhGiaMucCanhBao(khoangCach, pir) {
  const nguong = nguongCanhBaoHienTai;
  if (khoangCach === null && pir === null) return 'safe';
  if (khoangCach !== null && khoangCach < nguong) return 'danger';
  if (pir === 1 && khoangCach !== null && khoangCach < nguong * 2.5) return 'danger';
  if (pir === 1) return 'warn';
  if (khoangCach !== null && khoangCach < nguong * 3) return 'warn';
  return 'safe';
}

function ghiNhatKy(noiDung, loai = 'info') {
  const khungNhatKy = layPhanTu('nhatKyHeThong');
  if (!khungNhatKy) return;
  const dong = document.createElement('li');
  dong.className = loai;
  dong.textContent = `[${new Date().toLocaleTimeString('vi-VN')}] ${noiDung}`;
  khungNhatKy.prepend(dong);
  while (khungNhatKy.children.length > 8) {
    khungNhatKy.lastChild.remove();
  }
}

const bieuDoDuong = new Chart(layPhanTu('bieuDoDuong'), {
  type: 'line',
  data: {
    labels: [],
    datasets: [
      {
        label: 'Khoảng cách (cm)',
        data: [],
        borderColor: BANG_MAU.line,
        backgroundColor: 'rgba(37, 99, 235, 0.12)',
        fill: true,
        tension: 0.25,
        pointRadius: 3,
        yAxisID: 'y',
      },
      {
        label: 'Ngưỡng còi (cm)',
        data: [],
        borderColor: BANG_MAU.danger,
        borderDash: [6, 4],
        pointRadius: 0,
        fill: false,
        yAxisID: 'y',
      },
      {
        label: 'PIR (0 / 1)',
        data: [],
        borderColor: BANG_MAU.pir,
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
        title: { display: true, text: 'Cự ly (cm)' },
      },
      y1: {
        type: 'linear',
        position: 'right',
        min: 0,
        max: 1.25,
        grid: { drawOnChartArea: false },
        ticks: {
          stepSize: 1,
          callback: (giaTri) => (giaTri === 1 ? 'Có người' : giaTri === 0 ? 'Yên tĩnh' : ''),
        },
        title: { display: true, text: 'PIR' },
      },
    },
  },
});

const bieuDoCot = new Chart(layPhanTu('bieuDoCot'), {
  type: 'bar',
  data: {
    labels: [...CAC_KHOANG_CU_LY.map((k) => k.nhan), 'PIR'],
    datasets: [
      {
        label: 'Số bản ghi',
        data: [0, 0, 0, 0, 0, 0],
        backgroundColor: [
          BANG_MAU.danger,
          BANG_MAU.warn,
          BANG_MAU.line,
          BANG_MAU.line,
          BANG_MAU.safe,
          BANG_MAU.pir,
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

const bieuDoTron = new Chart(layPhanTu('bieuDoTron'), {
  type: 'doughnut',
  data: {
    labels: ['An toàn', 'Chú ý', 'Nguy hiểm'],
    datasets: [
      {
        data: [0, 0, 0],
        backgroundColor: [BANG_MAU.safe, BANG_MAU.warn, BANG_MAU.danger],
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

function capNhatBieuDo() {
  bieuDoDuong.data.labels = danhSachBanGhi.map((b) => b.thoiGianNgan);
  bieuDoDuong.data.datasets[0].data = danhSachBanGhi.map((b) => b.khoangCach);
  bieuDoDuong.data.datasets[1].data = danhSachBanGhi.map(() => nguongCanhBaoHienTai);
  bieuDoDuong.data.datasets[2].data = danhSachBanGhi.map((b) => b.pir);
  bieuDoDuong.update();

  const danhSachCuLyHopLe = danhSachBanGhi.filter((b) => b.khoangCach !== null);
  const soLuongTheoKhoang = CAC_KHOANG_CU_LY.map(
    (k) => danhSachCuLyHopLe.filter((b) => b.khoangCach >= k.tu && b.khoangCach < k.den).length
  );
  const soLanPir = danhSachBanGhi.filter((b) => b.pir === 1).length;
  bieuDoCot.data.datasets[0].data = [...soLuongTheoKhoang, soLanPir];
  bieuDoCot.update();

  const soAnToan = danhSachBanGhi.filter((b) => b.muc === 'safe').length;
  const soChuY = danhSachBanGhi.filter((b) => b.muc === 'warn').length;
  const soNguyHiem = danhSachBanGhi.filter((b) => b.muc === 'danger').length;
  bieuDoTron.data.datasets[0].data = [soAnToan, soChuY, soNguyHiem];
  bieuDoTron.update();
}

function capNhatGiaoDienTrangThai() {
  layPhanTu('nguongHienTaiText').textContent = `Ngưỡng: ${nguongCanhBaoHienTai} cm`;
  layPhanTu('tongMauDo').textContent = danhSachBanGhi.length;

  const banGhiMoiNhat = duLieuHienTai || danhSachBanGhi[danhSachBanGhi.length - 1];

  if (banGhiMoiNhat && banGhiMoiNhat.khoangCach !== null) {
    const mucHienTai = danhGiaMucCanhBao(banGhiMoiNhat.khoangCach, banGhiMoiNhat.pir);
    layPhanTu('giaTriKhoangCach').textContent = banGhiMoiNhat.khoangCach.toFixed(1) + ' cm';
    layPhanTu('nhanMucCanhBao').textContent = NHAN_MUC_DO[mucHienTai];
    layPhanTu('theKhoangCach').className = 'card stat main ' + mucHienTai;
  } else {
    layPhanTu('giaTriKhoangCach').textContent = '--';
    layPhanTu('nhanMucCanhBao').textContent = banGhiMoiNhat ? 'Ngoài tầm đo' : 'Chờ dữ liệu';
    layPhanTu('theKhoangCach').className = 'card stat main';
  }

  if (banGhiMoiNhat && banGhiMoiNhat.pir !== null) {
    if (banGhiMoiNhat.pir === 1) {
      layPhanTu('trangThaiPir').textContent = 'CÓ NGƯỜI';
      layPhanTu('chiTietPir').textContent = 'Phát hiện chuyển động';
      layPhanTu('thePir').className = 'card stat pir-active';
    } else {
      layPhanTu('trangThaiPir').textContent = 'Yên tĩnh';
      layPhanTu('chiTietPir').textContent = 'Không có chuyển động';
      layPhanTu('thePir').className = 'card stat';
    }
  } else {
    layPhanTu('trangThaiPir').textContent = '--';
    layPhanTu('chiTietPir').textContent = '--';
    layPhanTu('thePir').className = 'card stat';
  }

  const denDangSang = banGhiMoiNhat ? banGhiMoiNhat.den === 1 : lenhDenHienTai === 1;
  layPhanTu('bongDenMoPhong').className = 'led-light' + (denDangSang ? ' green' : '');
  layPhanTu('trangThaiDen').textContent = denDangSang ? 'ĐANG SÁNG' : 'ĐANG TẮT';
  layPhanTu('chiTietDen').textContent = lenhDenHienTai === 1 ? 'Chế độ: Ép bật từ Web' : 'Chế độ: Tự động theo PIR';
  layPhanTu('trangThaiLenhDen').textContent = `Phần cứng: ${denDangSang ? 'ĐANG SÁNG' : 'ĐANG TẮT'}`;

  const nhanCheDoDen = layPhanTu('nhanCheDoDen');
  nhanCheDoDen.textContent = lenhDenHienTai === 1 ? 'Ép bật (Web)' : 'Tự động (PIR)';
  nhanCheDoDen.className = 'mini-badge ' + (lenhDenHienTai === 1 ? 'manual' : '');

  const coiDangKeu = banGhiMoiNhat ? banGhiMoiNhat.coi === 1 : lenhCoiHienTai === 1;
  layPhanTu('trangThaiCoi').textContent = coiDangKeu ? 'ĐANG KÊU' : 'IM LẶNG';
  layPhanTu('chiTietCoi').textContent = lenhCoiHienTai === 1
    ? 'Chế độ: Ép bật từ Web'
    : `Chế độ: Tự động (< ${nguongCanhBaoHienTai} cm)`;
  layPhanTu('theCoi').className = 'card stat' + (coiDangKeu ? ' buzzer-alarm' : '');
  layPhanTu('trangThaiLenhCoi').textContent = `Phần cứng: ${coiDangKeu ? 'ĐANG KÊU' : 'IM LẶNG'}`;

  const nhanCheDoCoi = layPhanTu('nhanCheDoCoi');
  nhanCheDoCoi.textContent = lenhCoiHienTai === 1
    ? 'Ép bật (Web)'
    : `Tự động (< ${nguongCanhBaoHienTai} cm)`;
  nhanCheDoCoi.className = 'mini-badge ' + (lenhCoiHienTai === 1 ? 'manual' : '');
}

function capNhatThongKeVaBang() {
  const danhSachCuLy = danhSachBanGhi.filter((b) => b.khoangCach !== null).map((b) => b.khoangCach);
  if (danhSachCuLy.length > 0) {
    const tong = danhSachCuLy.reduce((a, b) => a + b, 0);
    const nhoNhat = Math.min(...danhSachCuLy).toFixed(1);
    const lonNhat = Math.max(...danhSachCuLy).toFixed(1);
    layPhanTu('khoangCachTrungBinh').textContent = (tong / danhSachCuLy.length).toFixed(1) + ' cm';
    layPhanTu('khoangCachMinMax').textContent = `Min: ${nhoNhat} · Max: ${lonNhat}`;
  } else {
    layPhanTu('khoangCachTrungBinh').textContent = '--';
    layPhanTu('khoangCachMinMax').textContent = 'Min: -- · Max: --';
  }

  const soBaoDong = danhSachBanGhi.filter((b) => b.muc === 'danger').length;
  const soPir = danhSachBanGhi.filter((b) => b.pir === 1).length;
  const soDenBat = danhSachBanGhi.filter((b) => b.den === 1).length;
  const soCoiBat = danhSachBanGhi.filter((b) => b.coi === 1).length;
  const soAnToan = danhSachBanGhi.filter((b) => b.muc === 'safe').length;

  layPhanTu('tkBaoDong').textContent = soBaoDong;
  layPhanTu('tkPir').textContent = soPir;
  layPhanTu('tkDenBat').textContent = soDenBat;
  layPhanTu('tkCoiBat').textContent = soCoiBat;
  layPhanTu('tkTyLeAnToan').textContent = danhSachBanGhi.length > 0
    ? Math.round((soAnToan / danhSachBanGhi.length) * 100) + '%'
    : '100%';

  const danhSachHienThi = danhSachBanGhi.slice(-20).reverse();
  if (danhSachHienThi.length === 0) {
    layPhanTu('thanBangDuLieu').innerHTML = '<tr><td colspan="8" class="empty">Chưa có bản ghi lịch sử nào trên Firebase.</td></tr>';
    return;
  }

  layPhanTu('thanBangDuLieu').innerHTML = danhSachHienThi.map((b, chiSo) => {
    const chuoiKhoangCach = b.khoangCach !== null ? b.khoangCach.toFixed(1) + ' cm' : '--';
    const thePir = b.pir === 1
      ? '<span class="tag pir-yes">Có người</span>'
      : b.pir === 0
      ? '<span class="tag pir-no">Yên tĩnh</span>'
      : '--';
    const theDen = b.den === 1
      ? '<span class="tag led-on">SÁNG</span>'
      : '<span class="tag led-off">TẮT</span>';
    const theCoi = b.coi === 1
      ? '<span class="tag buzzer-on">KÊU</span>'
      : '<span class="tag buzzer-off">TẮT</span>';
    const cheDoWeb = `Đèn:${b.lenhDen === 1 ? 'Bật' : 'TĐ'} · Còi:${b.lenhCoi === 1 ? 'Bật' : 'TĐ'}`;

    return `
      <tr>
        <td>${danhSachBanGhi.length - chiSo}</td>
        <td>${b.thoiGianNgan}</td>
        <td>${chuoiKhoangCach}</td>
        <td>${thePir}</td>
        <td><span class="tag ${b.muc}">${NHAN_MUC_DO[b.muc]}</span></td>
        <td>${theDen}</td>
        <td>${theCoi}</td>
        <td><small>${cheDoWeb}</small></td>
      </tr>`;
  }).join('');
}

function apDungNguongMoiLenGiaoDien() {
  danhSachBanGhi = danhSachBanGhi.map((b) => ({
    ...b,
    muc: danhGiaMucCanhBao(b.khoangCach, b.pir),
  }));
  capNhatGiaoDienTrangThai();
  capNhatBieuDo();
  capNhatThongKeVaBang();
}

const ungDungFirebase = initializeApp({ databaseURL: DIA_CHI_FIREBASE });
const coSoDuLieu = getDatabase(ungDungFirebase);

onValue(ref(coSoDuLieu, '.info/connected'), (anhChup) => {
  const daKetNoi = anhChup.val() === true;
  layPhanTu('chuTrangThai').textContent = daKetNoi ? 'Trực tuyến (Realtime)' : 'Mất kết nối';
  layPhanTu('chamTrangThai').className = 'dot' + (daKetNoi ? '' : ' paused');
});

onValue(ref(coSoDuLieu, 'hienTai'), (anhChup) => {
  const duLieu = anhChup.val();
  if (!duLieu) return;
  const cuLyTho = Number(duLieu.khoangCach);
  duLieuHienTai = {
    pir: Number(duLieu.pir),
    khoangCach: !Number.isNaN(cuLyTho) && cuLyTho >= 0 ? cuLyTho : null,
    den: Number(duLieu.den),
    coi: Number(duLieu.coi),
  };
  capNhatGiaoDienTrangThai();
});

onValue(ref(coSoDuLieu, 'dieuKhien'), (anhChup) => {
  const duLieu = anhChup.val();
  if (!duLieu) return;
  lenhDenHienTai = Number(duLieu.epBatDen) === 1 ? 1 : 0;
  lenhCoiHienTai = Number(duLieu.epBatCoi) === 1 ? 1 : 0;

  const nguongTuCloud = Number(duLieu.nguongCanhBao);
  if (!Number.isNaN(nguongTuCloud) && nguongTuCloud >= 2 && nguongTuCloud <= 400) {
    nguongCanhBaoHienTai = nguongTuCloud;
    const oNhapNguong = layPhanTu('nguongCanhBao');
    if (document.activeElement !== oNhapNguong) {
      oNhapNguong.value = nguongCanhBaoHienTai;
    }
  }

  apDungNguongMoiLenGiaoDien();
});

function dangKyLangNgheLichSu() {
  if (huyLangNgheLichSu) {
    huyLangNgheLichSu();
  }
  const gioiHan = Number(layPhanTu('soBanGhiHienThi').value) || 30;
  const truyVanLichSu = query(ref(coSoDuLieu, 'lichSu'), limitToLast(gioiHan));

  huyLangNgheLichSu = onValue(truyVanLichSu, (anhChup) => {
    const duLieuTho = anhChup.val() || {};
    danhSachBanGhi = Object.entries(duLieuTho).map(([maKhoa, banGhi]) => {
      const pir = banGhi.pir !== undefined ? Number(banGhi.pir) : null;
      const cuLyTho = banGhi.khoangCach !== undefined ? Number(banGhi.khoangCach) : null;
      const khoangCach = cuLyTho !== null && !Number.isNaN(cuLyTho) && cuLyTho >= 0 ? cuLyTho : null;
      const den = Number(banGhi.den) || 0;
      const coi = Number(banGhi.coi) || 0;
      const lenhDen = Number(banGhi.lenhDen) || 0;
      const lenhCoi = Number(banGhi.lenhCoi) || 0;
      const mocThoiGian = banGhi.thoiGian ? new Date(Number(banGhi.thoiGian)) : new Date();

      return {
        maKhoa,
        thoiGianNgan: mocThoiGian.toLocaleTimeString('vi-VN'),
        thoiGianDayDu: mocThoiGian.toLocaleString('vi-VN'),
        pir,
        khoangCach,
        den,
        coi,
        lenhDen,
        lenhCoi,
        muc: danhGiaMucCanhBao(khoangCach, pir),
      };
    });

    capNhatGiaoDienTrangThai();
    capNhatBieuDo();
    capNhatThongKeVaBang();
  });
}

async function guiTrangThaiDieuKhien(epBatDenMoi, epBatCoiMoi, nguongMoi, moTa) {
  try {
    await set(ref(coSoDuLieu, 'dieuKhien'), {
      epBatDen: epBatDenMoi,
      epBatCoi: epBatCoiMoi,
      nguongCanhBao: nguongMoi,
    });
    ghiNhatKy(`Đã đồng bộ: ${moTa}.`, 'ok');
  } catch (loi) {
    ghiNhatKy('Lỗi gửi lệnh: ' + loi.message, 'error');
  }
}

function xuLyLuuNguongCanhBao() {
  const oNhapNguong = layPhanTu('nguongCanhBao');
  let giaTriMoi = Number(oNhapNguong.value);
  if (Number.isNaN(giaTriMoi)) {
    giaTriMoi = 10;
  }
  giaTriMoi = Math.min(400, Math.max(2, Math.round(giaTriMoi * 10) / 10));
  oNhapNguong.value = giaTriMoi;
  nguongCanhBaoHienTai = giaTriMoi;

  apDungNguongMoiLenGiaoDien();
  guiTrangThaiDieuKhien(
    lenhDenHienTai,
    lenhCoiHienTai,
    giaTriMoi,
    `Ngưỡng còi kêu mới < ${giaTriMoi} cm`
  );
}

layPhanTu('nutBatDen').addEventListener('click', () => {
  guiTrangThaiDieuKhien(1, lenhCoiHienTai, nguongCanhBaoHienTai, 'Ép Bật Đèn LED');
});

layPhanTu('nutTatDen').addEventListener('click', () => {
  guiTrangThaiDieuKhien(0, lenhCoiHienTai, nguongCanhBaoHienTai, 'Đưa Đèn LED về Tự động / Tắt');
});

layPhanTu('nutBatCoi').addEventListener('click', () => {
  guiTrangThaiDieuKhien(lenhDenHienTai, 1, nguongCanhBaoHienTai, 'Ép Bật Còi Buzzer');
});

layPhanTu('nutTatCoi').addEventListener('click', () => {
  guiTrangThaiDieuKhien(lenhDenHienTai, 0, nguongCanhBaoHienTai, 'Đưa Còi Buzzer về Tự động / Tắt');
});

layPhanTu('nutLuuNguong').addEventListener('click', xuLyLuuNguongCanhBao);
layPhanTu('nguongCanhBao').addEventListener('change', xuLyLuuNguongCanhBao);
layPhanTu('nguongCanhBao').addEventListener('keydown', (suKien) => {
  if (suKien.key === 'Enter') {
    suKien.preventDefault();
    xuLyLuuNguongCanhBao();
  }
});

layPhanTu('soBanGhiHienThi').addEventListener('change', dangKyLangNgheLichSu);

layPhanTu('nutXoaLichSu').addEventListener('click', async () => {
  try {
    await remove(ref(coSoDuLieu, 'lichSu'));
    ghiNhatKy('Đã xóa toàn bộ lịch sử đo trên Firebase.', 'warn');
  } catch (loi) {
    ghiNhatKy('Không xóa được lịch sử: ' + loi.message, 'error');
  }
});

layPhanTu('nutXuatCsv').addEventListener('click', () => {
  const tieuDe = 'STT,Thời gian,Khoảng cách (cm),PIR (0/1),Mức cảnh báo,Đèn thực tế,Còi thực tế,Lệnh Đèn Web,Lệnh Còi Web\n';
  const cacDong = danhSachBanGhi.map((b, chiSo) => {
    const cuLy = b.khoangCach !== null ? b.khoangCach : 'N/A';
    const pir = b.pir !== null ? b.pir : 'N/A';
    return `${chiSo + 1},"${b.thoiGianDayDu}",${cuLy},${pir},${NHAN_MUC_DO[b.muc]},${b.den},${b.coi},${b.lenhDen},${b.lenhCoi}`;
  }).join('\n');

  const tepCsv = new Blob(['\uFEFF' + tieuDe + cacDong], { type: 'text/csv;charset=utf-8' });
  const theTai = document.createElement('a');
  theTai.href = URL.createObjectURL(tepCsv);
  theTai.download = 'bao_cao_iot_firebase.csv';
  theTai.click();
  URL.revokeObjectURL(theTai.href);
  ghiNhatKy('Đã xuất file báo cáo CSV.', 'ok');
});

dangKyLangNgheLichSu();
ghiNhatKy('Đã khởi tạo kết nối Firebase Realtime Database.', 'ok');