/**
 * =====================================================
 * IPD KPI Dashboard — script.js
 * โรงพยาบาลพระนครศรีอยุธยา | กลุ่มงานเภสัชกรรม
 *
 * GitHub Pages Compatible:
 *  - ใช้ EMBEDDED_KPI_DATA จาก data/embedded_data.js (ไม่ต้อง fetch)
 *  - Fallback ไปใช้ fetch() สำหรับ server-based deploy
 *  - ทุก dependency โหลดผ่าน CDN
 *
 * Architecture:
 *  RAW_DATA      → ข้อมูลดิบจาก embedded data หรือ JSON
 *  FILTERED_DATA → ข้อมูลหลัง filter ตามช่วงเดือน
 *  CHART_REGISTRY → { id: Chart instance } สำหรับ destroy ก่อน re-render
 *  state         → สถานะ UI ปัจจุบัน
 * =====================================================
 */

'use strict';

/* ===================================================
   CONFIG — แก้ไขสีและค่าเป้าหมายได้ที่นี่
   =================================================== */
const SECTION_COLORS = {
  ops:         ['#7C9EE8', '#A8C8F4', '#C8E4F8'],
  med_error:   ['#F4A8A8', '#F4C8A8', '#E87C7C', '#F4D8A8', '#D8A8F4', '#A8E8C8'],
  adr:         ['#B8A8F4', '#D8A8F4', '#A8C8F4', '#F4A8D8', '#C8F4A8', '#F4E8A8', '#A8E8D8'],
  pharmcare:   ['#A8E8C8', '#7CD8A8', '#A8F4D8', '#C8E8A8', '#F4E0A8', '#E87C7C', '#F4A8A8'],
  med_rec:     ['#F4D8A8', '#E8C48C', '#A8D8E8', '#7CB8E8'],
  counseling:  ['#A8D8F4', '#7CB8E8', '#C8A8F4'],
  iv_events:   ['#F4B8A8', '#F4A8C8', '#A8C8F4', '#F4D8A8', '#C8F4A8', '#D8A8F4'],
  rx_subtypes: ['#E8C8F4', '#B8A8F4', '#C8D8F4', '#A8E8D8', '#F4E0A8', '#F4C8A8', '#A8D8E8', '#F4A8A8', '#C8F4D8'],
};

/* ===================================================
   STATE
   =================================================== */
let RAW_DATA      = null;   // ข้อมูลดิบ (จาก embedded หรือ upload)
let FILTERED_DATA = {};     // ข้อมูลหลัง filter
let CHART_REGISTRY = {};    // id → Chart instance
let _chartBoxCounter = 0;   // counter สำหรับ id ของ dynamic chart boxes

const state = {
  section: 'overview',
  monthFrom: null,
  monthTo: null,
  activeOpsMetrics: new Set(), // metrics ที่เลือกในหน้า OPS
};

/* ===================================================
   INIT — เริ่มต้น Dashboard
   =================================================== */
document.addEventListener('DOMContentLoaded', () => {
  initData();
  setupEventListeners();
});

/**
 * initData — โหลดข้อมูล
 * Priority: 1) EMBEDDED_KPI_DATA (จาก embedded_data.js)
 *           2) fetch('data/ipd_kpi.json') สำหรับ server deploy
 */
async function initData() {
  try {
    // ตรวจสอบว่า embedded data โหลดมาหรือยัง (จาก embedded_data.js)
    if (typeof EMBEDDED_KPI_DATA !== 'undefined' && EMBEDDED_KPI_DATA) {
      RAW_DATA = EMBEDDED_KPI_DATA;
      initMonthFilters();
      applyFilter();
      hideLoading();
      return;
    }

    // Fallback: fetch JSON (ใช้ได้เมื่อ serve ผ่าน HTTP server)
    const res = await fetch('data/ipd_kpi.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    RAW_DATA = await res.json();
    initMonthFilters();
    applyFilter();
    hideLoading();

  } catch (err) {
    console.error('initData error:', err);
    showError(
      'ไม่สามารถโหลดข้อมูลได้<br><small>กรุณาตรวจสอบว่ามีไฟล์ <code>data/embedded_data.js</code> อยู่ในโปรเจกต์</small>'
    );
  }
}

/* ===================================================
   MONTH FILTERS
   =================================================== */
function initMonthFilters() {
  const months  = RAW_DATA.months;
  const fromSel = document.getElementById('month-from');
  const toSel   = document.getElementById('month-to');

  // ล้าง options เก่าก่อน (กรณี re-init หลัง upload)
  fromSel.innerHTML = '';
  toSel.innerHTML   = '';

  months.forEach(m => {
    fromSel.add(new Option(thaiMonthLabel(m), m));
    toSel.add(new Option(thaiMonthLabel(m), m));
  });

  // Default: 12 เดือนล่าสุด
  const last12Start = Math.max(0, months.length - 12);
  fromSel.value = months[last12Start];
  toSel.value   = months[months.length - 1];
  state.monthFrom = months[last12Start];
  state.monthTo   = months[months.length - 1];
}

function applyFilter() {
  const months  = RAW_DATA.months;
  const fromIdx = months.indexOf(state.monthFrom);
  const toIdx   = months.indexOf(state.monthTo);

  // validate range
  const start = fromIdx < 0 ? 0 : fromIdx;
  const end   = toIdx   < 0 ? months.length - 1 : toIdx;
  const selectedMonths = months.slice(start, end + 1);

  // สร้าง FILTERED_DATA สำหรับแต่ละ section
  FILTERED_DATA = {};
  for (const [sKey, sData] of Object.entries(RAW_DATA.sections)) {
    FILTERED_DATA[sKey] = {
      label:   sData.label,
      color:   sData.color,
      months:  selectedMonths,
      metrics: {},
    };
    for (const [mKey, mVals] of Object.entries(sData.metrics)) {
      FILTERED_DATA[sKey].metrics[mKey] = selectedMonths.map(m => {
        const v = mVals[m];
        return (v !== null && v !== undefined) ? v : null;
      });
    }
  }

  renderSection(state.section);
}

/* ===================================================
   NAVIGATION
   =================================================== */
function setupEventListeners() {
  // Navigation
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(el.dataset.section);
      // ปิด sidebar บน mobile
      if (window.innerWidth <= 768) closeSidebar();
    });
  });

  // Month filter apply
  document.getElementById('month-from').addEventListener('change', e => { state.monthFrom = e.target.value; });
  document.getElementById('month-to').addEventListener('change', e => { state.monthTo = e.target.value; });
  document.getElementById('btn-apply').addEventListener('click', () => applyFilter());

  // Mobile menu
  document.getElementById('menu-toggle').addEventListener('click', toggleSidebar);
  document.getElementById('sidebar-backdrop').addEventListener('click', closeSidebar);

  // Excel upload
  document.getElementById('file-input').addEventListener('change', handleFileUpload);

  // Table controls
  document.getElementById('table-search').addEventListener('input', () => renderTableFilter());
  document.getElementById('table-section-filter').addEventListener('change', () => renderTableFilter());

  // Export CSV
  document.getElementById('btn-export').addEventListener('click', exportCSV);
}

function navigateTo(section) {
  state.section = section;

  // Update active nav
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.section === section);
  });

  // Show/hide sections
  document.querySelectorAll('.section').forEach(el => el.classList.add('hidden'));
  const target = document.getElementById('section-' + section);
  if (target) target.classList.remove('hidden');

  // Update page title
  const navItem = document.querySelector(`.nav-item[data-section="${section}"] span:last-child`);
  if (navItem) document.getElementById('page-title').textContent = navItem.textContent;

  renderSection(section);
}

function toggleSidebar() {
  const sidebar  = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const isOpen   = sidebar.classList.contains('open');
  if (isOpen) closeSidebar();
  else {
    sidebar.classList.add('open');
    backdrop.classList.add('visible');
  }
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-backdrop').classList.remove('visible');
}

/* ===================================================
   RENDER DISPATCHER
   =================================================== */
function renderSection(section) {
  if (!RAW_DATA) return;
  switch (section) {
    case 'overview':    renderOverview();    break;
    case 'ops':         renderOps();         break;
    case 'med_error':   renderMedError();    break;
    case 'rx_subtypes': renderRxSubtypes();  break;
    case 'adr':         renderADR();         break;
    case 'pharmcare':   renderPharmcare();   break;
    case 'med_rec':     renderMedRec();      break;
    case 'counseling':  renderCounseling();  break;
    case 'iv_events':   renderIVEvents();    break;
    case 'table':       renderTable();       break;
  }
}

/* ===================================================
   SECTION: OVERVIEW
   =================================================== */
function renderOverview() {
  if (!FILTERED_DATA.med_error) return;

  const months  = FILTERED_DATA.med_error.months;
  const lastIdx = months.length - 1;
  const prevIdx = lastIdx - 1;

  // Helper: ดึงค่าของ metric ใน section
  const getVal  = (sec, key) => FILTERED_DATA[sec]?.metrics[key]?.[lastIdx] ?? null;
  const getPrev = (sec, key) => FILTERED_DATA[sec]?.metrics[key]?.[prevIdx] ?? null;

  // ===== Summary Cards =====
  const cardsDef = [
    { icon:'🏥', color:'#A8C8F4', label:'วันนอน รพ. (เดือนล่าสุด)',    unit:'วัน',  sec:'ops',       key:'วันนอน รพ. (วัน)' },
    { icon:'💊', color:'#A8E8C8', label:'ใบสั่งยาต่อเนื่อง (Continue)', unit:'ใบ',   sec:'ops',       key:'ใบสั่งยา Continue' },
    { icon:'⚠️', color:'#F4A8A8', label:'Prescription Error (เดือนล่าสุด)', unit:'ครั้ง', sec:'med_error', key:'Prescription Error รวม', lowerBetter:true },
    { icon:'🔴', color:'#F4D8A8', label:'Pre-dispensing Error',          unit:'ครั้ง', sec:'med_error', key:'Pre-dispensing Error รวม', lowerBetter:true },
    { icon:'🔬', color:'#C8A8F4', label:'ประเมินแพ้ยา (Active ADR)',     unit:'ราย',  sec:'adr',       key:'ประเมินแพ้ยา (Active ADR)' },
    { icon:'❤️', color:'#A8E8D8', label:'D/C Counseling',                unit:'ราย',  sec:'pharmcare', key:'D/C Counseling' },
    { icon:'🔄', color:'#F4E0A8', label:'ส่งภายใน 2 ชม. (%)',           unit:'%',    sec:'med_rec',   key:'ส่งภายใน 2 ชม. (%)', target:100 },
    { icon:'🎓', color:'#A8D8F4', label:'สอนใช้ยาเทคนิคพิเศษ',          unit:'ครั้ง', sec:'counseling',key:'สอนใช้ยาเทคนิคพิเศษ' },
  ];

  const container = document.getElementById('summary-cards');
  container.innerHTML = '';

  cardsDef.forEach(card => {
    const curr = getVal(card.sec, card.key);
    const prev = getPrev(card.sec, card.key);
    let trendHtml = '';
    if (curr !== null && prev !== null && prev !== 0) {
      const diff = curr - prev;
      const pct  = Math.abs((diff / prev * 100)).toFixed(1);
      const cls  = diff > 0
        ? (card.lowerBetter ? 'trend-up' : 'trend-down')
        : diff < 0 ? (card.lowerBetter ? 'trend-down' : 'trend-up') : 'trend-flat';
      const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
      trendHtml = `<span class="card-trend ${cls}">${arrow} ${pct}% จากเดือนก่อน</span>`;
    }

    const el = document.createElement('div');
    el.className = 'summary-card';
    el.style.borderLeftColor = card.color;
    el.innerHTML = `
      <div class="card-icon">${card.icon}</div>
      <div class="card-label">${card.label}</div>
      <div class="card-value">${curr !== null ? fmtNum(curr) : '—'}</div>
      <div class="card-unit">${card.unit}${card.target ? ` / เป้า ${card.target}${card.unit}` : ''}</div>
      ${trendHtml}
    `;
    el.addEventListener('click', () => navigateTo(card.sec));
    container.appendChild(el);
  });

  // ===== Overview Charts (4 charts) =====
  const chartsEl = document.getElementById('overview-charts');
  chartsEl.innerHTML = '';

  const box1 = makeChartBox('Medication Error รายเดือน');
  const box2 = makeChartBox('การประเมินแพ้ยา รายเดือน');
  const box3 = makeChartBox('Pharmcare รายเดือน');
  const box4 = makeChartBox('Medication Reconciliation (%)');
  chartsEl.append(box1, box2, box3, box4);

  rAF(() => {
    // Chart 1: Medication Error trend
    mkLine(box1.querySelector('canvas'), months,
      ['Prescription Error รวม','Pre-dispensing Error รวม','Dispensing Error B-D'].map((k, i) => ({
        label: k,
        data:  FILTERED_DATA.med_error.metrics[k] ?? [],
        borderColor: SECTION_COLORS.med_error[i],
        backgroundColor: rgba(SECTION_COLORS.med_error[i], 0.08),
      }))
    );

    // Chart 2: ADR
    mkLine(box2.querySelector('canvas'), months,
      ['ประเมินแพ้ยา (Active ADR)','ประเมินประวัติแพ้ยา'].map((k, i) => ({
        label: k,
        data:  FILTERED_DATA.adr?.metrics[k] ?? [],
        borderColor: SECTION_COLORS.adr[i],
        backgroundColor: rgba(SECTION_COLORS.adr[i], 0.08),
      }))
    );

    // Chart 3: Pharmcare bar
    mkBar(box3.querySelector('canvas'), months,
      ['D/C Counseling','ผู้ป่วยที่กลับบ้าน'].map((k, i) => ({
        label: k,
        data:  FILTERED_DATA.pharmcare?.metrics[k] ?? [],
        backgroundColor: rgba(SECTION_COLORS.pharmcare[i], 0.78),
        borderRadius: 4,
      }))
    );

    // Chart 4: Med Rec % with target line
    mkLine(box4.querySelector('canvas'), months, [
      { label:'ส่งภายใน 2 ชม. (%)',   data: FILTERED_DATA.med_rec?.metrics['ส่งภายใน 2 ชม. (%)']  ?? [], borderColor:'#F4D8A8', backgroundColor: rgba('#F4D8A8',0.1) },
      { label:'ส่งภายใน 1 วัน (%)',   data: FILTERED_DATA.med_rec?.metrics['ส่งภายใน 1 วัน (%)']  ?? [], borderColor:'#A8D8E8', backgroundColor: rgba('#A8D8E8',0.1) },
      { label:'เป้าหมาย 100%', data: months.map(() => 100), borderColor:'#E85555', borderDash:[5,4], pointRadius:0, backgroundColor:'transparent' },
    ], { yMax: 110, yLabel: '%' });
  });
}

/* ===================================================
   SECTION: OPS
   =================================================== */
function renderOps() {
  if (!FILTERED_DATA.ops) return;
  const { months, metrics } = FILTERED_DATA.ops;
  const metricKeys = Object.keys(metrics);

  // Init chips state
  if (state.activeOpsMetrics.size === 0) metricKeys.forEach(k => state.activeOpsMetrics.add(k));

  // Chips UI
  const chipsEl = document.getElementById('ops-chips');
  chipsEl.innerHTML = '';
  metricKeys.forEach(k => {
    const chip = document.createElement('div');
    chip.className = 'chip' + (state.activeOpsMetrics.has(k) ? ' active' : '');
    chip.textContent = k;
    chip.addEventListener('click', () => {
      state.activeOpsMetrics.has(k) ? state.activeOpsMetrics.delete(k) : state.activeOpsMetrics.add(k);
      renderOps();
    });
    chipsEl.appendChild(chip);
  });

  // Main line chart
  const canvas       = document.getElementById('chart-ops');
  const activeKeys   = metricKeys.filter(k => state.activeOpsMetrics.has(k));
  destroyChart('chart-ops');
  CHART_REGISTRY['chart-ops'] = mkLine(canvas, months,
    activeKeys.map((k, i) => ({
      label: k,
      data:  metrics[k],
      borderColor: SECTION_COLORS.ops[i % SECTION_COLORS.ops.length],
      backgroundColor: rgba(SECTION_COLORS.ops[i % SECTION_COLORS.ops.length], 0.1),
    }))
  );

  // 2-col: bar comparison + stats
  const col2 = document.getElementById('ops-charts-2');
  col2.innerHTML = '';

  const box1 = makeChartBox('ใบสั่งยา Continue vs ระหว่างวัน');
  col2.appendChild(box1);

  // Stats summary box
  const statsBox = document.createElement('div');
  statsBox.className = 'stat-summary-box';
  statsBox.innerHTML = '<div class="chart-box-title">สถิติรวม (ช่วงที่เลือก)</div>' +
    metricKeys.map(k => {
      const vals = metrics[k].filter(v => v !== null);
      if (!vals.length) return '';
      const avg = (vals.reduce((a,b) => a+b, 0) / vals.length).toFixed(0);
      const max = Math.max(...vals);
      const min = Math.min(...vals);
      return `<div class="stat-row">
        <div class="stat-row-label">${k}</div>
        <div class="stat-row-values">เฉลี่ย: <b>${fmtNum(+avg)}</b> &nbsp;|&nbsp; สูงสุด: ${fmtNum(max)} &nbsp;|&nbsp; ต่ำสุด: ${fmtNum(min)}</div>
      </div>`;
    }).join('');
  col2.appendChild(statsBox);

  rAF(() => {
    mkBar(box1.querySelector('canvas'), months, [
      { label:'ใบสั่งยา Continue',  data: metrics['ใบสั่งยา Continue']   ?? [], backgroundColor: rgba('#A8C8F4', 0.82), borderRadius: 4 },
      { label:'ใบสั่งยาระหว่างวัน', data: metrics['ใบสั่งยาระหว่างวัน'] ?? [], backgroundColor: rgba('#A8E8C8', 0.82), borderRadius: 4 },
    ]);
  });
}

/* ===================================================
   SECTION: MEDICATION ERROR
   =================================================== */
function renderMedError() {
  if (!FILTERED_DATA.med_error) return;
  const { months, metrics } = FILTERED_DATA.med_error;
  const lastIdx = months.length - 1;

  // Mini cards
  const cardsDef = [
    { label:'Prescription Error', key:'Prescription Error รวม',   icon:'📋', color:'#F4A8A8' },
    { label:'Transcribing Error',  key:'Transcribing Error',        icon:'📝', color:'#F4C8A8' },
    { label:'Pre-dispensing Error',key:'Pre-dispensing Error รวม', icon:'⚗️', color:'#E87C7C' },
    { label:'Dispensing Error B-D',key:'Dispensing Error B-D',     icon:'💊', color:'#F4D8A8' },
    { label:'Dispensing Error E-I',key:'Dispensing Error E-I',     icon:'🚨', color:'#D8A8F4' },
    { label:'อุบัติการณ์',         key:'อุบัติการณ์',              icon:'⚠️', color:'#A8E8C8' },
  ];

  document.getElementById('med-error-cards').innerHTML = cardsDef.map(c => {
    const val  = metrics[c.key]?.[lastIdx] ?? null;
    const prev = metrics[c.key]?.[lastIdx - 1] ?? null;
    const trendHtml = trendBadge(val, prev);
    return `<div class="mini-card" style="border-top-color:${c.color}">
      <div class="mini-card-label">${c.icon} ${c.label}</div>
      <div class="mini-card-value">${val !== null ? fmtNum(val) : '—'}</div>
      ${trendHtml}
    </div>`;
  }).join('');

  // Main trend chart
  destroyChart('chart-med-error-trend');
  CHART_REGISTRY['chart-med-error-trend'] = mkLine(
    document.getElementById('chart-med-error-trend'), months, [
      { label:'Prescription Error',   data: metrics['Prescription Error รวม']   ?? [], borderColor:'#F4A8A8', backgroundColor: rgba('#F4A8A8',0.08) },
      { label:'Pre-dispensing Error', data: metrics['Pre-dispensing Error รวม'] ?? [], borderColor:'#E87C7C', backgroundColor: rgba('#E87C7C',0.08) },
      { label:'Dispensing Error B-D', data: metrics['Dispensing Error B-D']     ?? [], borderColor:'#F4D8A8', backgroundColor: rgba('#F4D8A8',0.08) },
      { label:'Dispensing Error E-I', data: metrics['Dispensing Error E-I']     ?? [], borderColor:'#D8A8F4', backgroundColor: rgba('#D8A8F4',0.08) },
    ]
  );

  // 2-col charts
  const col2 = document.getElementById('med-error-charts-2');
  col2.innerHTML = '';
  const box1 = makeChartBox('Dispensing Error (B-D vs E-I)');
  const box2 = makeChartBox('Error รวมทุกประเภท (Stacked)');
  col2.append(box1, box2);

  rAF(() => {
    mkBar(box1.querySelector('canvas'), months, [
      { label:'ระดับ B-D', data: metrics['Dispensing Error B-D'] ?? [], backgroundColor: rgba('#F4D8A8',0.88), borderRadius: 4 },
      { label:'ระดับ E-I', data: metrics['Dispensing Error E-I'] ?? [], backgroundColor: rgba('#E87C7C',0.88), borderRadius: 4 },
    ]);
    mkBar(box2.querySelector('canvas'), months, [
      { label:'Prescription',   data: metrics['Prescription Error รวม']   ?? [], backgroundColor: rgba('#F4A8A8',0.88), borderRadius: 0 },
      { label:'Transcribing',   data: metrics['Transcribing Error']        ?? [], backgroundColor: rgba('#F4C8A8',0.88), borderRadius: 0 },
      { label:'Pre-dispensing', data: metrics['Pre-dispensing Error รวม'] ?? [], backgroundColor: rgba('#E87C7C',0.88), borderRadius: 0 },
    ], { stacked: true });
  });
}

/* ===================================================
   SECTION: RX SUBTYPES
   =================================================== */
function renderRxSubtypes() {
  if (!FILTERED_DATA.rx_subtypes) return;
  const { months, metrics } = FILTERED_DATA.rx_subtypes;

  // Aggregate totals and sort descending
  const subtypeKeys = Object.keys(metrics);
  const totals = subtypeKeys.map(k => ({
    label: k,
    total: (metrics[k] ?? []).filter(v => v !== null).reduce((a,b) => a+b, 0),
  })).sort((a,b) => b.total - a.total);

  // Horizontal bar — totals
  destroyChart('chart-rx-bar');
  const ctx = document.getElementById('chart-rx-bar').getContext('2d');
  CHART_REGISTRY['chart-rx-bar'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: totals.map(t => t.label),
      datasets: [{
        label: 'รวมทั้งหมด (ครั้ง)',
        data:  totals.map(t => t.total),
        backgroundColor: totals.map((_, i) => rgba(SECTION_COLORS.rx_subtypes[i % SECTION_COLORS.rx_subtypes.length], 0.82)),
        borderRadius: 6,
      }],
    },
    options: {
      ...baseOpts(),
      indexAxis: 'y',
      plugins: {
        ...baseOpts().plugins,
        legend: { display: false },
        title: {
          display: true,
          text: `Prescription Error แยกประเภท (รวม ${months.length} เดือน)`,
          color: '#1E2030',
          font: { size: 13, weight: '600', family: "'Sarabun', sans-serif" },
          padding: { bottom: 14 },
        },
      },
      scales: {
        x: axisOpts(),
        y: axisOpts(),
      },
    },
  });

  // Top-4 monthly trend charts
  const rxEl = document.getElementById('rx-subtype-charts');
  rxEl.innerHTML = '';
  totals.slice(0, 4).forEach((item, i) => {
    const box = makeChartBox(item.label + ' (รายเดือน)');
    rxEl.appendChild(box);
    rAF(() => {
      mkLine(box.querySelector('canvas'), months, [{
        label: item.label,
        data:  metrics[item.label] ?? [],
        borderColor: SECTION_COLORS.rx_subtypes[i % SECTION_COLORS.rx_subtypes.length],
        backgroundColor: rgba(SECTION_COLORS.rx_subtypes[i % SECTION_COLORS.rx_subtypes.length], 0.12),
        fill: true,
      }]);
    });
  });
}

/* ===================================================
   SECTION: ADR & การแพ้ยา
   =================================================== */
function renderADR() {
  if (!FILTERED_DATA.adr) return;
  const { months, metrics } = FILTERED_DATA.adr;
  const lastIdx = months.length - 1;

  // Mini cards
  const cardsDef = [
    { label:'ประเมินแพ้ยา (Active)',   key:'ประเมินแพ้ยา (Active ADR)',       color:'#B8A8F4' },
    { label:'ประเมินประวัติแพ้ยา',     key:'ประเมินประวัติแพ้ยา',             color:'#D8A8F4' },
    { label:'แพ้ยาซ้ำตรงตัว (ในระบบ)',key:'แพ้ยาซ้ำตรงตัว (ในระบบ)',         color:'#F4A8D8' },
    { label:'แพ้ยาซ้ำ (นอกระบบ)',      key:'แพ้ยาซ้ำตรงตัว (นอกระบบ)',        color:'#A8C8F4' },
    { label:'สั่งยาให้ผู้ป่วยที่แพ้',  key:'สั่งยาให้ผู้ป่วยที่แพ้ตรงตัว',   color:'#F4A8A8' },
    { label:'DRPs รวม',                 key:'DRPs รวม',                        color:'#C8F4A8' },
  ];
  renderMiniCards('adr-cards', cardsDef, metrics, lastIdx);

  // Trend chart
  destroyChart('chart-adr-trend');
  CHART_REGISTRY['chart-adr-trend'] = mkLine(
    document.getElementById('chart-adr-trend'), months, [
      { label:'ประเมินแพ้ยา (Active)',   data: metrics['ประเมินแพ้ยา (Active ADR)']     ?? [], borderColor:'#B8A8F4', backgroundColor: rgba('#B8A8F4',0.1) },
      { label:'ประเมินประวัติแพ้ยา',    data: metrics['ประเมินประวัติแพ้ยา']           ?? [], borderColor:'#D8A8F4', backgroundColor: rgba('#D8A8F4',0.1) },
      { label:'แพ้ยาซ้ำ (ในระบบ)',      data: metrics['แพ้ยาซ้ำตรงตัว (ในระบบ)']      ?? [], borderColor:'#F4A8D8', backgroundColor: rgba('#F4A8D8',0.1) },
      { label:'สั่งยาให้ผู้ป่วยที่แพ้', data: metrics['สั่งยาให้ผู้ป่วยที่แพ้ตรงตัว'] ?? [], borderColor:'#F4A8A8', backgroundColor: rgba('#F4A8A8',0.1) },
    ]
  );

  // 2-col: doughnut + bar
  const col2 = document.getElementById('adr-charts-2');
  col2.innerHTML = '';
  const box1 = makeChartBox('การแพ้ยา สัดส่วน (เดือนล่าสุด)');
  const box2 = makeChartBox('DRPs รายเดือน');
  col2.append(box1, box2);

  rAF(() => {
    const pieKeys = ['แพ้ยาซ้ำตรงตัว (ในระบบ)','แพ้ยาซ้ำตรงตัว (นอกระบบ)','แพ้ยากลุ่มเดียวกัน (ในระบบ)','สั่งยาให้ผู้ป่วยที่แพ้ตรงตัว'];
    const pieData = pieKeys.map(k => metrics[k]?.[lastIdx] ?? 0);

    const pieId = box1.querySelector('canvas').id;
    destroyChart(pieId);
    const pieCtx = box1.querySelector('canvas').getContext('2d');
    CHART_REGISTRY[pieId] = new Chart(pieCtx, {
      type: 'doughnut',
      data: {
        labels: pieKeys,
        datasets: [{ data: pieData, backgroundColor: SECTION_COLORS.adr.slice(2, 6), borderWidth: 2, borderColor: '#fff' }],
      },
      options: {
        ...baseOpts(),
        plugins: {
          ...baseOpts().plugins,
          legend: { display: true, position: 'bottom', labels: { font: { family:"'Sarabun',sans-serif", size: 10 }, padding: 10 } },
          title:  { display: true, text: 'การแพ้ยา (เดือนล่าสุด)', color: '#1E2030', font: { size: 12, weight:'600', family:"'Sarabun',sans-serif" } },
        },
      },
    });

    mkBar(box2.querySelector('canvas'), months, [{
      label: 'DRPs รวม',
      data:  metrics['DRPs รวม'] ?? [],
      backgroundColor: rgba('#C8F4A8', 0.85),
      borderRadius: 4,
    }]);
  });
}

/* ===================================================
   SECTION: PHARMCARE
   =================================================== */
function renderPharmcare() {
  if (!FILTERED_DATA.pharmcare) return;
  const { months, metrics } = FILTERED_DATA.pharmcare;
  const lastIdx = months.length - 1;

  const cardsDef = [
    { label:'D/C Counseling',   key:'D/C Counseling',        color:'#A8E8C8' },
    { label:'ผู้ป่วยทั้งหมด',   key:'ผู้ป่วยทั้งหมด',         color:'#7CD8A8' },
    { label:'ผู้ป่วยกลับบ้าน', key:'ผู้ป่วยที่กลับบ้าน',     color:'#C8E8A8' },
    { label:'INR ตามเป้าหมาย', key:'INR ตามเป้าหมาย',       color:'#F4E0A8' },
    { label:'Minor Bleeding',   key:'Minor Bleeding',         color:'#F4A8A8' },
    { label:'Major Bleeding',   key:'Major Bleeding',         color:'#E87C7C' },
  ];
  renderMiniCards('pharmcare-cards', cardsDef, metrics, lastIdx);

  destroyChart('chart-pharmcare-trend');
  CHART_REGISTRY['chart-pharmcare-trend'] = mkLine(
    document.getElementById('chart-pharmcare-trend'), months, [
      { label:'D/C Counseling', data: metrics['D/C Counseling']       ?? [], borderColor:'#A8E8C8', backgroundColor: rgba('#A8E8C8',0.14), fill:true },
      { label:'ผู้ป่วยทั้งหมด', data: metrics['ผู้ป่วยทั้งหมด']        ?? [], borderColor:'#7CD8A8', backgroundColor: rgba('#7CD8A8',0.14), fill:true },
      { label:'ผู้ป่วยกลับบ้าน',data: metrics['ผู้ป่วยที่กลับบ้าน']  ?? [], borderColor:'#C8E8A8', backgroundColor: rgba('#C8E8A8',0.14), fill:true },
    ]
  );

  const col2 = document.getElementById('pharmcare-charts-2');
  col2.innerHTML = '';
  const box1 = makeChartBox('Bleeding (Minor/Major) รายเดือน');
  const box2 = makeChartBox('INR ตามเป้าหมาย รายเดือน');
  col2.append(box1, box2);

  rAF(() => {
    mkBar(box1.querySelector('canvas'), months, [
      { label:'Minor Bleeding', data: metrics['Minor Bleeding'] ?? [], backgroundColor: rgba('#F4A8A8',0.85), borderRadius: 4 },
      { label:'Major Bleeding', data: metrics['Major Bleeding'] ?? [], backgroundColor: rgba('#E87C7C',0.85), borderRadius: 4 },
    ]);
    mkBar(box2.querySelector('canvas'), months, [{
      label: 'INR ตามเป้าหมาย',
      data:  metrics['INR ตามเป้าหมาย'] ?? [],
      backgroundColor: rgba('#F4E0A8', 0.88),
      borderRadius: 4,
    }]);
  });
}

/* ===================================================
   SECTION: MEDICATION RECONCILIATION
   =================================================== */
function renderMedRec() {
  if (!FILTERED_DATA.med_rec) return;
  const { months, metrics } = FILTERED_DATA.med_rec;
  const lastIdx = months.length - 1;

  const cardsDef = [
    { label:'ประวัติยาใน รพ.',     key:'ประวัติยาใน รพ.',       color:'#F4D8A8' },
    { label:'ประวัติยานอก รพ.',    key:'ประวัติยานอก รพ.',      color:'#E8C48C' },
    { label:'ส่งภายใน 2 ชม. (%)', key:'ส่งภายใน 2 ชม. (%)', color:'#A8D8E8' },
    { label:'ส่งภายใน 1 วัน (%)', key:'ส่งภายใน 1 วัน (%)', color:'#7CB8E8' },
  ];
  renderMiniCards('med-rec-cards', cardsDef, metrics, lastIdx);

  destroyChart('chart-med-rec-trend');
  CHART_REGISTRY['chart-med-rec-trend'] = mkLine(
    document.getElementById('chart-med-rec-trend'), months, [
      { label:'ประวัติยาใน รพ.', data: metrics['ประวัติยาใน รพ.'] ?? [], borderColor:'#F4D8A8', backgroundColor: rgba('#F4D8A8',0.1) },
      { label:'ประวัติยานอก รพ.',data: metrics['ประวัติยานอก รพ.']?? [], borderColor:'#E8C48C', backgroundColor: rgba('#E8C48C',0.1) },
    ]
  );

  const col2 = document.getElementById('med-rec-charts-2');
  col2.innerHTML = '';
  const box1 = makeChartBox('% ส่งข้อมูลทันเวลา รายเดือน');
  const box2 = makeChartBox('จำนวนผู้ป่วยที่มีประวัติยา');
  col2.append(box1, box2);

  rAF(() => {
    mkLine(box1.querySelector('canvas'), months, [
      { label:'ส่งภายใน 2 ชม. (Hx ใน รพ.)',  data: metrics['ส่งภายใน 2 ชม. (%)'] ?? [], borderColor:'#A8D8E8', backgroundColor: rgba('#A8D8E8',0.14), fill:true },
      { label:'ส่งภายใน 1 วัน (Hx นอก รพ.)', data: metrics['ส่งภายใน 1 วัน (%)'] ?? [], borderColor:'#7CB8E8', backgroundColor: rgba('#7CB8E8',0.14), fill:true },
      { label:'เป้าหมาย 100%', data: months.map(() => 100), borderColor:'#E85555', borderDash:[5,4], pointRadius:0, backgroundColor:'transparent' },
    ], { yMax: 110, yLabel: '%' });

    mkBar(box2.querySelector('canvas'), months, [
      { label:'Hx ใน รพ.', data: metrics['ประวัติยาใน รพ.'] ?? [], backgroundColor: rgba('#F4D8A8',0.85), borderRadius: 4 },
      { label:'Hx นอก รพ.',data: metrics['ประวัติยานอก รพ.']?? [], backgroundColor: rgba('#A8D8E8',0.85), borderRadius: 4 },
    ]);
  });
}

/* ===================================================
   SECTION: การสอนใช้ยา / COUNSELING
   =================================================== */
function renderCounseling() {
  if (!FILTERED_DATA.counseling) return;
  const { months, metrics } = FILTERED_DATA.counseling;
  const lastIdx = months.length - 1;

  const cardsDef = [
    { label:'สอนใช้ยาเทคนิคพิเศษ',    key:'สอนใช้ยาเทคนิคพิเศษ',       color:'#A8D8F4' },
    { label:'ยาฉีดอินซูลิน',           key:'ยาฉีดอินซูลิน',             color:'#7CB8E8' },
    { label:'D/C Counselling ที่ห้องยา',key:'D/C Counselling ที่ห้องยา', color:'#C8A8F4' },
  ];
  renderMiniCards('counseling-cards', cardsDef, metrics, lastIdx);

  destroyChart('chart-counseling-trend');
  CHART_REGISTRY['chart-counseling-trend'] = mkBar(
    document.getElementById('chart-counseling-trend'), months, [
      { label:'สอนใช้ยาเทคนิคพิเศษ',     data: metrics['สอนใช้ยาเทคนิคพิเศษ']       ?? [], backgroundColor: rgba('#A8D8F4',0.88), borderRadius: 4 },
      { label:'D/C Counselling ที่ห้องยา', data: metrics['D/C Counselling ที่ห้องยา'] ?? [], backgroundColor: rgba('#C8A8F4',0.88), borderRadius: 4 },
      { label:'ยาฉีดอินซูลิน',            data: metrics['ยาฉีดอินซูลิน']             ?? [], backgroundColor: rgba('#7CB8E8',0.88), borderRadius: 4 },
    ]
  );
}

/* ===================================================
   SECTION: IV ADVERSE EVENTS
   =================================================== */
function renderIVEvents() {
  if (!FILTERED_DATA.iv_events) return;
  const { months, metrics } = FILTERED_DATA.iv_events;
  const lastIdx = months.length - 1;

  const cardsDef = [
    { label:'Phlebitis',              key:'Phlebitis',                  color:'#F4B8A8' },
    { label:'Red Man Syndrome',       key:'Red Man Syndrome',           color:'#F4A8C8' },
    { label:'Extravasation',          key:'Extravasation',              color:'#A8C8F4' },
    { label:'Bleeding (Warfarin)',    key:'Bleeding จาก Warfarin',      color:'#F4D8A8' },
    { label:'Bleeding (Enoxaparin)', key:'Bleeding จาก Enoxaparin',    color:'#C8F4A8' },
    { label:'Bleeding (rt-PA)',       key:'Bleeding จาก rt-PA',         color:'#D8A8F4' },
  ];
  renderMiniCards('iv-cards', cardsDef, metrics, lastIdx);

  // Trend line
  destroyChart('chart-iv-trend');
  CHART_REGISTRY['chart-iv-trend'] = mkLine(
    document.getElementById('chart-iv-trend'), months,
    cardsDef.map((c, i) => ({
      label: c.label,
      data:  metrics[c.key] ?? [],
      borderColor: SECTION_COLORS.iv_events[i],
      backgroundColor: rgba(SECTION_COLORS.iv_events[i], 0.1),
    }))
  );

  // 2-col: stacked bar + donut
  const col2 = document.getElementById('iv-charts-2');
  col2.innerHTML = '';
  const box1 = makeChartBox('IV Events Stacked รายเดือน');
  const box2 = makeChartBox('สัดส่วน IV Events (รวมทั้งหมด)');
  col2.append(box1, box2);

  rAF(() => {
    mkBar(box1.querySelector('canvas'), months,
      cardsDef.map((c, i) => ({
        label: c.label,
        data:  metrics[c.key] ?? [],
        backgroundColor: rgba(SECTION_COLORS.iv_events[i], 0.82),
        borderRadius: 0,
      })), { stacked: true }
    );

    // Donut: totals
    const totals = cardsDef.map(c => ({
      label: c.label,
      total: (metrics[c.key] ?? []).filter(v => v !== null).reduce((a,b) => a+b, 0),
    }));

    const donutId = box2.querySelector('canvas').id;
    destroyChart(donutId);
    const donutCtx = box2.querySelector('canvas').getContext('2d');
    CHART_REGISTRY[donutId] = new Chart(donutCtx, {
      type: 'doughnut',
      data: {
        labels: totals.map(t => t.label),
        datasets: [{
          data: totals.map(t => t.total),
          backgroundColor: SECTION_COLORS.iv_events.map(c => rgba(c, 0.88)),
          borderWidth: 2, borderColor: '#fff',
        }],
      },
      options: {
        ...baseOpts(),
        plugins: {
          ...baseOpts().plugins,
          legend: { display: true, position: 'bottom', labels: { font: { family:"'Sarabun',sans-serif", size:10 }, padding:8 } },
          title:  { display: true, text: 'สัดส่วนรวม', color:'#1E2030', font:{ size:12, weight:'600', family:"'Sarabun',sans-serif" } },
        },
      },
    });
  });
}

/* ===================================================
   SECTION: TABLE
   =================================================== */
function renderTable() {
  // Populate section filter options
  const filterEl = document.getElementById('table-section-filter');
  filterEl.innerHTML = '<option value="">ทุกหมวด</option>';
  Object.values(FILTERED_DATA).forEach(s => {
    filterEl.add(new Option(s.label, s.label));
  });
  renderTableFilter();
}

function renderTableFilter() {
  const search    = (document.getElementById('table-search')?.value || '').toLowerCase();
  const secFilter = document.getElementById('table-section-filter')?.value || '';
  const container = document.getElementById('table-container');

  if (!Object.keys(FILTERED_DATA).length) { container.innerHTML = emptyStateHTML('ยังไม่มีข้อมูล'); return; }

  const allMonths = Object.values(FILTERED_DATA)[0]?.months ?? [];
  const shownMonths    = allMonths.slice(-12); // แสดงสูงสุด 12 เดือน
  const monthStartIdx  = allMonths.length - shownMonths.length;

  let rows = [];
  for (const sData of Object.values(FILTERED_DATA)) {
    for (const [mKey, mVals] of Object.entries(sData.metrics)) {
      if (search    && !mKey.toLowerCase().includes(search))    continue;
      if (secFilter && sData.label !== secFilter)               continue;
      rows.push({ section: sData.label, metric: mKey, vals: mVals });
    }
  }

  if (!rows.length) { container.innerHTML = emptyStateHTML('ไม่พบข้อมูลที่ค้นหา'); return; }

  container.innerHTML = `
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>หมวดงาน</th>
            <th>ตัวชี้วัด</th>
            ${shownMonths.map(m => `<th>${thaiMonthLabel(m)}</th>`).join('')}
            <th>เฉลี่ย</th>
            <th>สูงสุด</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(row => {
            const shown      = row.vals.slice(monthStartIdx);
            const numeric    = shown.filter(v => v !== null && v !== undefined);
            const avg        = numeric.length ? fmtNum(+(numeric.reduce((a,b)=>a+b,0)/numeric.length).toFixed(1)) : '—';
            const max        = numeric.length ? fmtNum(Math.max(...numeric)) : '—';
            return `<tr>
              <td>${row.section}</td>
              <td>${row.metric}</td>
              ${shown.map(v => {
                if (v === null || v === undefined) return `<td class="null-cell">—</td>`;
                if (v === 0) return `<td class="zero-cell">0</td>`;
                return `<td>${fmtNum(v)}</td>`;
              }).join('')}
              <td class="stat-cell">${avg}</td>
              <td class="stat-cell">${max}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

/* ===================================================
   FILE UPLOAD (Excel → Dashboard)
   =================================================== */
function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  showLoading('กำลังประมวลผลไฟล์ Excel...');

  const reader = new FileReader();
  reader.onload = ev => {
    try {
      if (typeof XLSX === 'undefined') throw new Error('ไม่พบ SheetJS library');

      const wb    = XLSX.read(ev.target.result, { type: 'binary' });
      const sheet = wb.Sheets['การตอบแบบฟอร์ม 1'];
      if (!sheet) throw new Error('ไม่พบชีต "การตอบแบบฟอร์ม 1" ในไฟล์');

      const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
      const newData = processExcelData(rawRows);

      if (newData) {
        RAW_DATA = newData;
        // Reset state
        state.activeOpsMetrics.clear();
        // Re-init filters and render
        initMonthFilters();
        applyFilter();
        hideLoading();
        showToast(`✅ โหลดข้อมูลสำเร็จ! พบ ${RAW_DATA.months.length} เดือน`, 'success');
      }
    } catch (err) {
      hideLoading();
      showToast('❌ ' + err.message, 'error');
      console.error('Excel parse error:', err);
    }
    // Reset input so same file can be re-uploaded
    e.target.value = '';
  };
  reader.readAsBinaryString(file);
}

/**
 * processExcelData — แปลง raw Excel rows → structured data
 * รองรับโครงสร้าง Google Form ของโรงพยาบาล
 * เพิ่มข้อมูลรายเดือนใหม่ใน Excel → อัพโหลด → Dashboard อัพเดทอัตโนมัติ
 *
 * @param {Array[]} rows - raw rows จาก XLSX.utils.sheet_to_json
 * @returns {Object} data structure เดียวกับ ipd_kpi.json
 */
function processExcelData(rows) {
  if (!rows || rows.length < 2) throw new Error('ไฟล์ Excel ว่างเปล่า');

  const headers  = rows[0];
  const monthIdx = headers.indexOf('บันทึกประจำเดือน');
  const unitIdx  = headers.indexOf('หน่วยงาน');
  if (monthIdx < 0 || unitIdx < 0) throw new Error('ไม่พบคอลัมน์ "บันทึกประจำเดือน" หรือ "หน่วยงาน"');

  // กรองเฉพาะแถวงานผู้ป่วยใน
  const ipdRows = rows.slice(1).filter(r => r[unitIdx] === 'งานผู้ป่วยใน');
  if (!ipdRows.length) throw new Error('ไม่พบข้อมูลงานผู้ป่วยใน (หน่วยงาน = "งานผู้ป่วยใน")');

  // Parse และ sort เดือน
  const parseMonthKey = m => {
    if (!m || typeof m !== 'string') return [9999, 0];
    const clean = m.replace(' (TEST)', '').trim();
    const parts = clean.split('/');
    return [parseInt(parts[1]) || 9999, parseInt(parts[0]) || 0];
  };

  const monthSet = new Set();
  ipdRows.forEach(r => {
    const m = r[monthIdx];
    if (m) monthSet.add(String(m).replace(' (TEST)', '').trim());
  });

  const orderedMonths = [...monthSet].sort((a, b) => {
    const [ay, am] = parseMonthKey(a);
    const [by, bm] = parseMonthKey(b);
    return ay !== by ? ay - by : am - bm;
  });

  // Helper: ดึงค่าล่าสุดสำหรับ col ใน month
  const getLastVal = (month, colIdx) => {
    if (colIdx < 0) return null;
    const clean = month.trim();
    const monthRows = ipdRows
      .filter(r => String(r[monthIdx]).replace(' (TEST)', '').trim() === clean)
      .sort((a, b) => new Date(a[0]) - new Date(b[0]));
    const lastRow = monthRows[monthRows.length - 1];
    if (!lastRow) return null;
    const val = lastRow[colIdx];
    return (val !== null && val !== undefined && !isNaN(+val)) ? +val : null;
  };

  // Config: column name → metric label
  const sectionsConfig = {
    ops: {
      label:'ภาพรวมงาน IPD', color:'#7C9EE8',
      cols: [
        ['จำนวนวันนอนรพ.',                      'วันนอน รพ. (วัน)'],
        ['จำนวนใบสั่งยาต่อเนื่อง (Continue)',    'ใบสั่งยา Continue'],
        ['จำนวนใบสั่งยาระหว่างวัน',              'ใบสั่งยาระหว่างวัน'],
      ],
    },
    med_error: {
      label:'Medication Error', color:'#F4A8A8',
      cols: [
        ['Prescription error (ครั้ง)',              'Prescription Error รวม'],
        ['Transcribing error(ครั้ง)',               'Transcribing Error'],
        ['Pre-dispensing error (ครั้ง)',            'Pre-dispensing Error รวม'],
        ['Dispensing error (ครั้ง) ระดับ B-D',     'Dispensing Error B-D'],
        ['Dispensing error (ครั้ง) ระดับ E-I',     'Dispensing Error E-I'],
        ['อุบัติการณ์ (ครั้ง)',                     'อุบัติการณ์'],
      ],
    },
    adr: {
      label:'ADR และการแพ้ยา', color:'#B8A8F4',
      cols: [
        ['ประเมินแพ้ยา (active ADR)',               'ประเมินแพ้ยา (Active ADR)'],
        ['ประเมินประวัติแพ้ยา.1',                   'ประเมินประวัติแพ้ยา'],
        ['การแพ้ยาซ้ำตรงตัวในระบบ.1',              'แพ้ยาซ้ำตรงตัว (ในระบบ)'],
        ['การแพ้ยาซ้ำตรงตัวนอกระบบ.1',             'แพ้ยาซ้ำตรงตัว (นอกระบบ)'],
        ['การแพ้ยากลุ่มเดียวกันในระบบ.1',           'แพ้ยากลุ่มเดียวกัน (ในระบบ)'],
        ['การสั่งยาผู้ป่วยในที่มีประวัติแพ้ตรงตัว','สั่งยาให้ผู้ป่วยที่แพ้ตรงตัว'],
        ['DRPs (ครั้ง)',                              'DRPs รวม'],
      ],
    },
    pharmcare: {
      label:'Pharmcare', color:'#A8E8C8',
      cols: [
        ['Discharge Counseling (ราย)',      'D/C Counseling'],
        ['จำนวนผู้ป่วยทั้งหมด',             'ผู้ป่วยทั้งหมด'],
        ['จำนวนผู้ป่วยที่กลับบ้าน',         'ผู้ป่วยที่กลับบ้าน'],
        ['INR ตามเป้าหมาย ขณะ D/C (ครั้ง)','INR ตามเป้าหมาย'],
        ['Minor bleeding.1',                 'Minor Bleeding'],
        ['Major bleeding.1',                 'Major Bleeding'],
        ['DRPs.7',                           'DRPs Pharmcare'],
      ],
    },
    med_rec: {
      label:'Medication Reconciliation', color:'#F4D8A8',
      cols: [
        ['ผู้ป่วยมีประวัติใช้ยาใน รพ.',        'ประวัติยาใน รพ.'],
        ['ผู้ป่วยมีประวัติใช้ยานอก รพ.',        'ประวัติยานอก รพ.'],
        ['ส่งภายใน 2 ชม. (Hx ใน รพ) (%)',     'ส่งภายใน 2 ชม. (%)'],
        ['ส่งภายใน 1 วัน (Hx นอก รพ) (%)',    'ส่งภายใน 1 วัน (%)'],
      ],
    },
    counseling: {
      label:'การสอนใช้ยา', color:'#A8D8F4',
      cols: [
        ['จำนวนครั้งการสอนใช้ยาเทคนิคพิเศษ (ครั้ง)','สอนใช้ยาเทคนิคพิเศษ'],
        ['ยาฉีดอินซูลิน(ราย)',                         'ยาฉีดอินซูลิน'],
        ['D/C Counselling ที่ห้องยา',                  'D/C Counselling ที่ห้องยา'],
      ],
    },
    iv_events: {
      label:'IV Adverse Events', color:'#F4B8A8',
      cols: [
        ['Phlebitis (คน)',               'Phlebitis'],
        ['Red Man Syndrome (คน)',         'Red Man Syndrome'],
        ['Extravasation (คน)',            'Extravasation'],
        ['Bleeding จาก Warfarin(ราย)',   'Bleeding จาก Warfarin'],
        ['Bleeding จาก Enoxaparin (ราย)','Bleeding จาก Enoxaparin'],
        ['Bleeding จาก rt-PA (ราย)',     'Bleeding จาก rt-PA'],
      ],
    },
    rx_subtypes: {
      label:'Prescription Error แยกประเภท', color:'#E8C8F4',
      cols: [
        ['Prescription error : ผิดชนิด',       'ผิดชนิดยา'],
        ['Prescription error : ผิดความแรง',    'ผิดความแรง'],
        ['Prescription error : ผิดรูปแบบยา',  'ผิดรูปแบบ'],
        ['Prescription error : ผิดจำนวน',      'ผิดจำนวน'],
        ['Prescription error : ผิดขนาด',       'ผิดขนาด'],
        ['Prescription error : ผิดวิธีใช้',    'ผิดวิธีใช้'],
        ['Prescription error : ยาไม่ครบรายการ','ยาไม่ครบ'],
        ['Prescription error : สั่งยาที่ผู้ป่วยแพ้','สั่งยาที่ผู้ป่วยแพ้'],
        ['Prescription error : สั่งยาที่มี DI','สั่งยาที่มี DI'],
      ],
    },
  };

  // Build output structure
  const sections = {};
  for (const [sKey, sCfg] of Object.entries(sectionsConfig)) {
    const metricsData = {};
    for (const [colName, metricLabel] of sCfg.cols) {
      const colIdx = headers.indexOf(colName);
      const monthlyVals = {};
      orderedMonths.forEach(m => { monthlyVals[m] = getLastVal(m, colIdx); });
      metricsData[metricLabel] = monthlyVals;
    }
    sections[sKey] = { label: sCfg.label, color: sCfg.color, metrics: metricsData };
  }

  return { months: orderedMonths, sections };
}

/* ===================================================
   EXPORT CSV
   =================================================== */
function exportCSV() {
  if (!Object.keys(FILTERED_DATA).length) return;

  const months = Object.values(FILTERED_DATA)[0]?.months ?? [];
  const rows   = [['หมวดงาน', 'ตัวชี้วัด', ...months]];

  for (const sData of Object.values(FILTERED_DATA)) {
    for (const [mKey, mVals] of Object.entries(sData.metrics)) {
      rows.push([sData.label, mKey, ...mVals.map(v => v ?? '')]);
    }
  }

  // BOM สำหรับ Excel เปิดไฟล์ภาษาไทยได้ถูกต้อง
  const csv  = '\uFEFF' + rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `IPD_KPI_Export_${new Date().toLocaleDateString('th-TH').replace(/\//g,'-')}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('⬇ Export CSV เรียบร้อยแล้ว', 'success');
}

/* ===================================================
   CHART FACTORY FUNCTIONS
   แก้ไขแล้ว: borderDash อยู่ใน dataset.borderDash (Chart.js 4.x)
   =================================================== */

/**
 * mkLine — สร้าง Line chart
 * @param {HTMLCanvasElement} canvas
 * @param {string[]} months - month labels
 * @param {Object[]} datasets
 * @param {Object} opts - { yMax, yLabel }
 */
function mkLine(canvas, months, datasets, opts = {}) {
  if (!canvas) return null;
  const id = canvas.id;
  if (id) destroyChart(id);

  const ctx = canvas.getContext('2d');
  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: months.map(thaiMonthLabel),
      datasets: datasets.map(d => ({
        label:           d.label,
        data:            d.data,
        borderColor:     d.borderColor,
        backgroundColor: d.backgroundColor || 'transparent',
        borderWidth:     2.5,
        borderDash:      d.borderDash || [],        // ← ต้องอยู่ใน dataset
        pointRadius:     d.pointRadius !== undefined ? d.pointRadius : 3,
        pointHoverRadius: 6,
        tension:         0.38,
        fill:            d.fill || false,
        spanGaps:        true,
      })),
    },
    options: {
      ...baseOpts(),
      scales: {
        x: { ...axisOpts(), ticks: { ...axisOpts().ticks, maxRotation: 45 } },
        y: {
          ...axisOpts(),
          beginAtZero: true,
          max: opts.yMax || undefined,
          title: opts.yLabel
            ? { display: true, text: opts.yLabel, color: '#9EA4BE', font: { size: 11, family:"'Sarabun',sans-serif" } }
            : { display: false },
        },
      },
    },
  });

  if (id) CHART_REGISTRY[id] = chart;
  return chart;
}

/**
 * mkBar — สร้าง Bar chart
 */
function mkBar(canvas, months, datasets, opts = {}) {
  if (!canvas) return null;
  const id = canvas.id;
  if (id) destroyChart(id);

  const ctx = canvas.getContext('2d');
  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: months.map(thaiMonthLabel),
      datasets: datasets.map(d => ({
        label:           d.label,
        data:            d.data,
        backgroundColor: d.backgroundColor,
        borderRadius:    d.borderRadius ?? 4,
        borderSkipped:   false,
        spanGaps:        true,
      })),
    },
    options: {
      ...baseOpts(),
      scales: {
        x: { ...axisOpts(), stacked: !!opts.stacked, ticks: { ...axisOpts().ticks, maxRotation: 45 } },
        y: { ...axisOpts(), stacked: !!opts.stacked, beginAtZero: true },
      },
    },
  });

  if (id) CHART_REGISTRY[id] = chart;
  return chart;
}

/**
 * baseOpts — shared Chart.js options
 */
function baseOpts() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 550, easing: 'easeInOutQuart' },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: true,
        position: 'top',
        labels: {
          font:           { family: "'Sarabun', sans-serif", size: 11 },
          padding:        14,
          usePointStyle:  true,
          pointStyleWidth: 9,
          color:          '#5E6278',
        },
      },
      tooltip: {
        backgroundColor: 'rgba(30,32,48,0.93)',
        titleFont: { family: "'Sarabun', sans-serif", size: 13, weight: '600' },
        bodyFont:  { family: "'Sarabun', sans-serif", size: 12 },
        padding: 12, cornerRadius: 10, caretSize: 6,
        callbacks: {
          label: ctx => {
            const v = ctx.parsed?.y ?? ctx.parsed;
            return ` ${ctx.dataset.label}: ${v !== null && v !== undefined ? fmtNum(v) : '—'}`;
          },
        },
      },
    },
  };
}

/**
 * axisOpts — shared axis style
 */
function axisOpts() {
  return {
    grid:   { color: 'rgba(0,0,0,0.04)' },
    border: { display: false },
    ticks:  {
      color: '#9EA4BE',
      font:  { family: "'Sarabun', sans-serif", size: 10 },
      callback: v => typeof v === 'number' ? fmtNum(v) : v,
    },
  };
}

/**
 * destroyChart — ทำลาย Chart instance เก่าก่อน re-render
 */
function destroyChart(id) {
  if (id && CHART_REGISTRY[id]) {
    try { CHART_REGISTRY[id].destroy(); } catch(_) {}
    delete CHART_REGISTRY[id];
  }
}

/**
 * makeChartBox — สร้าง div สำหรับ chart พร้อม canvas
 * ใช้ counter สร้าง unique id เพื่อให้ destroyChart ทำงานถูกต้อง
 */
function makeChartBox(title) {
  const id  = 'dyn-chart-' + (++_chartBoxCounter);
  const div = document.createElement('div');
  div.className = 'chart-box';
  div.innerHTML = `
    <div class="chart-box-title">${title}</div>
    <div class="chart-box-inner"><canvas id="${id}"></canvas></div>
  `;
  return div;
}

/* ===================================================
   RENDER HELPERS
   =================================================== */

/**
 * renderMiniCards — render แถว mini cards
 */
function renderMiniCards(containerId, cardsDef, metrics, lastIdx) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = cardsDef.map(c => {
    const val  = metrics[c.key]?.[lastIdx] ?? null;
    const prev = metrics[c.key]?.[lastIdx - 1] ?? null;
    return `<div class="mini-card" style="border-top-color:${c.color}">
      <div class="mini-card-label">${c.label}</div>
      <div class="mini-card-value">${val !== null ? fmtNum(val) : '—'}</div>
      ${trendBadge(val, prev)}
    </div>`;
  }).join('');
}

/**
 * trendBadge — HTML สำหรับ trend indicator เล็กๆ
 */
function trendBadge(curr, prev) {
  if (curr === null || prev === null || prev === 0) return '';
  const diff = curr - prev;
  const pct  = Math.abs(diff / prev * 100).toFixed(1);
  const cls  = diff > 0 ? 'trend-up' : diff < 0 ? 'trend-down' : 'trend-flat';
  const arr  = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
  return `<div class="mini-card-sub ${cls}">${arr} ${pct}%</div>`;
}

/* ===================================================
   UTILITIES
   =================================================== */

/** thaiMonthLabel — แปลง "1/67" → "ม.ค.67" */
function thaiMonthLabel(m) {
  if (!m) return m;
  const parts = String(m).split('/');
  if (parts.length !== 2) return m;
  const names = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const mo    = parseInt(parts[0], 10) - 1;
  return `${names[mo] || parts[0]}${parts[1]}`;
}

/** fmtNum — format ตัวเลขเป็น Thai locale */
function fmtNum(n) {
  if (n === null || n === undefined || (typeof n === 'number' && isNaN(n))) return '—';
  const num = Number(n);
  return Number.isInteger(num) || num % 1 === 0
    ? num.toLocaleString('th-TH')
    : parseFloat(num.toFixed(2)).toLocaleString('th-TH');
}

/** rgba — แปลง hex + alpha เป็น rgba string */
function rgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** rAF — requestAnimationFrame wrapper */
function rAF(fn) { requestAnimationFrame(fn); }

/** emptyStateHTML — HTML สำหรับ empty state */
function emptyStateHTML(msg) {
  return `<div class="empty-state"><div class="empty-icon">🔍</div><p>${msg}</p></div>`;
}

/** hideLoading — ซ่อน loading overlay */
function hideLoading() {
  const el = document.getElementById('loading-overlay');
  if (!el) return;
  el.classList.add('hidden');
  setTimeout(() => { el.style.display = 'none'; }, 500);
}

/** showLoading — แสดง loading overlay */
function showLoading(msg = 'กำลังโหลด...') {
  const el = document.getElementById('loading-overlay');
  if (!el) return;
  el.style.display = '';
  el.classList.remove('hidden');
  const txt = el.querySelector('.loading-text');
  if (txt) txt.textContent = msg;
}

/** showError — แสดง error state ใน content area */
function showError(msg) {
  hideLoading();
  const area = document.getElementById('content-area');
  if (area) area.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${msg}</p></div>`;
}

/**
 * showToast — แสดง toast notification ชั่วคราว
 * @param {string} msg
 * @param {'success'|'error'|''} type
 */
function showToast(msg, type = '') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'toast' + (type ? ' ' + type : '');
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.4s';
    setTimeout(() => toast.remove(), 400);
  }, 3200);
}
