lucide.createIcons();

// ==========================================
// KONFIGURASI — URL GAS WEB APP
// ==========================================
// FIX: Baca dari localStorage spesifik per akun agar tidak tumpang tindih
const GAS_WEB_APP_URL = (function() {
    try {
        const sessStr = localStorage.getItem('inaportnet_session');
        const sess = sessStr ? JSON.parse(sessStr) : null;
        const configKey = `inaportnet_config_${sess?.username || 'default'}`;
        
        const cfgStr = localStorage.getItem(configKey) || localStorage.getItem('inaportnet_config') || '{}';
        const cfg = JSON.parse(cfgStr);
        return cfg.GAS_URL || "/api";
    } catch(e) {
        return "/api";
    }
})();

// ==========================================
// FIX: SANITASI HTML — CEGAH XSS
// ==========================================
function escHTML(str) {
    if (str === null || str === undefined) return '-';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================
window.formatTanggalIndo = function(dateStr) {
    if (!dateStr || dateStr === '-' || String(dateStr).trim() === '') return '-';
    try {
        let parsedStr = String(dateStr).trim();
        if (parsedStr.includes(' ') && !parsedStr.includes('T')) {
            parsedStr = parsedStr.replace(' ', 'T');
        }
        const date = new Date(parsedStr);
        if (isNaN(date.getTime())) return escHTML(dateStr);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        if (String(dateStr).length <= 10) return `${day}-${month}-${year}`;
        return `${day}-${month}-${year} ${hours}:${minutes}`;
    } catch (e) { return escHTML(dateStr); }
};

window.formatUang = function(nominal) {
    if (nominal === null || nominal === undefined || nominal === '') return '-';
    const num = parseInt(nominal);
    return isNaN(num) ? '-' : 'Rp ' + num.toLocaleString('id-ID');
};

window.statusTag = function(val, trueLabel, falseLabel) {
    const safe_t = escHTML(trueLabel);
    const safe_f = escHTML(falseLabel);
    return (val == 1 || val == '1' || val === true)
        ? `<span class="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-xs font-bold">${safe_t}</span>`
        : (falseLabel ? `<span class="bg-slate-100 text-slate-500 px-2 py-0.5 rounded text-xs">${safe_f}</span>` : '-');
};

// ==========================================
// DATA PELABUHAN
// ==========================================
let PORT_LIST = [];

async function loadPortData() {
    try {
        const response = await fetch('port.json');
        if (!response.ok) throw new Error('Gagal memuat port.json');
        PORT_LIST = await response.json();
    } catch (error) {
        console.error("Error memuat referensi pelabuhan:", error);
        Swal.fire({ toast: true, position: 'top-end', icon: 'error', title: 'Gagal Memuat Daftar Pelabuhan', text: 'Pastikan file port.json ada di folder yang sama.', showConfirmButton: false, timer: 4000 });
    }
}

function initPortDatalist() {
    // Input utama dashboard: datalist berisi nama pelabuhan
    const dl = document.getElementById('portDatalist');
    if (dl) {
        dl.innerHTML = PORT_LIST
            .map(p => `<option value="${escHTML(p.nama_pelabuhan)}"></option>`)
            .join('');
    }
    // Select settings diisi saat openSettingsModal dipanggil (bukan di sini)
}

window.getSelectedPortCode = function() {
    const raw = document.getElementById('portNameInput').value.trim().toUpperCase();
    if (!raw) return APP_CONFIG.DEFAULT_PORT_CODE;

    // 1. Exact match nama pelabuhan
    const byName = PORT_LIST.find(p => p.nama_pelabuhan.toUpperCase() === raw);
    if (byName) return byName.kode_pelabuhan;

    // 2. Exact match kode pelabuhan
    const byCode = PORT_LIST.find(p => p.kode_pelabuhan.toUpperCase() === raw);
    if (byCode) return byCode.kode_pelabuhan;

    // 3. Partial match nama (startsWith)
    const byPartial = PORT_LIST.find(p => p.nama_pelabuhan.toUpperCase().startsWith(raw));
    if (byPartial) return byPartial.kode_pelabuhan;

    // 4. Partial match nama (includes)
    const byIncludes = PORT_LIST.find(p => p.nama_pelabuhan.toUpperCase().includes(raw));
    if (byIncludes) return byIncludes.kode_pelabuhan;

    // 5. Kembalikan raw sebagai kode jika tidak ditemukan (jangan fallback ke default)
    return raw;
};

// ==========================================
// APP STATE
// ==========================================
let APP_CONFIG = {
    DEFAULT_PORT_CODE: 'IDLPO',
    USE_SCRAPING: 'FALSE',
    // Strategi pengambilan data — disimpan di localStorage
    // 'live_first'  : fetch live dulu, cache hanya jika live gagal (default)
    // 'cache_first' : pakai cache jika ada, live hanya jika cache kosong
    FETCH_STRATEGY: 'live_first'
};
// default_port per-user diset di DOMContentLoaded setelah session dibaca
let etaChartInst = null;
let trayekChartInst = null;
let paxChartInst = null;
let jenisChartInst = null;
let currentData = [];

// ==========================================
// FIX: FUNGSI loadData — SEBELUMNYA TIDAK ADA
// ==========================================
window.loadData = async function() {
    const portCode = window.getSelectedPortCode();
    const year = document.getElementById('yearFilter').value;
    const month = document.getElementById('monthFilter').value;

    // Reset filter lokal
    ['filterKapal','filterJenisKapal','filterPerusahaan','filterPetugas','filterLokasi'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    _initFilterTanggalBounds();

    // Update navbar info
    const portInfo = PORT_LIST.find(p => p.kode_pelabuhan === portCode);
    const monthNames = ['','Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
    document.getElementById('displayPort').textContent = portInfo ? portInfo.nama_pelabuhan : portCode;
    document.getElementById('displayPeriod').textContent = `${monthNames[parseInt(month)]} ${year}`;

    // Loading state
    const btn = document.getElementById('refreshBtn');
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Memuat...';
    lucide.createIcons({ nodes: [btn] });

    document.getElementById('tableBody').innerHTML = `
        <tr><td colspan="6" class="px-6 py-12 text-center">
            <div class="flex flex-col items-center gap-3 text-slate-400">
                <svg class="animate-spin w-8 h-8 text-blue-500" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                </svg>
                <span class="font-medium">Mengambil data dari server...</span>
            </div>
        </td></tr>`;

    try {
        const strategy = APP_CONFIG.FETCH_STRATEGY || 'live_first';
        const url = `${GAS_WEB_APP_URL}?portCode=${encodeURIComponent(portCode)}&year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}&strategy=${encodeURIComponent(strategy)}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();

        if (result.status === 'error') throw new Error(result.message);

        // Kasus no_cache: belum ada data sama sekali di spreadsheet
        if (result.status === 'empty') {
            document.getElementById('tableBody').innerHTML =
                `<tr><td colspan="6" class="px-6 py-10 text-center">
                    <div class="flex flex-col items-center gap-2 text-amber-500">
                        <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                        <span class="font-semibold text-slate-700">Belum ada data</span>
                        <span class="text-xs text-slate-400">${escHTML(result.message || 'Jalankan manualFetch() di Google Apps Script terlebih dahulu.')}</span>
                    </div>
                </td></tr>`;
            ['dataSourceBadge','dataSourceBadgeMobile'].forEach(id => {
                const el = document.getElementById(id);
                if (el) { el.textContent = '❌ Kosong'; el.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full border bg-rose-50 text-rose-700 border-rose-300'; el.classList.remove('hidden'); }
            });
            Swal.fire({ icon: 'warning', title: 'Belum ada data cache', text: result.message, confirmButtonText: 'Mengerti' });
            return;
        }

        // Normalise data structure — GAS bisa return { data: [...] } atau [...] langsung
        let rawData = result.data;
        if (rawData && !Array.isArray(rawData) && Array.isArray(rawData.data)) {
            rawData = rawData.data;
        }
        if (!Array.isArray(rawData)) throw new Error('Format data tidak dikenali dari server.');

        // Tambah _uid unik ke setiap item
        currentData = rawData.map((item, idx) => ({ ...item, _uid: `uid_${idx}_${Date.now()}` }));

        // Update timestamp — gunakan fetched_at dari backend/cache, bukan waktu browser
        const _formatFetchedAt = (raw) => {
            if (!raw || raw === '-') return '-';
            const s = String(raw).trim();
            // Cek apakah ada komponen waktu (HH:mm)
            const hasTime = /\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}/.test(s);
            if (hasTime) {
                // Ada jam & menit — format lengkap: "17 Maret 2026 14:35"
                return window.formatTanggalIndo(s);
            } else {
                // Hanya tanggal — format: "17 Maret 2026"
                const parts = s.substring(0, 10).split('-');
                if (parts.length === 3) {
                    const months = ['','Januari','Februari','Maret','April','Mei','Juni',
                                    'Juli','Agustus','September','Oktober','November','Desember'];
                    return `${parseInt(parts[2])} ${months[parseInt(parts[1])]} ${parts[0]}`;
                }
                return s.substring(0, 10);
            }
        };
        const fetchedAt = _formatFetchedAt(result.fetched_at);
        document.getElementById('lastUpdated').textContent = fetchedAt;
        const mobile = document.getElementById('lastUpdatedMobile');
        if (mobile) mobile.textContent = fetchedAt;

        // Bangun datalist filter lokal dari data
        buildFilterDatalist(currentData);

        // Render
        processDataAndRender(currentData);
        _initFilterTanggalBounds();

        // ── Badge sumber data permanen ──
        const srcMap = {
            'cache_hari_ini': { label: 'Cache',    cls: 'bg-slate-100 text-slate-600 border-slate-300',       icon: '📦', desc: 'Data dari cache hari ini' },
            'cache_testing':  { label: 'Testing',  cls: 'bg-purple-50 text-purple-700 border-purple-300',     icon: '🧪', desc: 'Mode testing — data dari cache' },
            'live_fetch':     { label: 'Live',      cls: 'bg-emerald-50 text-emerald-700 border-emerald-300',  icon: '🌐', desc: 'Data baru dari server' },
            'stale_cache':    { label: 'Kemarin',   cls: 'bg-amber-50 text-amber-700 border-amber-300',        icon: '⚠️', desc: 'Fetch gagal — menampilkan data terakhir' },
            'fallback_cache': { label: 'Fallback',  cls: 'bg-amber-50 text-amber-700 border-amber-300',        icon: '⚠️', desc: 'Server gagal, pakai cache lama' },
            'no_cache':       { label: 'Error',     cls: 'bg-rose-50 text-rose-700 border-rose-300',           icon: '❌', desc: 'Fetch gagal dan tidak ada data cache' },
        };
        const src = srcMap[result.source] || { label: result.source || '?', cls: 'bg-slate-100 text-slate-500 border-slate-200', icon: 'ℹ️', desc: '' };

        ['dataSourceBadge', 'dataSourceBadgeMobile'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.textContent = `${src.icon} ${src.label}`;
                el.className = `text-[10px] font-bold px-2 py-0.5 rounded-full border ${src.cls}`;
                el.classList.remove('hidden');
                el.title = src.desc;
            }
        });

        // Toast — bedakan stale vs fresh
        if (result.source === 'stale_cache') {
            Swal.fire({
                toast: true, position: 'top-end', icon: 'warning',
                title: '⚠️ Menampilkan data terakhir',
                text: result.message || 'Fetch gagal, data kemarin ditampilkan.',
                showConfirmButton: false, timer: 5000
            });
        } else if (result.source === 'no_cache') {
            Swal.fire({
                icon: 'error',
                title: 'Belum ada data',
                text: result.message || 'Jalankan manualFetch() di editor Google Apps Script terlebih dahulu.',
                confirmButtonText: 'Mengerti'
            });
        } else {
            Swal.fire({
                toast: true, position: 'top-end', icon: 'success',
                title: `${src.icon} ${src.desc || src.label}`,
                showConfirmButton: false, timer: 2500
            });
        }

    } catch (error) {
        console.error('loadData error:', error);
        document.getElementById('tableBody').innerHTML = `
            <tr><td colspan="6" class="px-6 py-10 text-center">
                <div class="flex flex-col items-center gap-2 text-rose-500">
                    <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                    <span class="font-semibold">Gagal memuat data</span>
                    <span class="text-xs text-slate-400">${escHTML(error.message)}</span>
                </div>
            </td></tr>`;
        Swal.fire({ toast: true, position: 'top-end', icon: 'error', title: 'Gagal memuat data', text: error.message, showConfirmButton: false, timer: 4000 });
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="refresh-cw" class="w-4 h-4"></i> Memuat Data';
        lucide.createIcons({ nodes: [btn] });
    }
};

// ==========================================
// BANGUN DATALIST UNTUK FILTER LOKAL
// ==========================================
function buildFilterDatalist(data) {
    const kapalSet = new Set(), jenisKapalSet = new Set(), perusahaanSet = new Set(), petugasSet = new Set(), lokasiSet = new Set();
    data.forEach(item => {
        if (item.nama_kapal) kapalSet.add(item.nama_kapal);
        const jk = item.jenis_kapal_xls || item.tipe_kapal;
        if (jk && jk !== '-') jenisKapalSet.add(jk);
        const p = item.perusahaan || item.keagenan;
        if (p) perusahaanSet.add(p);
        if (item.spb_approve_fullname) petugasSet.add(item.spb_approve_fullname);
        if (item.lokasi_sandar) lokasiSet.add(item.lokasi_sandar);
        if (item.lokasi_tolak) lokasiSet.add(item.lokasi_tolak);
    });

    const fill = (id, set) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = [...set].sort().map(v => `<option value="${escHTML(v)}"></option>`).join('');
    };
    fill('listKapal', kapalSet);
    fill('listJenisKapal', jenisKapalSet);
    fill('listPerusahaan', perusahaanSet);
    fill('listPetugas', petugasSet);
    fill('listLokasi', lokasiSet);
}

// ==========================================
// RENDER DATA KE TABEL & CHART
// ==========================================
// processDataAndRender: dipanggil setelah loadData berhasil
// Saat load awal, stats + chart = currentData penuh, filter reset
function processDataAndRender(data) {
    updateSummaryCards(data);
    renderCharts(data);
    window._applyTableFilters();
}

// Helper: baca nilai penumpang dari berbagai kemungkinan nama field API Inaportnet
function getPaxNaik(item) {
    return parseInt(
        item.pax_naik ?? item.penumpang_naik ?? item.jml_penumpang_naik ??
        item.jumlah_penumpang_naik ?? item.pnp_naik ?? item.naik ?? 0
    ) || 0;
}
function getPaxTurun(item) {
    return parseInt(
        item.pax_turun ?? item.penumpang_turun ?? item.jml_penumpang_turun ??
        item.jumlah_penumpang_turun ?? item.pnp_turun ?? item.turun ?? 0
    ) || 0;
}
// Helper: baca ETA dari berbagai kemungkinan nama field
function getETA(item) {
    return item.eta ?? item.tgl_eta ?? item.tgl_tiba ?? item.waktu_tiba ??
           item.tiba_tanggal_xls ?? item.tgl_masuk ?? null;
}
// Helper: baca ETD
function getETD(item) {
    return item.etd ?? item.tgl_etd ?? item.tgl_berangkat ?? item.waktu_berangkat ??
           item.berangkat_tanggal_xls ?? item.tgl_keluar ?? null;
}

// Debug: log field keys dari item pertama agar mudah diagnosis
function logFieldKeys(data) {
    if (!data || data.length === 0) return;
    const keys = Object.keys(data[0]).filter(k => !k.startsWith('_'));
    console.groupCollapsed('[Inaportnet] Field keys dari data[0]');
    console.log(keys.join(', '));
    // Cari semua field yang namanya mengandung kata kunci
    const paxKeys = keys.filter(k => /pax|pnp|penumpang|naik|turun|pass/i.test(k));
    const etaKeys = keys.filter(k => /eta|tiba|masuk|arrive/i.test(k));
    console.log('Kandidat penumpang:', paxKeys);
    console.log('Kandidat ETA:', etaKeys);
    console.groupEnd();
}

// State kartu khusus — field aktif saat ini
// ==========================================
// FILTER PANEL — minimize/maximize
// ==========================================
let _filterPanelOpen = true;

window._toggleFilterPanel = function() {
    _filterPanelOpen = !_filterPanelOpen;
    const panel   = document.getElementById('filterPanel');
    const chevron = document.getElementById('filterChevron');
    if (panel)   panel.classList.toggle('hidden', !_filterPanelOpen);
    if (chevron) chevron.setAttribute('data-lucide', _filterPanelOpen ? 'chevron-up' : 'chevron-down');
    lucide.createIcons({ nodes: [document.getElementById('btnMinimizeFilter')] });
};

// ==========================================
// FILTER JENIS KHUSUS — tombol pill
// ==========================================
let _khususField = null; // null = semua

window._setKhususFilter = function(field, label) {
    _khususField = field;

    // Update tampilan tombol aktif
    document.querySelectorAll('[id^="khususBtn-"]').forEach(btn => {
        btn.className = 'text-[10px] font-semibold px-2 py-1 rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 transition-colors';
    });
    const activeId  = field ? `khususBtn-${field}` : 'khususBtn-semua';
    const activeBtn = document.getElementById(activeId);
    if (activeBtn) activeBtn.className = 'text-[10px] font-semibold px-2 py-1 rounded-md border border-blue-500 bg-blue-500 text-white transition-colors';

    // Update kartu summary label & ikon
    const labelEl = document.getElementById('khususLabel');
    const iconEl  = document.getElementById('khususIcon');
    // [FIX] Saat field null (Semua), label = 'Semua Jenis' dan ikon = 'ship'
    // Sebelumnya ikon 'ferris-wheel' yang tidak sesuai konteks
    if (labelEl) labelEl.textContent = label || 'Semua Jenis';
    if (iconEl) {
        const iconMap = {
            is_penyebrangan: 'ferry',
            is_minerba:      'hard-hat',
            is_docking:      'anchor',
            is_perintis:     'flag',
            lainnya:         'more-horizontal'
        };
        const iconName = field ? (iconMap[field] || 'ship') : 'ship';
        iconEl.innerHTML = `<i data-lucide="${iconName}" class="w-5 h-5"></i>`;
        lucide.createIcons({ nodes: [iconEl] });
    }

    window._applyTableFilters();
};

function updateSummaryCards(data) {
    window._lastSummaryData = data; // simpan untuk re-render saat ganti jenis
    logFieldKeys(data);
    document.getElementById('totalShips').textContent = data.length.toLocaleString('id-ID');
    const totalGT = data.reduce((sum, i) => sum + (parseInt(i.gt) || 0), 0);
    document.getElementById('totalGT').textContent = totalGT.toLocaleString('id-ID');

    // Hitung sesuai field yang sedang dipilih (null = semua → tampilkan total)
    const _ALL_FLAGS = ['is_penyebrangan','is_minerba','is_docking','is_perintis',
                        'is_tol_laut','is_kegiatan_tetap','is_fast_boat','is_non_niaga'];
    const _LAINNYA   = ['is_tol_laut','is_kegiatan_tetap','is_fast_boat','is_non_niaga'];
    const totalKhusus = _khususField === 'lainnya'
        ? data.filter(i => _LAINNYA.some(f=>i[f]==1||i[f]===true) || !_ALL_FLAGS.some(f=>i[f]==1||i[f]===true)).length
        : _khususField
            ? data.filter(i => i[_khususField] == 1 || i[_khususField] === true).length
            : data.length;  // [FIX] null = Semua → total semua kapal
    document.getElementById('totalKhusus').textContent = totalKhusus.toLocaleString('id-ID');

    const totalNaik = data.reduce((sum, i) => sum + getPaxNaik(i), 0);
    document.getElementById('totalPaxNaik').textContent = totalNaik.toLocaleString('id-ID');
    const totalTurun = data.reduce((sum, i) => sum + getPaxTurun(i), 0);
    document.getElementById('totalPaxTurun').textContent = totalTurun.toLocaleString('id-ID');
}

function renderTable(data) {
    const tbody = document.getElementById('tableBody');
    // Badge dihandle oleh _applyTableFilters, bukan di sini

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-10 text-center text-slate-400 font-medium">Tidak ada data yang cocok dengan filter.</td></tr>';
        return;
    }

    const flagMap = {
        'INDONESIA':'🇮🇩','SINGAPORE':'🇸🇬','MALAYSIA':'🇲🇾','PANAMA':'🇵🇦',
        'LIBERIA':'🇱🇷','MARSHALL ISLANDS':'🇲🇭','BAHAMAS':'🇧🇸',
        'HONG KONG':'🇭🇰','CHINA':'🇨🇳','JAPAN':'🇯🇵','PHILIPPINES':'🇵🇭',
        'THAILAND':'🇹🇭','VIETNAM':'🇻🇳','MYANMAR':'🇲🇲','CAMBODIA':'🇰🇭',
        'AUSTRALIA':'🇦🇺','INDIA':'🇮🇳','UNITED KINGDOM':'🇬🇧','USA':'🇺🇸',
        'GERMANY':'🇩🇪','NORWAY':'🇳🇴','NETHERLANDS':'🇳🇱','CYPRUS':'🇨🇾',
        'CAYMAN ISLANDS':'🇰🇾','ANTIGUA AND BARBUDA':'🇦🇬'
    };

    const dis = 'opacity-40 pointer-events-none';

    const pageSize  = parseInt(document.getElementById('rowLimitSelect')?.value || '20');
    const rowOffset = pageSize > 0 ? (_currentPage - 1) * pageSize : 0;

    tbody.innerHTML = data.map((item, idx) => {
        const rowNum = rowOffset + idx + 1;
        const namaKapal  = escHTML(item.nama_kapal);
        const perusahaan = escHTML(item.perusahaan || item.keagenan);
        const callsign   = escHTML(item.callsign || '');
        const imo        = escHTML(item.imo || '');
        const nakhoda    = escHTML(item.nakhoda || '');
        const gt         = parseInt(item.gt)  || 0;
        const dwt        = parseInt(item.dwt) || 0;
        const loa        = escHTML(item.loa   || '');
        const lebar      = escHTML(item.lebar || '');
        const drMax      = escHTML(item.dr_max_xls    || item.dr_max    || '');
        const drDepan    = escHTML(item.dr_depan_xls  || item.dr_depan  || '');
        const drTengah   = escHTML(item.dr_tengah_xls || item.dr_tengah || '');
        const drBlkg     = escHTML(item.dr_belakang_xls || item.dr_belakang || '');
        const jenisKapal = escHTML(item.jenis_kapal_xls || item.tipe_kapal || '');
        const benderaRaw = (item.bendera || '').trim();
        const bendera    = escHTML(benderaRaw);
        const flagEmoji  = flagMap[benderaRaw.toUpperCase()] || '🏳';
        const hasDraft   = drMax || drDepan;

        const asalTujuan   = `${escHTML(item.pelabuhan_asal || '-')} \u2192 ${escHTML(item.pelabuhan_tujuan || '-')}`;
        const trayek       = escHTML(item.trayek_datang || item.trayek_berangkat || '-');
        const voyIn        = escHTML(item.voy_in  || '');
        const voyOut       = escHTML(item.voy_out || '');
        const lokasiSandar = escHTML(item.lokasi_sandar || '');
        const lokasiTolak  = escHTML(item.lokasi_tolak  || '');

        const trayekLower = (item.trayek_datang || item.trayek_berangkat || '').toLowerCase();
        let trayekColor = 'bg-slate-100 text-slate-600';
        if      (trayekLower.includes('tidak tetap') || trayekLower.includes('tramper')) trayekColor = 'bg-amber-100 text-amber-700';
        else if (trayekLower.includes('tetap') && !trayekLower.includes('tidak'))        trayekColor = 'bg-emerald-100 text-emerald-700';
        else if (trayekLower.includes('luar negeri') || trayekLower.includes(' ln'))     trayekColor = 'bg-purple-100 text-purple-700';
        else if (trayekLower.includes('dalam negeri') || trayekLower.includes(' dn'))    trayekColor = 'bg-blue-100 text-blue-700';

        const eta = window.formatTanggalIndo(getETA(item));
        const etd = window.formatTanggalIndo(getETD(item));
        const paxTurun = getPaxTurun(item);
        const paxNaik  = getPaxNaik(item);

        const uid          = escHTML(item._uid);
        const noPkkRaw     = item.nomor_pkk || '';
        const noPkkEsc     = escHTML(noPkkRaw);
        const hasPkk       = !!noPkkRaw;
        const noLayananRaw = item.nomor_layanan_berangkat || item.nomor_layanan_datang || '';
        const hasLayanan   = !!noLayananRaw;
        const noLayananEnc = encodeURIComponent(noLayananRaw);
        const urlSPB      = hasLayanan ? `https://sps-inaportnet.dephub.go.id/index.php/builtin/manage/spb/cetak/${noLayananEnc}` : '#';
        const urlManifest = hasLayanan ? `https://sps-inaportnet.dephub.go.id/index.php/builtin/manage/spb/detail/${noLayananEnc}` : '#';
        const urlLK3 = hasPkk
            ? `https://simpadu-inaportnet.dephub.go.id/document/lk3/loadDocument/2?by=sps.nomor_pkk&keyword=${encodeURIComponent(noPkkRaw)}`
            : '#';
        const urlKru = hasPkk
            ? `https://sps-inaportnet.dephub.go.id/index.php/document/pelaut/loadDocument/2?by=sps.nomor_pkk&keyword=${encodeURIComponent(noPkkRaw)}`
            : '#';

        return `<tr class="hover:bg-slate-50/80 transition-colors border-b border-slate-100">

            <td class="px-3 py-3 text-center text-slate-400 text-xs align-top pt-4">${rowNum}</td>

            <td class="px-4 py-3 align-top" style="min-width:200px;max-width:260px">
                <div class="flex items-start gap-1.5">
                    <span class="text-sm leading-none mt-0.5 flex-shrink-0">${flagEmoji}</span>
                    <button onclick="window.openDetailModal('${uid}')" class="font-bold text-blue-700 hover:text-blue-900 text-sm leading-snug text-left hover:underline cursor-pointer transition-colors">${namaKapal}</button>
                </div>
                <div class="flex flex-wrap gap-1 mt-1.5">
                    ${gt > 0 ? `<span class="inline-flex items-center bg-indigo-50 text-indigo-700 border border-indigo-100 text-[10px] font-semibold px-1.5 py-0.5 rounded-full">${gt.toLocaleString('id-ID')} GT</span>` : ''}
                    ${dwt > 0 ? `<span class="inline-flex items-center bg-slate-100 text-slate-600 text-[10px] font-medium px-1.5 py-0.5 rounded-full">${dwt.toLocaleString('id-ID')} DWT</span>` : ''}
                    ${jenisKapal ? `<span class="inline-flex items-center bg-slate-100 text-slate-600 text-[10px] font-medium px-1.5 py-0.5 rounded-full">${jenisKapal}</span>` : ''}
                    ${bendera ? `<span class="inline-flex items-center bg-slate-100 text-slate-500 text-[10px] px-1.5 py-0.5 rounded-full">${bendera}</span>` : ''}
                </div>
                ${(loa || lebar || hasDraft) ? `
                <div class="mt-1.5 flex flex-wrap gap-x-3 gap-y-0 text-[10px] text-slate-500 leading-tight">
                    ${loa ? `<span>LOA <b class="text-slate-700">${loa}m</b></span>` : ''}
                    ${lebar ? `<span>L <b class="text-slate-700">${lebar}m</b></span>` : ''}
                    ${hasDraft ? `<span>Draft <b class="text-slate-700">${drDepan||'-'}/${drTengah||'-'}/${drMax||'-'}</b></span>` : ''}
                </div>` : ''}
                ${(callsign || imo) ? `<p class="mt-1 text-[10px] text-slate-400 font-mono leading-tight">${callsign}${callsign && imo ? ' \u00B7 ' : ''}${imo ? `IMO ${imo}` : ''}</p>` : ''}
                ${nakhoda ? `<p class="mt-1 text-[10px] text-slate-400 leading-tight">\u2693 <span class="text-slate-600">${nakhoda}</span></p>` : ''}
                <p class="mt-2 text-[10px] text-slate-400 leading-snug border-t border-slate-100 pt-1.5 whitespace-normal">${perusahaan || '-'}</p>
            </td>

            <td class="px-4 py-3 align-top col-rute" style="min-width:180px">
                <p class="text-[11px] font-semibold text-slate-800 leading-snug">${asalTujuan}</p>
                <span class="inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${trayekColor}">${trayek}</span>
                ${(voyIn || voyOut) ? `<p class="text-[10px] text-slate-400 mt-1">${voyIn ? `In: <span class="text-slate-600">${voyIn}</span>` : ''}${voyIn && voyOut ? ' / ' : ''}${voyOut ? `Out: <span class="text-slate-600">${voyOut}</span>` : ''}</p>` : ''}
                ${lokasiSandar ? `<p class="text-[10px] text-slate-500 mt-1 leading-tight">\u2693 ${lokasiSandar}</p>` : ''}
                ${lokasiTolak  ? `<p class="text-[10px] text-slate-500 leading-tight">\u26F5 ${lokasiTolak}</p>` : ''}
            </td>

            <td class="px-4 py-3 align-top col-jadwal" style="min-width:140px">
                <div class="space-y-1.5">
                    <div>
                        <span class="text-[9px] text-slate-400 uppercase font-semibold block mb-0.5">ETA</span>
                        <span class="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100 inline-block whitespace-nowrap">${eta}</span>
                    </div>
                    <div>
                        <span class="text-[9px] text-slate-400 uppercase font-semibold block mb-0.5">ETD</span>
                        <span class="text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100 inline-block whitespace-nowrap">${etd}</span>
                    </div>
                </div>
            </td>

            <td class="px-4 py-3 text-center align-top col-pax" style="min-width:90px">
                <div class="flex gap-2 justify-center mt-0.5">
                    <div>
                        <p class="text-[9px] text-rose-400 font-semibold uppercase">Turun</p>
                        <p class="text-sm font-bold text-rose-600">${paxTurun.toLocaleString('id-ID')}</p>
                    </div>
                    <div class="w-px bg-slate-200 self-stretch"></div>
                    <div>
                        <p class="text-[9px] text-emerald-400 font-semibold uppercase">Naik</p>
                        <p class="text-sm font-bold text-emerald-600">${paxNaik.toLocaleString('id-ID')}</p>
                    </div>
                </div>
            </td>

            <td class="px-2 py-3 align-top" style="min-width:130px">
                <div class="grid grid-cols-2 gap-1">
                    <!-- Baris 1: Detail — full width -->
                    <button onclick="window.openDetailModal('${uid}')"
                        class="col-span-2 inline-flex items-center justify-center gap-1.5 text-[10px] font-bold py-1.5 px-2 rounded-lg bg-blue-600 text-white border border-blue-700 hover:bg-blue-700 transition-colors shadow-sm">
                        <svg class="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        Detail
                    </button>
                    <!-- Baris 2: SPB | LK3 -->
                    <a href="${urlSPB}" target="_blank" rel="noopener noreferrer"
                        class="inline-flex items-center justify-center gap-1 text-[10px] font-bold py-1.5 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-600 hover:text-white hover:border-indigo-600 transition-colors ${!hasLayanan ? dis : ''}">
                        <svg class="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                        SPB
                    </a>
                    <a href="${urlLK3}" target="_blank" rel="noopener noreferrer"
                        class="inline-flex items-center justify-center gap-1 text-[10px] font-bold py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-600 hover:text-white hover:border-emerald-600 transition-colors ${!hasPkk ? dis : ''}">
                        <svg class="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
                        LK3
                    </a>
                    <!-- Baris 3: Kru | Manifest -->
                    <a href="${urlKru}" target="_blank" rel="noopener noreferrer"
                        class="inline-flex items-center justify-center gap-1 text-[10px] font-bold py-1.5 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-600 hover:text-white hover:border-amber-600 transition-colors ${!hasPkk ? dis : ''}">
                        <svg class="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                        Kru
                    </a>
                    <a href="${urlManifest}" target="_blank" rel="noopener noreferrer"
                        class="inline-flex items-center justify-center gap-1 text-[10px] font-bold py-1.5 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-600 hover:text-white hover:border-rose-600 transition-colors ${!hasLayanan ? dis : ''}">
                        <svg class="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                        Manifest
                    </a>
                </div>
            </td>
        </tr>`;
    }).join('');
}


function renderCharts(data) {
    // ---- Bar chart: ETA per hari ----
    const etaCount = {};
    let parsedCount = 0;
    data.forEach(item => {
        const etaStr = getETA(item);
        if (!etaStr || etaStr === '-') return;
        try {
            let s = String(etaStr).trim();
            // Format "DD-MM-YYYY HH:mm" dari XLS perlu dikonversi
            const dmyMatch = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
            if (dmyMatch) {
                s = `${dmyMatch[3]}-${dmyMatch[2].padStart(2,'0')}-${dmyMatch[1].padStart(2,'0')}`;
            } else if (s.includes(' ') && !s.includes('T')) {
                s = s.replace(' ', 'T');
            }
            const d = new Date(s);
            if (!isNaN(d.getTime())) {
                const key = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
                etaCount[key] = (etaCount[key] || 0) + 1;
                parsedCount++;
            }
        } catch(e) {}
    });

    const sortedEta = Object.entries(etaCount).sort((a, b) => {
        const [da, ma] = a[0].split('/').map(Number);
        const [db, mb] = b[0].split('/').map(Number);
        return (ma * 100 + da) - (mb * 100 + db);
    });

    // Jika tidak ada ETA yang bisa di-parse, tampilkan distribusi per-trayek sebagai bar chart
    const useTrayek = parsedCount === 0;
    let barLabels, barValues, barTitle;
    if (useTrayek) {
        const tc = {};
        data.forEach(i => {
            const t = i.trayek_datang || i.trayek_berangkat || 'Tidak Diketahui';
            tc[t] = (tc[t] || 0) + 1;
        });
        const entries = Object.entries(tc).sort((a,b) => b[1]-a[1]).slice(0, 15);
        barLabels = entries.map(e => e[0]);
        barValues = entries.map(e => e[1]);
        barTitle  = 'Distribusi per Trayek';
    } else {
        barLabels = sortedEta.map(e => e[0]);
        barValues = sortedEta.map(e => e[1]);
        barTitle  = 'Kedatangan Kapal (ETA) per Hari';
    }

    // Update judul chart
    const chartTitle = document.querySelector('h2.text-base.sm\\:text-lg.font-bold.text-slate-800');
    // (judul via elemen langsung lebih aman — skip)

    // Juga hitung ETD per hari untuk chart kedatangan/keberangkatan
    const etdCount = {};
    if (!useTrayek) {
        data.forEach(item => {
            const etdStr = getETD(item);
            if (!etdStr || etdStr === '-') return;
            try {
                let s = String(etdStr).trim();
                const dmyMatch = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
                if (dmyMatch) s = `${dmyMatch[3]}-${dmyMatch[2].padStart(2,'0')}-${dmyMatch[1].padStart(2,'0')}`;
                else if (s.includes(' ') && !s.includes('T')) s = s.replace(' ','T');
                const d = new Date(s);
                if (!isNaN(d.getTime())) {
                    const key = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
                    etdCount[key] = (etdCount[key] || 0) + 1;
                }
            } catch(e) {}
        });
    }
    // Gabungkan label dari ETA + ETD
    const allDaysSet = new Set([...barLabels, ...Object.keys(etdCount)]);
    const allDays = [...allDaysSet].sort((a,b) => {
        const [da,ma]=a.split('/').map(Number), [db,mb]=b.split('/').map(Number);
        return (ma*100+da)-(mb*100+db);
    });
    const etaCtx = document.getElementById('etaChart').getContext('2d');
    if (etaChartInst) etaChartInst.destroy();
    etaChartInst = new Chart(etaCtx, {
        type: 'bar',
        data: {
            labels: useTrayek ? barLabels : allDays,
            datasets: useTrayek ? [{
                label: 'Kapal', data: barValues,
                backgroundColor: 'rgba(59,130,246,0.7)', borderColor: 'rgba(37,99,235,0.9)',
                borderWidth: 1.5, borderRadius: 4
            }] : [
                { label: 'Kedatangan (ETA)', data: allDays.map(k => etaCount[k] || 0), backgroundColor: 'rgba(59,130,246,0.7)', borderColor: 'rgba(37,99,235,0.9)', borderWidth: 1.5, borderRadius: 3 },
                { label: 'Keberangkatan (ETD)', data: allDays.map(k => etdCount[k] || 0), backgroundColor: 'rgba(245,158,11,0.65)', borderColor: 'rgba(217,119,6,0.9)', borderWidth: 1.5, borderRadius: 3 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: !useTrayek, position: 'top', labels: { font: { size: 10 }, boxWidth: 12, padding: 8 } },
                title: { display: useTrayek, text: barTitle, font: { size: 12 } }
            },
            scales: {
                y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 10 } } },
                x: { ticks: { font: { size: 10 }, maxRotation: 45 } }
            }
        }
    });

    // ---- Doughnut chart: distribusi trayek ----
    const trayekCount = {};
    data.forEach(item => {
        const t = item.trayek_datang || item.trayek_berangkat || 'Tidak Diketahui';
        trayekCount[t] = (trayekCount[t] || 0) + 1;
    });

    const trayekEntries = Object.entries(trayekCount).sort((a,b) => b[1]-a[1]).slice(0, 8);
    const trayekColors = ['#3b82f6','#6366f1','#8b5cf6','#a78bfa','#06b6d4','#14b8a6','#f59e0b','#f97316'];

    const trayekCtx = document.getElementById('trayekChart').getContext('2d');
    if (trayekChartInst) trayekChartInst.destroy();
    trayekChartInst = new Chart(trayekCtx, {
        type: 'doughnut',
        data: {
            labels: trayekEntries.map(e => e[0]),
            datasets: [{ data: trayekEntries.map(e => e[1]), backgroundColor: trayekColors, borderWidth: 2 }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { font: { size: 10 }, boxWidth: 12, padding: 8 } }
            }
        }
    });

    // ---- Bar chart: penumpang naik & turun per hari ----
    const paxByDay = {};
    data.forEach(item => {
        const etaStr = getETA(item) || getETD(item);
        if (!etaStr || etaStr === '-') return;
        try {
            let s = String(etaStr).trim();
            const dmyMatch = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
            if (dmyMatch) s = `${dmyMatch[3]}-${dmyMatch[2].padStart(2,'0')}-${dmyMatch[1].padStart(2,'0')}`;
            else if (s.includes(' ') && !s.includes('T')) s = s.replace(' ','T');
            const d = new Date(s);
            if (isNaN(d.getTime())) return;
            const key = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
            if (!paxByDay[key]) paxByDay[key] = { naik: 0, turun: 0 };
            paxByDay[key].naik  += getPaxNaik(item);
            paxByDay[key].turun += getPaxTurun(item);
        } catch(e) {}
    });
    const paxDays = Object.keys(paxByDay).sort((a,b) => {
        const [da,ma] = a.split('/').map(Number), [db,mb] = b.split('/').map(Number);
        return (ma*100+da)-(mb*100+db);
    });
    const paxCtx = document.getElementById('paxChart').getContext('2d');
    if (paxChartInst) paxChartInst.destroy();
    paxChartInst = new Chart(paxCtx, {
        type: 'bar',
        data: {
            labels: paxDays,
            datasets: [
                { label: 'Naik',  data: paxDays.map(k => paxByDay[k].naik),  backgroundColor: 'rgba(16,185,129,0.7)',  borderColor: 'rgba(5,150,105,0.9)',  borderWidth: 1.5, borderRadius: 3 },
                { label: 'Turun', data: paxDays.map(k => paxByDay[k].turun), backgroundColor: 'rgba(239,68,68,0.65)',  borderColor: 'rgba(220,38,38,0.9)',  borderWidth: 1.5, borderRadius: 3 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { font: { size: 10 }, boxWidth: 12, padding: 8 } } },
            scales: {
                y: { beginAtZero: true, stacked: false, ticks: { stepSize: 1, font: { size: 10 } } },
                x: { ticks: { font: { size: 10 }, maxRotation: 45 } }
            }
        }
    });

    // ---- Doughnut: top jenis kapal ----
    const jenisCount = {};
    data.forEach(item => {
        const jk = (item.jenis_kapal_xls || item.tipe_kapal || 'Tidak Diketahui').trim();
        if (jk && jk !== '-') jenisCount[jk] = (jenisCount[jk] || 0) + 1;
    });
    const jenisEntries = Object.entries(jenisCount).sort((a,b)=>b[1]-a[1]).slice(0,8);
    const jenisColors = ['#0ea5e9','#6366f1','#f59e0b','#10b981','#f97316','#8b5cf6','#14b8a6','#ec4899'];
    const jenisCtx = document.getElementById('jenisChart').getContext('2d');
    if (jenisChartInst) jenisChartInst.destroy();
    jenisChartInst = new Chart(jenisCtx, {
        type: 'doughnut',
        data: {
            labels: jenisEntries.map(e => e[0]),
            datasets: [{ data: jenisEntries.map(e => e[1]), backgroundColor: jenisColors, borderWidth: 2 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { font: { size: 10 }, boxWidth: 10, padding: 6 } } }
        }
    });
}

// ==========================================
// FILTER + PAGINATION — hanya mempengaruhi TABEL
// Statistik, chart, summary cards tidak berubah
// ==========================================
let _filterDebounceTimer = null;
let _currentPage    = 1;   // halaman aktif
let _filteredData   = [];  // data setelah filter (sebelum paginate)

window._debounceFilter = function() {
    clearTimeout(_filterDebounceTimer);
    _filterDebounceTimer = setTimeout(window._applyTableFilters, 250);
};

// Tutup col toggle menu saat klik di luar
document.addEventListener('click', function(e) {
    const wrapper = document.getElementById('colToggleWrapper');
    const menu    = document.getElementById('colToggleMenu');
    if (wrapper && menu && !wrapper.contains(e.target)) {
        menu.classList.add('hidden');
    }
});

// Toggle kolom 3-5 (rute, jadwal, penumpang)
window._toggleCol = function(col) {
    const show = document.getElementById('col-' + col).checked;
    document.querySelectorAll('.col-' + col).forEach(el => {
        el.style.display = show ? '' : 'none';
    });
};

// Render bar pagination
function renderPagination(totalItems, pageSize, currentPage) {
    const bar  = document.getElementById('paginationBar');
    const info = document.getElementById('paginationInfo');
    const btns = document.getElementById('paginationBtns');
    if (!bar || !info || !btns) return;

    // Jika "Semua" (pageSize=0) atau hanya 1 halaman, sembunyikan
    if (pageSize === 0 || totalItems <= pageSize) {
        bar.classList.add('hidden');
        return;
    }

    const totalPages = Math.ceil(totalItems / pageSize);
    const from = (currentPage - 1) * pageSize + 1;
    const to   = Math.min(currentPage * pageSize, totalItems);

    bar.classList.remove('hidden');
    info.textContent = `Menampilkan ${from}–${to} dari ${totalItems} kapal`;

    // Bangun tombol halaman
    const btnCls = (active) =>
        `inline-flex items-center justify-center w-7 h-7 text-xs font-semibold rounded-md border transition-colors cursor-pointer select-none ` +
        (active
            ? 'bg-blue-600 text-white border-blue-600'
            : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50');

    let html = '';

    // Tombol ← Prev
    html += `<button onclick="window._goToPage(${currentPage - 1})"
        class="${btnCls(false)} ${currentPage === 1 ? 'opacity-40 pointer-events-none' : ''}">
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
    </button>`;

    // Nomor halaman — tampilkan max 7 tombol dengan ellipsis
    const pages = buildPageRange(currentPage, totalPages);
    pages.forEach(p => {
        if (p === '...') {
            html += `<span class="inline-flex items-center justify-center w-7 h-7 text-xs text-slate-400">…</span>`;
        } else {
            html += `<button onclick="window._goToPage(${p})" class="${btnCls(p === currentPage)}">${p}</button>`;
        }
    });

    // Tombol Next →
    html += `<button onclick="window._goToPage(${currentPage + 1})"
        class="${btnCls(false)} ${currentPage === totalPages ? 'opacity-40 pointer-events-none' : ''}">
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
    </button>`;

    btns.innerHTML = html;
}

// Bangun array nomor halaman dengan ellipsis
function buildPageRange(current, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const pages = [];
    if (current <= 4) {
        for (let i = 1; i <= 5; i++) pages.push(i);
        pages.push('...'); pages.push(total);
    } else if (current >= total - 3) {
        pages.push(1); pages.push('...');
        for (let i = total - 4; i <= total; i++) pages.push(i);
    } else {
        pages.push(1); pages.push('...');
        for (let i = current - 1; i <= current + 1; i++) pages.push(i);
        pages.push('...'); pages.push(total);
    }
    return pages;
}

// Pindah ke halaman tertentu
window._goToPage = function(page) {
    const pageSize  = parseInt(document.getElementById('rowLimitSelect')?.value || '20');
    if (pageSize === 0) return;
    const totalPages = Math.ceil(_filteredData.length / pageSize);
    if (page < 1 || page > totalPages) return;
    _currentPage = page;
    const sliced = _filteredData.slice((page - 1) * pageSize, page * pageSize);
    renderTable(sliced);
    renderPagination(_filteredData.length, pageSize, _currentPage);
    // Scroll ke atas tabel
    document.getElementById('mainTable')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

// Terapkan filter → reset ke halaman 1 → paginate → render
// Terapkan filter → reset ke halaman 1 → update chart+stats → paginate → render
// ==========================================
// FILTER TANGGAL — helper & reset
// ==========================================

// Parse berbagai format tanggal ke string 'YYYY-MM-DD' untuk perbandingan
function _parseDateToYMD(raw) {
    if (!raw || raw === '-') return null;
    const s = String(raw).trim();
    // Format "DD-MM-YYYY HH:mm:ss" atau "DD-MM-YYYY"
    const dmy = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
    // Format "YYYY-MM-DD" (sudah benar)
    const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
    // Coba Date
    try {
        const d = new Date(s);
        if (!isNaN(d.getTime())) return d.toISOString().slice(0,10);
    } catch(e) {}
    return null;
}

// Set batas min/max date picker sesuai bulan data yang dimuat
function _initFilterTanggalBounds() {
    const year  = document.getElementById('yearFilter')?.value;
    const month = document.getElementById('monthFilter')?.value;
    if (!year || !month) return;

    const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
    const minDate = `${year}-${month}-01`;
    const maxDate = `${year}-${month}-${String(lastDay).padStart(2,'0')}`;

    const dari   = document.getElementById('filterTglDari');
    const sampai = document.getElementById('filterTglSampai');
    if (dari)   { dari.min   = minDate; dari.max   = maxDate; dari.value   = ''; }
    if (sampai) { sampai.min = minDate; sampai.max = maxDate; sampai.value = ''; }

    const btnReset = document.getElementById('btnResetTgl');
    const info     = document.getElementById('filterTglInfo');
    if (btnReset) btnReset.classList.add('hidden');
    if (info)     info.classList.add('hidden');
}

window._resetFilterTanggal = function() {
    const dari   = document.getElementById('filterTglDari');
    const sampai = document.getElementById('filterTglSampai');
    if (dari)   dari.value   = '';
    if (sampai) sampai.value = '';
    document.getElementById('btnResetTgl')?.classList.add('hidden');
    document.getElementById('filterTglInfo')?.classList.add('hidden');
    window._applyTableFilters();
};

window._applyTableFilters = function() {
    const kw = id => (document.getElementById(id)?.value || '').toLowerCase().trim();
    const kwKapal       = kw('filterKapal');
    const kwJenisKapal  = kw('filterJenisKapal');
    const kwPerusahaan  = kw('filterPerusahaan');
    const kwPetugas     = kw('filterPetugas');
    const kwLokasi      = kw('filterLokasi');
    const tglDari       = document.getElementById('filterTglDari')?.value   || '';
    const tglSampai     = document.getElementById('filterTglSampai')?.value || '';
    const pageSize      = parseInt(document.getElementById('rowLimitSelect')?.value || '20');

    // Filter
    _filteredData = currentData.filter(item => {
        if (kwKapal      && !(item.nama_kapal || '').toLowerCase().includes(kwKapal))                              return false;
        if (kwJenisKapal && !((item.jenis_kapal_xls || item.tipe_kapal || '')).toLowerCase().includes(kwJenisKapal)) return false;
        if (kwPerusahaan && !(item.perusahaan || item.keagenan || '').toLowerCase().includes(kwPerusahaan))        return false;
        if (kwPetugas    && !(item.spb_approve_fullname || '').toLowerCase().includes(kwPetugas))                  return false;
        if (kwLokasi) {
            const lok = ((item.lokasi_sandar||'') + ' ' + (item.lokasi_tolak||'')).toLowerCase();
            if (!lok.includes(kwLokasi)) return false;
        }
        // Filter tanggal — hanya berdasarkan ETD (tanggal keberangkatan)
        if (tglDari || tglSampai) {
            const etdYMD = _parseDateToYMD(getETD(item));
            const inRange = (ymd) => {
                if (!ymd) return false;
                if (tglDari   && ymd < tglDari)   return false;
                if (tglSampai && ymd > tglSampai) return false;
                return true;
            };
            if (!inRange(etdYMD)) return false;
        }
        // Filter jenis khusus (is_penyebrangan, is_minerba, dll)
        if (_khususField) {
            const _ALL_FLAGS = ['is_penyebrangan','is_minerba','is_docking','is_perintis',
                                'is_tol_laut','is_kegiatan_tetap','is_fast_boat','is_non_niaga'];
            if (_khususField === 'lainnya') {
                // Lolos jika: salah satu dari 4 flag lainnya ATAU tidak punya flag apapun
                const _LAINNYA_FLAGS = ['is_tol_laut','is_kegiatan_tetap','is_fast_boat','is_non_niaga'];
                const hasLainnya = _LAINNYA_FLAGS.some(f => item[f] == 1 || item[f] === true);
                const hasNone    = !_ALL_FLAGS.some(f => item[f] == 1 || item[f] === true);
                if (!hasLainnya && !hasNone) return false;
            } else {
                if (!(item[_khususField] == 1 || item[_khususField] === true)) return false;
            }
        }
        return true;
    });

    // Reset ke halaman 1
    _currentPage = 1;

    // Update info & tombol reset filter tanggal
    const btnReset = document.getElementById('btnResetTgl');
    const info     = document.getElementById('filterTglInfo');
    if (tglDari || tglSampai) {
        if (btnReset) btnReset.classList.remove('hidden');
        if (info) {
            const fmt = d => d ? d.split('-').reverse().join('/') : '?';
            info.textContent = tglDari && tglSampai
                ? `${fmt(tglDari)} – ${fmt(tglSampai)}`
                : tglDari ? `≥ ${fmt(tglDari)}` : `≤ ${fmt(tglSampai)}`;
            info.classList.remove('hidden');
        }
    } else {
        if (btnReset) btnReset.classList.add('hidden');
        if (info)     info.classList.add('hidden');
    }

    // Update summary cards dan chart sesuai data yang difilter
    const filterActive = kwKapal || kwJenisKapal || kwPerusahaan || kwPetugas || kwLokasi || tglDari || tglSampai;
    updateSummaryCards(_filteredData);
    renderCharts(_filteredData);
    window._switchChart(_activeChart);

    // Potong sesuai halaman
    const sliced = (pageSize > 0) ? _filteredData.slice(0, pageSize) : _filteredData;

    // Update badge
    const badge = document.getElementById('tableRecordCount');
    if (badge) {
        badge.textContent = filterActive
            ? `${_filteredData.length} / ${currentData.length} Kapal (filter)`
            : `${_filteredData.length} Kapal`;
    }

    renderTable(sliced);
    renderPagination(_filteredData.length, pageSize, _currentPage);
};

// Alias lama
window.filterDashboardData = window._applyTableFilters;

// ==========================================
// MODAL DETAIL — FIX XSS: semua data di-escape
// ==========================================
window.openDetailModal = function(uid) {
    const item = currentData.find(x => x._uid === uid);
    if (!item) return;

    const noLayananRaw = item.nomor_layanan_berangkat || item.nomor_layanan_datang || '';
    const noPkkRaw     = item.nomor_pkk || '';
    const noLayanan    = escHTML(noLayananRaw);
    const noPkk        = escHTML(noPkkRaw);
    const namaKapal    = escHTML(item.nama_kapal || 'Kapal');

    const urlSPB      = noLayananRaw ? `https://sps-inaportnet.dephub.go.id/index.php/builtin/manage/spb/cetak/${noLayanan}` : '#';
    const urlManifest = noLayananRaw ? `https://sps-inaportnet.dephub.go.id/index.php/builtin/manage/spb/detail/${noLayanan}` : '#';
    const urlLK3      = noPkkRaw    ? `https://simpadu-inaportnet.dephub.go.id/document/lk3/loadDocument/2?by=sps.nomor_pkk&keyword=${encodeURIComponent(noPkkRaw)}` : '#';
    const urlKru      = noPkkRaw    ? `https://sps-inaportnet.dephub.go.id/index.php/document/pelaut/loadDocument/2?by=sps.nomor_pkk&keyword=${encodeURIComponent(noPkkRaw)}` : '#';
    const urlDetail   = noPkkRaw    ? `https://monitoring-inaportnet.dephub.go.id/monitoring/detail?nomor_pkk=${encodeURIComponent(noPkkRaw)}` : '#';

    const dis    = 'opacity-40 pointer-events-none cursor-not-allowed';
    const aktif  = (kondisi) => kondisi ? '' : dis;

    // Helper tombol — ukuran penuh, ikon + label, dengan warna hover solid
    const btn = (url, kondisi, icon, label, colorBase, colorHover) =>
        `<a href="${url}" target="_blank" rel="noopener noreferrer"
            class="flex items-center justify-center gap-2 py-2 px-3 rounded-xl border font-semibold text-xs transition-all duration-150 select-none
                   ${colorBase} ${kondisi ? `hover:${colorHover} hover:text-white hover:border-transparent hover:shadow-md` : dis}">
            <i data-lucide="${icon}" class="w-3.5 h-3.5 flex-shrink-0"></i>
            <span>${label}</span>
        </a>`;

    // ── Update header judul + tombol aksi ──
    const titleEl = document.getElementById('modalTitle');
    if (titleEl) titleEl.querySelector('span').textContent = `Informasi ${item.nama_kapal || 'Kapal'}`;

    const actionsEl = document.getElementById('modalActions');
    if (actionsEl) actionsEl.innerHTML = `
        <!-- Baris 1: Detail — full width -->
        <div class="col-span-2">
            ${btn(urlDetail, !!noPkkRaw, 'external-link', 'Lihat Detail di Monitoring Inaportnet', 'bg-blue-50 text-blue-700 border-blue-200', 'bg-blue-600')}
        </div>
        <!-- Baris 2: SPB | LK3 -->
        ${btn(urlSPB,  !!noLayananRaw, 'file-text',  'SPB',  'bg-indigo-50 text-indigo-700 border-indigo-200', 'bg-indigo-600')}
        ${btn(urlLK3,  !!noPkkRaw,     'anchor',      'LK3',  'bg-emerald-50 text-emerald-700 border-emerald-200', 'bg-emerald-600')}
        <!-- Baris 3: Kru | Manifest -->
        ${btn(urlKru,      !!noPkkRaw,     'users',       'Kru',      'bg-amber-50 text-amber-700 border-amber-200', 'bg-amber-600')}
        ${btn(urlManifest, !!noLayananRaw, 'clipboard-list', 'Manifest', 'bg-rose-50 text-rose-700 border-rose-200', 'bg-rose-600')}`;

    // ── Render bongkar muat ──
    const renderBongkarMuat = (items, warna) => {
        if (!items || items.length === 0) {
            return `<p class="text-[10px] text-slate-400 italic py-2 text-center">Tidak ada data</p>`;
        }
        // Saring item yang punya komoditi valid (bukan kosong/spasi)
        const validItems = items.filter(b => b && b.komoditi && String(b.komoditi).trim() !== '' && String(b.komoditi).trim() !== '-');
        if (validItems.length === 0) {
            return `<p class="text-[10px] text-slate-400 italic py-2 text-center">Tidak ada data</p>`;
        }
        const val = v => {
            const s = String(v || '').trim();
            return (s === '' || s === '-' || s === ' ') ? '0' : s;
        };
        return validItems.map(b => `
            <div class="bg-slate-50 p-2 rounded border border-slate-100">
                <p class="font-semibold text-slate-800 text-[10px] leading-tight">${escHTML(String(b.komoditi).trim())} <span class="font-normal text-slate-400">(${escHTML(String(b.jenis || '').trim())})</span></p>
                <div class="grid grid-cols-4 gap-0.5 text-center mt-1 pt-1 border-t border-slate-200">
                    <div><p class="text-[8px] text-slate-400">TON</p><p class="text-[10px] font-bold text-${warna}-600">${escHTML(val(b.ton))}</p></div>
                    <div><p class="text-[8px] text-slate-400">M3</p><p class="text-[10px] font-bold text-${warna}-600">${escHTML(val(b.m3))}</p></div>
                    <div><p class="text-[8px] text-slate-400">UNIT</p><p class="text-[10px] font-bold text-${warna}-600">${escHTML(val(b.unit))}</p></div>
                    <div><p class="text-[8px] text-slate-400">ORG</p><p class="text-[10px] font-bold text-${warna}-600">${escHTML(val(b.orang))}</p></div>
                </div>
            </div>`).join('');
    };

    // Helpers lokal
    const fTgl  = window.formatTanggalIndo;
    const fUang = window.formatUang;
    const sTag  = window.statusTag;
    const e     = escHTML;

    const contentHtml = `
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">

            <!-- ① Identitas + Spesifikasi + Nakhoda/Awak — gabung, full width -->
            <div class="lg:col-span-3 bg-slate-50 rounded-xl border border-slate-200 p-3">
                <div class="flex flex-wrap gap-3">

                    <!-- Kiri: Identitas -->
                    <div class="flex-1 min-w-[180px]">
                        <p class="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Identitas</p>
                        <p class="font-bold text-slate-900 text-sm leading-tight">${e(item.nama_kapal)}</p>
                        <p class="text-[11px] text-slate-500 mt-0.5 leading-tight">${e(item.perusahaan || item.keagenan)}</p>
                        <div class="flex flex-wrap gap-1 mt-1.5">
                            ${item.jenis_kapal_xls || item.tipe_kapal ? `<span class="bg-slate-100 text-slate-600 text-[9px] px-1.5 py-0.5 rounded-full">${e(item.jenis_kapal_xls || item.tipe_kapal)}</span>` : ''}
                            ${item.bendera ? `<span class="bg-slate-100 text-slate-600 text-[9px] px-1.5 py-0.5 rounded-full">${e(item.bendera)}</span>` : ''}
                            ${item.callsign ? `<span class="bg-slate-100 text-slate-500 text-[9px] font-mono px-1.5 py-0.5 rounded-full">${e(item.callsign)}</span>` : ''}
                            ${item.imo ? `<span class="bg-slate-100 text-slate-500 text-[9px] font-mono px-1.5 py-0.5 rounded-full">IMO ${e(item.imo)}</span>` : ''}
                        </div>
                    </div>

                    <!-- Tengah: Spesifikasi -->
                    <div class="flex-1 min-w-[160px]">
                        <p class="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Spesifikasi</p>
                        <div class="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px]">
                            ${item.gt ? `<span class="text-slate-500">GT <b class="text-slate-800">${e(item.gt)}</b></span>` : ''}
                            ${item.dwt ? `<span class="text-slate-500">DWT <b class="text-slate-800">${e(item.dwt)}</b></span>` : ''}
                            ${item.loa ? `<span class="text-slate-500">LOA <b class="text-slate-800">${e(item.loa)}m</b></span>` : ''}
                            ${item.lebar ? `<span class="text-slate-500">Lebar <b class="text-slate-800">${e(item.lebar)}m</b></span>` : ''}
                        </div>
                        <div class="grid grid-cols-4 gap-1 mt-2 text-center">
                            <div class="bg-white rounded border border-slate-200 py-1 px-0.5"><p class="text-[8px] text-slate-400">MAX</p><p class="text-[9px] font-bold text-slate-700">${e(item.dr_max_xls||item.dr_max||'-')}</p></div>
                            <div class="bg-white rounded border border-slate-200 py-1 px-0.5"><p class="text-[8px] text-slate-400">DP</p><p class="text-[9px] font-bold text-slate-700">${e(item.dr_depan_xls||item.dr_depan||'-')}</p></div>
                            <div class="bg-white rounded border border-slate-200 py-1 px-0.5"><p class="text-[8px] text-slate-400">TG</p><p class="text-[9px] font-bold text-slate-700">${e(item.dr_tengah_xls||item.dr_tengah||'-')}</p></div>
                            <div class="bg-white rounded border border-slate-200 py-1 px-0.5"><p class="text-[8px] text-slate-400">BK</p><p class="text-[9px] font-bold text-slate-700">${e(item.dr_belakang_xls||item.dr_belakang||'-')}</p></div>
                        </div>
                    </div>

                    <!-- Kanan: Nakhoda + Awak + Petugas -->
                    <div class="flex-1 min-w-[160px]">
                        <p class="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Awak & Petugas</p>
                        ${item.nakhoda ? `<div class="flex justify-between text-[10px] mb-1"><span class="text-slate-500">Nakhoda</span><span class="font-semibold text-slate-800 ml-2">${e(item.nakhoda)}</span></div>` : ''}
                        ${item.jumlah_awak ? `<div class="flex justify-between text-[10px] mb-1.5"><span class="text-slate-500">Jumlah Awak</span><span class="font-semibold text-slate-800">${e(item.jumlah_awak)} Orang</span></div>` : ''}
                        <div class="flex items-center gap-1.5 bg-blue-50 border border-blue-100 rounded-lg p-1.5 mt-1">
                            <div class="bg-blue-200 p-1 rounded-full flex-shrink-0"><svg class="w-2.5 h-2.5 text-blue-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>
                            <div class="min-w-0">
                                <p class="text-[9px] text-slate-400">Petugas SPB</p>
                                <p class="font-semibold text-slate-800 text-[10px] leading-tight truncate">${e(item.spb_approve_fullname || 'Menunggu Approval')}</p>
                                ${item.spb_approve_username ? `<p class="text-[9px] text-slate-400 font-mono">@${e(item.spb_approve_username)}</p>` : ''}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- ② Asal + ETA | Tujuan + ETD | Trayek — gabung rute dan waktu -->
            <div class="lg:col-span-2 bg-slate-50 rounded-xl border border-slate-200 p-3">
                <p class="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-2">Rute & Jadwal</p>

                <!-- Kartu Asal/Tujuan -->
                <div class="grid grid-cols-2 gap-2 mb-2">
                    <!-- Asal + ETA -->
                    <div class="bg-white rounded-lg border border-emerald-100 p-2">
                        <p class="text-[9px] text-slate-400 uppercase font-semibold mb-0.5">Asal · ETA</p>
                        <p class="font-bold text-slate-900 text-[11px] leading-tight">${e(item.pelabuhan_asal || '-')}</p>
                        <span class="inline-block mt-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full border border-emerald-100">${fTgl(item.eta || item.tgl_eta)}</span>
                        ${item.lokasi_sandar ? `<p class="text-[9px] text-slate-400 mt-1 leading-tight">⚓ ${e(item.lokasi_sandar)}</p>` : ''}
                    </div>
                    <!-- Tujuan + ETD -->
                    <div class="bg-white rounded-lg border border-amber-100 p-2">
                        <p class="text-[9px] text-slate-400 uppercase font-semibold mb-0.5">Tujuan · ETD</p>
                        <p class="font-bold text-slate-900 text-[11px] leading-tight">${e(item.pelabuhan_tujuan || '-')}</p>
                        <span class="inline-block mt-1 text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full border border-amber-100">${fTgl(item.etd || item.tgl_etd)}</span>
                        ${item.lokasi_tolak ? `<p class="text-[9px] text-slate-400 mt-1 leading-tight">⛵ ${e(item.lokasi_tolak)}</p>` : ''}
                    </div>
                </div>

                <!-- Penumpang: Turun (kiri) | Naik (kanan) -->
                ${(getPaxTurun(item) > 0 || getPaxNaik(item) > 0) ? `
                <div class="grid grid-cols-2 gap-2 mb-2">
                    <div class="bg-rose-50 border border-rose-100 rounded-lg px-3 py-2 flex items-center justify-between">
                        <span class="text-[9px] font-bold text-rose-400 uppercase tracking-wider">Turun</span>
                        <span class="text-base font-bold text-rose-600">${getPaxTurun(item).toLocaleString('id-ID')}</span>
                    </div>
                    <div class="bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 flex items-center justify-between">
                        <span class="text-[9px] font-bold text-emerald-400 uppercase tracking-wider">Naik</span>
                        <span class="text-base font-bold text-emerald-600">${getPaxNaik(item).toLocaleString('id-ID')}</span>
                    </div>
                </div>` : ''}

                <!-- Kendaraan: Bongkar (kiri) | Muat (kanan) -->
                ${(item.roda_dua_muat||item.roda_dua_bongkar||item.roda_empat_muat||item.roda_empat_bongkar||item.truk_muat||item.truk_bongkar||item.bus_muat||item.bus_bongkar||item.alat_berat_muat||item.alat_berat_bongkar) ? `
                <div class="grid grid-cols-2 gap-2 mb-2">
                    <!-- Bongkar -->
                    <div class="bg-white border border-rose-100 rounded-lg p-2">
                        <p class="text-[9px] font-bold text-rose-500 uppercase tracking-wider mb-1">Bongkar</p>
                        <div class="space-y-0.5 text-[9px]">
                            ${item.roda_dua_bongkar  ? `<div class="flex justify-between"><span class="text-slate-500">Roda Dua</span><span class="font-bold text-slate-800">${item.roda_dua_bongkar}</span></div>` : ''}
                            ${item.roda_empat_bongkar? `<div class="flex justify-between"><span class="text-slate-500">Roda Empat</span><span class="font-bold text-slate-800">${item.roda_empat_bongkar}</span></div>` : ''}
                            ${item.bus_bongkar       ? `<div class="flex justify-between"><span class="text-slate-500">Bus</span><span class="font-bold text-slate-800">${item.bus_bongkar}</span></div>` : ''}
                            ${item.truk_bongkar      ? `<div class="flex justify-between"><span class="text-slate-500">Truk</span><span class="font-bold text-slate-800">${item.truk_bongkar}</span></div>` : ''}
                            ${item.alat_berat_bongkar? `<div class="flex justify-between"><span class="text-slate-500">Alat Berat</span><span class="font-bold text-slate-800">${item.alat_berat_bongkar}</span></div>` : ''}
                            ${!item.roda_dua_bongkar && !item.roda_empat_bongkar && !item.bus_bongkar && !item.truk_bongkar && !item.alat_berat_bongkar ? `<p class="text-slate-400 italic">-</p>` : ''}
                        </div>
                    </div>
                    <!-- Muat -->
                    <div class="bg-white border border-emerald-100 rounded-lg p-2">
                        <p class="text-[9px] font-bold text-emerald-600 uppercase tracking-wider mb-1">Muat</p>
                        <div class="space-y-0.5 text-[9px]">
                            ${item.roda_dua_muat  ? `<div class="flex justify-between"><span class="text-slate-500">Roda Dua</span><span class="font-bold text-slate-800">${item.roda_dua_muat}</span></div>` : ''}
                            ${item.roda_empat_muat? `<div class="flex justify-between"><span class="text-slate-500">Roda Empat</span><span class="font-bold text-slate-800">${item.roda_empat_muat}</span></div>` : ''}
                            ${item.bus_muat       ? `<div class="flex justify-between"><span class="text-slate-500">Bus</span><span class="font-bold text-slate-800">${item.bus_muat}</span></div>` : ''}
                            ${item.truk_muat      ? `<div class="flex justify-between"><span class="text-slate-500">Truk</span><span class="font-bold text-slate-800">${item.truk_muat}</span></div>` : ''}
                            ${item.alat_berat_muat? `<div class="flex justify-between"><span class="text-slate-500">Alat Berat</span><span class="font-bold text-slate-800">${item.alat_berat_muat}</span></div>` : ''}
                            ${!item.roda_dua_muat && !item.roda_empat_muat && !item.bus_muat && !item.truk_muat && !item.alat_berat_muat ? `<p class="text-slate-400 italic">-</p>` : ''}
                        </div>
                    </div>
                </div>` : ''}

                <!-- Trayek & Voyage -->
                <div class="flex flex-wrap gap-x-4 gap-y-1 text-[10px] border-t border-slate-200 pt-2">
                    ${item.trayek_datang ? `<span class="text-slate-500">Trayek Masuk <b class="text-slate-700">${e(item.trayek_datang)}</b></span>` : ''}
                    ${item.trayek_berangkat ? `<span class="text-slate-500">Trayek Keluar <b class="text-slate-700">${e(item.trayek_berangkat)}</b></span>` : ''}
                    ${item.voy_in ? `<span class="text-slate-500">Voy In <b class="text-slate-700 font-mono">${e(item.voy_in)}</b></span>` : ''}
                    ${item.voy_out ? `<span class="text-slate-500">Voy Out <b class="text-slate-700 font-mono">${e(item.voy_out)}</b></span>` : ''}
                </div>
            </div>

            <!-- ③ Dokumen + Status -->
            <div class="bg-slate-50 rounded-xl border border-slate-200 p-3">
                <p class="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-2">Dokumen & Status</p>
                <div class="space-y-1 text-[10px]">
                    ${item.nomor_pkk ? `<div class="flex flex-col"><span class="text-slate-400 text-[9px]">PKK</span><span class="font-mono text-slate-700 bg-white border border-slate-200 px-1.5 py-0.5 rounded text-[9px] break-all leading-tight">${e(item.nomor_pkk)}</span></div>` : ''}
                    ${item.no_lk3 ? `<div class="flex flex-col"><span class="text-slate-400 text-[9px]">LK3</span><span class="font-mono text-slate-700 bg-white border border-slate-200 px-1.5 py-0.5 rounded text-[9px] break-all leading-tight">${e(item.no_lk3)}</span></div>` : ''}
                    ${item.no_spb ? `<div class="flex flex-col"><span class="text-slate-400 text-[9px]">SPB</span><span class="font-mono text-slate-700 bg-white border border-slate-200 px-1.5 py-0.5 rounded text-[9px] break-all leading-tight">Nomor: ${e(item.no_spb)}<br>Waktu: ${e(item.waktu_spb)}</span></div>` : ''}
                    
                </div>
                <div class="mt-2 pt-2 border-t border-slate-200 space-y-1 text-[10px]">
                    <div class="flex justify-between"><span class="text-slate-500">Billing</span><span class="font-bold text-slate-800">${fUang(item.nominal_billing)}</span></div>
                    <div class="flex justify-between items-center"><span class="text-slate-500">Penyeberangan</span>${sTag(item.is_penyebrangan,'YA',null)}</div>
                    <div class="flex justify-between items-center"><span class="text-slate-500">Minerba</span>${sTag(item.is_minerba,'YA',null)}</div>
                    <div class="flex justify-between items-center"><span class="text-slate-500">Docking</span>${sTag(item.is_docking,'YA',null)}</div>
                    <div class="flex justify-between items-center"><span class="text-slate-500">Kegiatan Tetap</span>${sTag(item.is_kegiatan_tetap,'YA',null)}</div>
                    <div class="flex justify-between items-center"><span class="text-slate-500">Kapal Perintis</span>${sTag(item.is_perintis,'YA',null)}</div>
                    <div class="flex justify-between items-center"><span class="text-slate-500">Tol Laut</span>${sTag(item.is_tol_laut,'YA',null)}</div>
                </div>
            </div>

            <!-- ④ Bongkar & Muat — full width, tinggi lebih panjang -->
            <div class="lg:col-span-3 bg-slate-50 rounded-xl border border-slate-200 p-3">
                <p class="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-2">Rincian Komoditi</p>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div class="bg-white rounded-lg border border-slate-100 shadow-sm p-2.5">
                        <h5 class="text-[10px] font-bold text-rose-600 mb-2 uppercase border-b border-rose-100 pb-1">Bongkar</h5>
                        <div class="overflow-y-auto pr-1 space-y-1.5" style="max-height:220px">${renderBongkarMuat(item.detail_bongkar, 'rose')}</div>
                    </div>
                    <div class="bg-white rounded-lg border border-slate-100 shadow-sm p-2.5">
                        <h5 class="text-[10px] font-bold text-emerald-600 mb-2 uppercase border-b border-emerald-100 pb-1">Muat</h5>
                        <div class="overflow-y-auto pr-1 space-y-1.5" style="max-height:220px">${renderBongkarMuat(item.detail_muat, 'emerald')}</div>
                    </div>
                </div>
            </div>

        </div>`;

    document.getElementById('modalBody').innerHTML = contentHtml;
    document.getElementById('detailModal').classList.remove('hidden');
    lucide.createIcons({ nodes: [document.getElementById('detailModal')] });
};

window.closeDetailModal = function() {
    document.getElementById('detailModal').classList.add('hidden');
};

// ==========================================
// CHART TAB SWITCHING
// ==========================================
let _activeChart = 'eta';

window._switchChart = function(name) {
    _activeChart = name;
    const panels = ['eta','trayek','pax','jenis'];
    panels.forEach(p => {
        const panel = document.getElementById('chartPanel-' + p);
        const btn   = document.getElementById('chartTab-' + p);
        if (!panel || !btn) return;
        if (p === name) {
            panel.classList.remove('hidden');
            btn.className = 'chart-tab-btn flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-blue-600 bg-blue-600 text-white transition-colors';
        } else {
            panel.classList.add('hidden');
            btn.className = 'chart-tab-btn flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 transition-colors';
        }
    });
    // Trigger resize agar chart mengisi canvas yang baru terlihat
    const instMap = { eta: etaChartInst, trayek: trayekChartInst, pax: paxChartInst, jenis: jenisChartInst };
    const inst = instMap[name];
    if (inst) { setTimeout(() => { try { inst.resize(); } catch(e) {} }, 50); }
    lucide.createIcons({ nodes: [document.getElementById('chartPanel-' + name)?.parentElement] });
};


// ==========================================
// SETTINGS MODAL — MULTI TAB
// ==========================================
let _currentTab = 'sistem';

window._switchTab = function(tab) {
    _currentTab = tab;
    ['sistem','akun','users'].forEach(t => {
        const panel = document.getElementById('panel' + t.charAt(0).toUpperCase() + t.slice(1));
        if (panel) panel.classList.add('hidden');
        const btn = document.getElementById('tab' + t.charAt(0).toUpperCase() + t.slice(1));
        if (btn) { btn.classList.remove('border-blue-600','text-blue-600'); btn.classList.add('border-transparent','text-slate-500'); }
    });
    const activePanel = document.getElementById('panel' + tab.charAt(0).toUpperCase() + tab.slice(1));
    if (activePanel) activePanel.classList.remove('hidden');
    const activeBtn = document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1));
    if (activeBtn) { activeBtn.classList.add('border-blue-600','text-blue-600'); activeBtn.classList.remove('border-transparent','text-slate-500'); }
    const btnSimpan = document.getElementById('btnSimpanSettings');
    if (btnSimpan) btnSimpan.classList.toggle('hidden', tab === 'users');
    if (tab === 'users') window._loadUserList();
};

window.openSettingsModal = function() {
    const sel = document.getElementById('cfgPortCode');
    if (!sel) return;
    sel.innerHTML = PORT_LIST
        .slice().sort((a, b) => a.nama_pelabuhan.localeCompare(b.nama_pelabuhan, 'id'))
        .map(p => `<option value="${escHTML(p.kode_pelabuhan)}">${escHTML(p.nama_pelabuhan)}</option>`)
        .join('');
    // Port default: prioritas dari user session, fallback ke global config
    let activeCode = (sessionDataObj?.default_port) || APP_CONFIG.DEFAULT_PORT_CODE || '';
    const byCode = PORT_LIST.find(p => p.kode_pelabuhan.toUpperCase() === activeCode.toUpperCase());
    if (!byCode) {
        const byName = PORT_LIST.find(p => p.nama_pelabuhan.toUpperCase() === activeCode.toUpperCase());
        if (byName) activeCode = byName.kode_pelabuhan;
    }
    sel.value = activeCode;
    document.getElementById('cfgScraping').value = APP_CONFIG.USE_SCRAPING === 'TRUE' ? 'TRUE' : 'FALSE';
    // Sync dropdown strategi fetch dengan nilai APP_CONFIG yang sudah dimuat dari localStorage
    const cfgStrategyEl = document.getElementById('cfgFetchStrategy');
    if (cfgStrategyEl) cfgStrategyEl.value = APP_CONFIG.FETCH_STRATEGY || 'live_first';
    const nameEl = document.getElementById('cfgAuthName');
    const userEl = document.getElementById('cfgAuthUsername');
    if (nameEl) nameEl.value = sessionDataObj?.name || '';
    if (userEl) userEl.value = sessionDataObj?.username || '';
    const pwdEl  = document.getElementById('cfgAuthPassword');
    const pwd2El = document.getElementById('cfgAuthPasswordConfirm');
    if (pwdEl)  pwdEl.value  = '';
    if (pwd2El) pwd2El.value = '';
    const tabUsers = document.getElementById('tabUsers');
    if (tabUsers) tabUsers.classList.toggle('hidden', sessionDataObj?.role !== 'admin');
    window._switchTab('sistem');
    lucide.createIcons({ nodes: [document.getElementById('settingsModal')] });
    document.getElementById('settingsModal').classList.remove('hidden');
};

window.closeSettingsModal = function() {
    document.getElementById('settingsModal').classList.add('hidden');
};

window._togglePwdVisibility = function() {
    const input = document.getElementById('cfgAuthPassword');
    const icon  = document.getElementById('pwdEyeIcon');
    if (!input) return;
    if (input.type === 'password') {
        input.type = 'text';
        if (icon) { icon.setAttribute('data-lucide', 'eye-off'); lucide.createIcons({ nodes: [icon.parentElement] }); }
    } else {
        input.type = 'password';
        if (icon) { icon.setAttribute('data-lucide', 'eye'); lucide.createIcons({ nodes: [icon.parentElement] }); }
    }
};

window.saveSettingsConfig = async function() {
    if (_currentTab === 'sistem') {
        const sel = document.getElementById('cfgPortCode');
        const selectedCode = sel ? sel.value.trim() : '';
        if (!selectedCode) { Swal.fire({ icon: 'warning', title: 'Pilih pelabuhan terlebih dahulu', showConfirmButton: false, timer: 2000 }); return; }
        const portInfo = PORT_LIST.find(p => p.kode_pelabuhan === selectedCode);
        if (!portInfo) { Swal.fire({ icon: 'error', title: 'Kode tidak valid', timer: 2000, showConfirmButton: false }); return; }

        // Memastikan nilai strategi terbaca dengan benar dari pilihan pengguna
        const strategiPilihan = document.getElementById('cfgFetchStrategy')?.value || 'live_first';
        const scrapingPilihan = document.getElementById('cfgScraping')?.value || 'FALSE';

        // Simpan konfigurasi ke memori browser (APP_CONFIG dan localStorage) spesifik untuk akun
        APP_CONFIG.FETCH_STRATEGY = strategiPilihan;
        APP_CONFIG.USE_SCRAPING = scrapingPilihan;
        try {
            const configKey = `inaportnet_config_${sessionDataObj?.username || 'default'}`;
            const saved = JSON.parse(localStorage.getItem(configKey) || '{}');
            saved.FETCH_STRATEGY = strategiPilihan;
            saved.USE_SCRAPING = scrapingPilihan;
            localStorage.setItem(configKey, JSON.stringify(saved));
        } catch(e) {}

        Swal.fire({ title: 'Menyimpan...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        try {
            // Data untuk disimpan ke profil pengguna
            const userData = {
                username:     sessionDataObj?.username,
                nama:         sessionDataObj?.name || '',
                default_port: portInfo.kode_pelabuhan
            };

            // Data untuk disimpan ke database (Google Sheets tab CONFIG)
            const configData = {
                FETCH_STRATEGY: strategiPilihan,
                USE_SCRAPING: scrapingPilihan
            };
            
            // Tampilkan log di console browser untuk memastikan data benar-benar terkirim
            console.log("Mengirim data ke database:", configData);

            // Jalankan kedua request penyimpanan secara bersamaan ke backend
            const rUser = fetch(GAS_WEB_APP_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'saveUser', user: userData }) });
            const rConfig = fetch(GAS_WEB_APP_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'updateConfig', config: configData }) });

            const [resUser, resConfig] = await Promise.all([rUser.then(r => r.json()), rConfig.then(r => r.json())]);

            if (resUser.status === 'success' && resConfig.status === 'success') {
                // Perbarui sesi lokal
                if (sessionDataObj) {
                    sessionDataObj.default_port = portInfo.kode_pelabuhan;
                    const sess = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}');
                    sess.default_port = portInfo.kode_pelabuhan;
                    localStorage.setItem(SESSION_KEY, JSON.stringify(sess));
                }
                APP_CONFIG.DEFAULT_PORT_CODE = portInfo.kode_pelabuhan;
                setDefaultPortInput();
                window.closeSettingsModal();
                Swal.fire({ icon: 'success', title: 'Pengaturan disimpan', text: portInfo.nama_pelabuhan, timer: 2000, showConfirmButton: false });
            } else throw new Error(resUser.message || resConfig.message || 'Gagal menyimpan pengaturan');
        } catch(err) { Swal.fire({ icon: 'error', title: 'Gagal', text: err.message }); }
        return;
    }
    if (_currentTab === 'akun') {
        const newName = (document.getElementById('cfgAuthName')?.value || '').trim();
        const newPwd  = (document.getElementById('cfgAuthPassword')?.value || '').trim();
        const newPwd2 = (document.getElementById('cfgAuthPasswordConfirm')?.value || '').trim();
        if (newPwd && newPwd !== newPwd2) { Swal.fire({ icon: 'error', title: 'Password tidak cocok' }); return; }
        // Sertakan default_port dari session agar tidak tertimpa kosong
        const userData = {
            username:     sessionDataObj?.username,
            nama:         newName,
            password:     newPwd,
            default_port: sessionDataObj?.default_port || ''
        };
        Swal.fire({ title: 'Menyimpan...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        try {
            const r   = await fetch(GAS_WEB_APP_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'saveUser', user: userData }) });
            const res = await r.json();
            if (res.status === 'success') {
                try {
                    const sess = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}');
                    sess.name = newName; localStorage.setItem(SESSION_KEY, JSON.stringify(sess));
                    if (sessionDataObj) sessionDataObj.name = newName;
                    const dnEl = document.getElementById('displayName');
                    if (dnEl) dnEl.textContent = escHTML(newName);
                } catch(e) {}
                window.closeSettingsModal();
                Swal.fire({ icon: 'success', title: 'Akun diperbarui', timer: 2000, showConfirmButton: false });
            } else throw new Error(res.message);
        } catch(err) { Swal.fire({ icon: 'error', title: 'Gagal', text: err.message }); }
    }
};

// ── Manajemen Pengguna (admin only) ───────────────────────
let _editingUsername = null;

window._loadUserList = async function() {
    const container = document.getElementById('userListContainer');
    if (!container) return;
    container.innerHTML = '<p class="text-xs text-slate-400 text-center py-4">Memuat...</p>';
    try {
        const r   = await fetch(GAS_WEB_APP_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'getUsers' }) });
        const res = await r.json();
        if (res.status !== 'success') throw new Error(res.message);
        const users = res.users || [];
        if (users.length === 0) { container.innerHTML = '<p class="text-xs text-slate-400 text-center py-4">Belum ada pengguna.</p>'; return; }
        container.innerHTML = users.map(u => `
            <div class="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <div>
                    <p class="text-xs font-bold text-slate-800">${escHTML(u.nama || u.username)} <span class="text-[9px] font-mono text-slate-400 ml-1">@${escHTML(u.username)}</span></p>
                    <p class="text-[9px] mt-0.5 flex items-center gap-1.5">
                        <span class="px-1.5 py-0.5 rounded-full ${u.role==='admin' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'} font-bold uppercase">${escHTML(u.role)}</span>
                        <span class="${u.aktif ? 'text-emerald-600' : 'text-rose-500'}">${u.aktif ? '● Aktif' : '○ Nonaktif'}</span>
                    </p>
                </div>
                <div class="flex gap-1">
                    <button onclick="window._openUserForm(${JSON.stringify(u).replace(/"/g,'&quot;')})" class="text-[10px] bg-white border border-slate-300 hover:bg-slate-50 text-slate-600 px-2 py-1 rounded transition-colors">Edit</button>
                    ${u.username !== sessionDataObj?.username ? `<button onclick="window._deleteUser('${escHTML(u.username)}')" class="text-[10px] bg-white border border-rose-200 hover:bg-rose-50 text-rose-600 px-2 py-1 rounded transition-colors">Hapus</button>` : ''}
                </div>
            </div>`).join('');
    } catch(err) { container.innerHTML = `<p class="text-xs text-rose-500 text-center py-4">${escHTML(err.message)}</p>`; }
};

window._openUserForm = function(user) {
    _editingUsername = user?.username || null;
    document.getElementById('userFormTitle').textContent = user ? 'Edit Pengguna' : 'Tambah Pengguna';
    const uEl = document.getElementById('uUsername');
    uEl.value = user?.username || '';
    uEl.readOnly = !!user;
    document.getElementById('uNama').value     = user?.nama || '';
    document.getElementById('uPassword').value = '';
    document.getElementById('uRole').value     = user?.role || 'user';
    document.getElementById('uAktif').checked  = user ? user.aktif : true;
    document.getElementById('uPwdRequired').textContent = user ? '' : '*';

    // Isi select port default dari PORT_LIST
    const portSel = document.getElementById('uDefaultPort');
    if (portSel) {
        portSel.innerHTML = '<option value="">— Gunakan port global —</option>' +
            PORT_LIST.slice().sort((a,b) => a.nama_pelabuhan.localeCompare(b.nama_pelabuhan,'id'))
                .map(p => `<option value="${escHTML(p.kode_pelabuhan)}">${escHTML(p.nama_pelabuhan)}</option>`)
                .join('');
        portSel.value = user?.default_port || '';
    }

    document.getElementById('userFormPanel').classList.remove('hidden');
};

window._closeUserForm = function() {
    document.getElementById('userFormPanel').classList.add('hidden');
    _editingUsername = null;
};

window._saveUser = async function() {
    const username = document.getElementById('uUsername').value.trim();
    const nama     = document.getElementById('uNama').value.trim();
    const password = document.getElementById('uPassword').value.trim();
    const role     = document.getElementById('uRole').value;
    const aktif    = document.getElementById('uAktif').checked;
    if (!username) { Swal.fire({ icon: 'warning', title: 'Username wajib diisi', timer: 2000, showConfirmButton: false }); return; }
    if (!_editingUsername && !password) { Swal.fire({ icon: 'warning', title: 'Password wajib untuk akun baru', timer: 2000, showConfirmButton: false }); return; }
    const default_port = document.getElementById('uDefaultPort')?.value || '';
    try {
        const r   = await fetch(GAS_WEB_APP_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'saveUser', user: { username, nama, password, role, aktif, default_port } }) });
        const res = await r.json();
        if (res.status !== 'success') throw new Error(res.message);
        window._closeUserForm();
        window._loadUserList();
        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: res.message, timer: 2000, showConfirmButton: false });
    } catch(err) { Swal.fire({ icon: 'error', title: 'Gagal', text: err.message }); }
};

window._deleteUser = async function(username) {
    const conf = await Swal.fire({ icon: 'warning', title: 'Hapus akun?', text: `@${username} akan dihapus permanen.`, showCancelButton: true, confirmButtonColor: '#dc2626', confirmButtonText: 'Hapus', cancelButtonText: 'Batal' });
    if (!conf.isConfirmed) return;
    try {
        const r   = await fetch(GAS_WEB_APP_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deleteUser', username }) });
        const res = await r.json();
        if (res.status !== 'success') throw new Error(res.message);
        window._loadUserList();
        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Akun dihapus', timer: 2000, showConfirmButton: false });
    } catch(err) { Swal.fire({ icon: 'error', title: 'Gagal', text: err.message }); }
};


window.handleLogout = function() {
    localStorage.removeItem(SESSION_KEY);
    window.location.href = 'login.html';
};

// ==========================================
// MOBILE MENU — bottom sheet
// ==========================================
window._openMobileMenu = function() {
    // Sync info user ke elemen mobile menu
    const nm = document.getElementById('mobileDisplayName');
    const un = document.getElementById('mobileDisplayUsername');
    const pt = document.getElementById('mobileDisplayPort');
    const pr = document.getElementById('mobileDisplayPeriod');
    if (nm) nm.textContent = document.getElementById('displayName')?.textContent || '–';
    if (un) un.textContent = document.getElementById('displayUsername')?.textContent || '–';
    if (pt) pt.textContent = document.getElementById('displayPort')?.textContent || 'Memuat...';
    if (pr) pr.textContent = document.getElementById('displayPeriod')?.textContent || 'Memuat...';

    const menu = document.getElementById('mobileMenu');
    if (!menu) return;
    menu.classList.add('open');
    document.body.style.overflow = 'hidden';
    lucide.createIcons({ nodes: [menu] });
};

window._closeMobileMenu = function() {
    const menu = document.getElementById('mobileMenu');
    if (!menu) return;
    menu.classList.remove('open');
    document.body.style.overflow = '';
};

// ==========================================
// DOWNLOAD DATA — pilih kolom lalu ekspor CSV/TSV
// ==========================================
const DOWNLOAD_COLS = [
    { key: 'no',               label: 'No',                 checked: true,  get: (item, i) => i + 1 },
    { key: 'nama_kapal',       label: 'Nama Kapal',         checked: true,  get: item => item.nama_kapal || '' },
    { key: 'jenis_kapal',      label: 'Jenis Kapal',        checked: true,  get: item => item.jenis_kapal_xls || item.tipe_kapal || '' },
    { key: 'perusahaan',       label: 'Perusahaan',         checked: true,  get: item => item.perusahaan || item.keagenan || '' },
    { key: 'bendera',          label: 'Bendera',            checked: true,  get: item => item.bendera || '' },
    { key: 'gt',               label: 'GT',                 checked: true,  get: item => item.gt || '' },
    { key: 'nomor_pkk',        label: 'No PKK',             checked: true,  get: item => item.nomor_pkk || '' },
    { key: 'no_spb',           label: 'No SPB',             checked: true,  get: item => item.no_spb || '' },
    { key: 'no_lk3',           label: 'No LK3',             checked: false, get: item => item.no_lk3 || '' },
    { key: 'pelabuhan_asal',   label: 'Asal',               checked: true,  get: item => item.pelabuhan_asal || '' },
    { key: 'pelabuhan_tujuan', label: 'Tujuan',             checked: true,  get: item => item.pelabuhan_tujuan || '' },
    { key: 'eta',              label: 'Tanggal Tiba',       checked: false, get: item => item.eta || item.tgl_eta || '' },
    { key: 'etd',              label: 'Tanggal Berangkat',  checked: true,  get: item => item.etd || item.tgl_etd || '' },
    { key: 'lokasi_tolak',     label: 'Lokasi Tolak',       checked: true,  get: item => item.lokasi_tolak || '' },
    { key: 'petugas_spb',      label: 'Petugas SPB',        checked: true,  get: item => item.spb_approve_fullname || '' },
    { key: 'waktu_spb',        label: 'Waktu SPB',          checked: true,  get: item => item.waktu_spb || '' },
    { key: 'manifest',         label: 'Manifest',           checked: true,  get: item => item.manifest || '' },
    // ── Komoditi — diproses khusus di _doDownload ──
    { key: 'bongkar_ringkas',  label: 'Bongkar + Penumpang Turun', checked: false,
      get: item => {
          const parts = [];
          const paxT = getPaxTurun(item);
          if (paxT > 0) parts.push(`Penumpang (${paxT} org)`);
          
          const detail = (item.detail_bongkar||[]).filter(b=>b&&b.komoditi&&String(b.komoditi).trim()&&String(b.komoditi).trim()!=='-');
          if (detail.length > 0) {
              detail.forEach(b => parts.push(`${b.komoditi}${b.ton&&b.ton!=='-'?' ('+b.ton+' ton)':''}`));
          } else {
              if (item.roda_dua_bongkar) parts.push(`Roda Dua (${item.roda_dua_bongkar} unit)`);
              if (item.roda_empat_bongkar) parts.push(`Roda Empat (${item.roda_empat_bongkar} unit)`);
              if (item.bus_bongkar) parts.push(`Bus (${item.bus_bongkar} unit)`);
              if (item.truk_bongkar) parts.push(`Truk (${item.truk_bongkar} unit)`);
              if (item.alat_berat_bongkar) parts.push(`Alat Berat (${item.alat_berat_bongkar} unit)`);
          }
          return parts.join(' | ');
      }
    },
    { key: 'muat_ringkas',     label: 'Muat + Penumpang Naik',    checked: false,
      get: item => {
          const parts = [];
          const paxN = getPaxNaik(item);
          if (paxN > 0) parts.push(`Penumpang (${paxN} org)`);
          
          const detail = (item.detail_muat||[]).filter(m=>m&&m.komoditi&&String(m.komoditi).trim()&&String(m.komoditi).trim()!=='-');
          if (detail.length > 0) {
              detail.forEach(m => parts.push(`${m.komoditi}${m.ton&&m.ton!=='-'?' ('+m.ton+' ton)':''}`));
          } else {
              if (item.roda_dua_muat) parts.push(`Roda Dua (${item.roda_dua_muat} unit)`);
              if (item.roda_empat_muat) parts.push(`Roda Empat (${item.roda_empat_muat} unit)`);
              if (item.bus_muat) parts.push(`Bus (${item.bus_muat} unit)`);
              if (item.truk_muat) parts.push(`Truk (${item.truk_muat} unit)`);
              if (item.alat_berat_muat) parts.push(`Alat Berat (${item.alat_berat_muat} unit)`);
          }
          return parts.join(' | ');
      }
    },
];

window._openDownloadModal = function() {
    const container = document.getElementById('downloadColList');
    if (!container) return;

    const colsUmum    = DOWNLOAD_COLS.filter(c => !c.key.includes('ringkas'));
    const colsRingkas = DOWNLOAD_COLS.filter(c =>  c.key.includes('ringkas'));

    container.innerHTML = `
        <div class="col-span-2">
            <p class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Informasi Kapal</p>
        </div>
        ${colsUmum.map(col => `
        <label class="flex items-center gap-1.5 text-xs cursor-pointer hover:text-blue-600">
            <input type="checkbox" class="dl-col-check accent-blue-600" value="${col.key}" ${col.checked ? 'checked' : ''}>
            ${col.label}
        </label>`).join('')}
        <div class="col-span-2 border-t border-slate-200 mt-1 pt-2">
            <p class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Komoditi & Penumpang</p>
        </div>
        ${colsRingkas.map(col => `
        <label class="flex items-center gap-1.5 text-xs cursor-pointer hover:text-blue-600 col-span-2">
            <input type="checkbox" class="dl-col-check accent-blue-600" value="${col.key}" ${col.checked ? 'checked' : ''}>
            ${col.label}
        </label>`).join('')}
        
        <!-- Tombol Radio Dinamis -->
        <div id="dynamicModeKomoditi" class="col-span-2 mt-2 p-2 bg-slate-50 border border-slate-200 rounded hidden">
            <p class="text-[10px] font-bold text-slate-500 uppercase mb-1">Format Ekspor Komoditi</p>
            <div class="space-y-1.5">
                <label class="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="radio" name="dlModeKomoditi" value="ringkas" checked class="accent-blue-600"> 
                    Ringkas (Gabung dalam 1 Sel)
                </label>
                <label class="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="radio" name="dlModeKomoditi" value="detail" class="accent-blue-600"> 
                    Detail (Bongkar & Muat Berdampingan)
                </label>
                <label class="flex items-center gap-2 text-xs cursor-pointer text-slate-700">
                    <input type="radio" name="dlModeKomoditi" value="kendaraan" class="accent-blue-600"> 
                    Detail + Kendaraan <span class="text-[9px] text-slate-400 italic">(Masuk jika komoditi kosong)</span>
                </label>
            </div>
        </div>`;

    const modal = document.getElementById('downloadModal');
    if (modal) {
        modal.classList.remove('hidden');
        lucide.createIcons({ nodes: [modal] });
        const updateModeVisibility = () => {
            const anyRingkas = !!modal.querySelector('.dl-col-check[value="bongkar_ringkas"]:checked, .dl-col-check[value="muat_ringkas"]:checked');
            const wrapper = document.getElementById('dynamicModeKomoditi');
            const oldWrapper = document.getElementById('modeKomoditiWrapper');
            if (oldWrapper) oldWrapper.style.display = 'none'; // Paksa sembunyikan fallback dari HTML jika ada
            if (wrapper) wrapper.classList.toggle('hidden', !anyRingkas);
        };
        modal.querySelectorAll('.dl-col-check').forEach(cb => cb.addEventListener('change', updateModeVisibility));
        updateModeVisibility();
    }
};

// Helper: konversi nilai tanggal/waktu ke milidetik untuk pengurutan unduhan
function _toSortMs(raw) {
    if (!raw || raw === '-') return 0;
    const s = String(raw).trim();
    // Format "DD-MM-YYYY HH:mm" atau "DD-MM-YYYY"
    const dmy = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})(?:[T\s](\d{2}):(\d{2}))?/);
    if (dmy) {
        const iso = `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}${dmy[4] ? `T${dmy[4]}:${dmy[5]}:00` : ''}`;
        const d = new Date(iso);
        return isNaN(d.getTime()) ? 0 : d.getTime();
    }
    try { const d = new Date(s); return isNaN(d.getTime()) ? 0 : d.getTime(); } catch(e) { return 0; }
}

window._doDownload = function() {
    const checked = [...document.querySelectorAll('.dl-col-check:checked')].map(el => el.value);
    if (checked.length === 0) {
        Swal.fire({ toast: true, icon: 'warning', title: 'Pilih minimal 1 kolom', timer: 2000, showConfirmButton: false, position: 'top-end' });
        return;
    }

    const format       = document.querySelector('input[name="dlFormat"]:checked')?.value || 'xlsx';
    const modaKomoditi = document.querySelector('input[name="dlModeKomoditi"]:checked')?.value || 'ringkas';
    // Baca pilihan urutan dari dropdown dlSortOrder
    const sortOrder    = document.getElementById('dlSortOrder')?.value || 'etd_asc';
    const cols         = DOWNLOAD_COLS.filter(c => checked.includes(c.key));
    const colsDasar    = cols.filter(c => !c.key.includes('ringkas'));
    const now          = new Date();
    const ts           = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;

    // Urutkan data sebelum diekspor
    const sortFns = {
        etd_asc:  (a, b) => _toSortMs(getETD(a))   - _toSortMs(getETD(b)),
        etd_desc: (a, b) => _toSortMs(getETD(b))   - _toSortMs(getETD(a)),
        spb_asc:  (a, b) => _toSortMs(a.waktu_spb) - _toSortMs(b.waktu_spb),
        spb_desc: (a, b) => _toSortMs(b.waktu_spb) - _toSortMs(a.waktu_spb),
    };
    const dataToExport = [..._filteredData].sort(sortFns[sortOrder] || sortFns.etd_asc);

    const cellVal = (v) => {
        if (v === null || v === undefined || v === '') return '';
        if (!isNaN(Number(v)) && String(v).trim() !== '') return Number(v);
        return String(v);
    };

    const adaBongkar = checked.includes('bongkar_ringkas');
    const adaMuat    = checked.includes('muat_ringkas');
    const adaRingkas = adaBongkar || adaMuat;

    let wsData;

    if (adaRingkas && (modaKomoditi === 'detail' || modaKomoditi === 'kendaraan')) {
        // ── Mode detail: Kolom Bongkar dan Muat berdampingan ──────────────
        const headerBongkar = ['Komoditi (Bongkar)', 'Jenis Muatan', 'Ton', 'M3', 'Unit', 'Orang (turun)'];
        const headerMuat    = ['Komoditi (muat)', 'Jenis Muatan ', 'Ton ', 'M3 ', 'Unit ', 'Orang (naik)']; // Spasi mencegah duplikasi string jika CSV membedakan unik

        let detailHeaders = [];
        if (adaBongkar) detailHeaders.push(...headerBongkar);
        if (adaMuat)    detailHeaders.push(...headerMuat);

        wsData = [ [...colsDasar.map(c => c.label), ...detailHeaders] ];

        dataToExport.forEach((item, i) => {
            const baseCells = colsDasar.map(c => cellVal(c.get(item, i)));
            
            // --- Kumpulkan Data Bongkar ---
            const bList = [];
            if (adaBongkar) {
                const paxT = getPaxTurun(item);
                if (paxT > 0) bList.push(['Penumpang', 'Penumpang', '', '', '', paxT]);

                const dBongkar = (item.detail_bongkar || []).filter(b => b && b.komoditi && String(b.komoditi).trim() && String(b.komoditi).trim() !== '-');
                if (dBongkar.length > 0) {
                    dBongkar.forEach(b => bList.push([
                        b.komoditi, b.jenis||'', b.ton&&b.ton!=='-'?b.ton:'', b.m3&&b.m3!=='-'?b.m3:'', b.unit&&b.unit!=='-'?b.unit:'', b.orang&&b.orang!=='-'?b.orang:''
                    ]));
                } else if (modaKomoditi === 'kendaraan') {
                    // Fallback kendaraan jika array bongkar kosong
                    if (item.roda_dua_bongkar) bList.push(['Roda Dua', 'Kendaraan', '', '', item.roda_dua_bongkar, '']);
                    if (item.roda_empat_bongkar) bList.push(['Roda Empat', 'Kendaraan', '', '', item.roda_empat_bongkar, '']);
                    if (item.bus_bongkar) bList.push(['Bus', 'Kendaraan', '', '', item.bus_bongkar, '']);
                    if (item.truk_bongkar) bList.push(['Truk', 'Kendaraan', '', '', item.truk_bongkar, '']);
                    if (item.alat_berat_bongkar) bList.push(['Alat Berat', 'Kendaraan', '', '', item.alat_berat_bongkar, '']);
                }
            }

            // --- Kumpulkan Data Muat ---
            const mList = [];
            if (adaMuat) {
                const paxN = getPaxNaik(item);
                if (paxN > 0) mList.push(['Penumpang', 'Penumpang', '', '', '', paxN]);

                const dMuat = (item.detail_muat || []).filter(m => m && m.komoditi && String(m.komoditi).trim() && String(m.komoditi).trim() !== '-');
                if (dMuat.length > 0) {
                    dMuat.forEach(m => mList.push([
                        m.komoditi, m.jenis||'', m.ton&&m.ton!=='-'?m.ton:'', m.m3&&m.m3!=='-'?m.m3:'', m.unit&&m.unit!=='-'?m.unit:'', m.orang&&m.orang!=='-'?m.orang:''
                    ]));
                } else if (modaKomoditi === 'kendaraan') {
                    // Fallback kendaraan jika array muat kosong
                    if (item.roda_dua_muat) mList.push(['Roda Dua', 'Kendaraan', '', '', item.roda_dua_muat, '']);
                    if (item.roda_empat_muat) mList.push(['Roda Empat', 'Kendaraan', '', '', item.roda_empat_muat, '']);
                    if (item.bus_muat) mList.push(['Bus', 'Kendaraan', '', '', item.bus_muat, '']);
                    if (item.truk_muat) mList.push(['Truk', 'Kendaraan', '', '', item.truk_muat, '']);
                    if (item.alat_berat_muat) mList.push(['Alat Berat', 'Kendaraan', '', '', item.alat_berat_muat, '']);
                }
            }

            // --- Gabungkan Baris secara Berdampingan ---
            // Cari jumlah baris terbanyak antara list bongkar dan muat
            const maxRows = Math.max(bList.length, mList.length, 1);
            
            for (let r = 0; r < maxRows; r++) {
                let rowCells = [];
                
                if (adaBongkar) {
                    const bCells = r < bList.length ? bList[r] : ['', '', '', '', '', ''];
                    rowCells.push(...bCells.map(cellVal));
                }
                
                if (adaMuat) {
                    const mCells = r < mList.length ? mList[r] : ['', '', '', '', '', ''];
                    rowCells.push(...mCells.map(cellVal));
                }

                wsData.push([
                    // Jika r===0 (baris pertama kapal), masukkan data kapal, jika tidak, isi dengan string kosong
                    ...(r === 0 ? baseCells : baseCells.map(() => '')),
                    ...rowCells
                ]);
            }
        });

    } else {
        // ── Mode ringkas: 1 baris per kapal (data digabungkan dalam 1 sel) ──────────────────────────
        wsData = [ cols.map(c => c.label) ];
        dataToExport.forEach((item, i) => {
            wsData.push(cols.map(c => cellVal(c.get(item, i))));
        });
    }

    if (format === 'xlsx') {
        if (typeof XLSX === 'undefined') {
            Swal.fire({ icon: 'error', title: 'Library XLSX belum dimuat', text: 'Coba muat ulang halaman.' });
            return;
        }
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        const nCols = wsData[0].length;
        ws['!cols'] = Array.from({ length: nCols }, (_, ci) => {
            const maxLen = Math.max(...wsData.map(row => String(row[ci] ?? '').length));
            return { wch: Math.min(Math.max(maxLen + 2, 10), 60) };
        });
        const range = XLSX.utils.decode_range(ws['!ref']);
        for (let C = range.s.c; C <= range.e.c; C++) {
            const cell = ws[XLSX.utils.encode_cell({ r: 0, c: C })];
            if (cell) cell.s = { font: { bold: true }, fill: { fgColor: { rgb: 'E2E8F0' } } };
        }
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Data Inaportnet');
        XLSX.writeFile(wb, `inaportnet_${ts}.xlsx`);

    } else {
        const csvRows = wsData.map(row =>
            row.map(v => {
                let s = String(v ?? '').replace(/\r?\n/g, ' ');
                if (s.includes(',') || s.includes('"')) s = '"' + s.replace(/"/g, '""') + '"';
                return s;
            }).join(',')
        );
        const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = `inaportnet_${ts}.csv`;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
    }

    const totalBaris = wsData.length - 1;
    document.getElementById('downloadModal').classList.add('hidden');
    Swal.fire({ toast: true, icon: 'success', title: `${totalBaris} baris diunduh`, timer: 2000, showConfirmButton: false, position: 'top-end' });
};

// ==========================================
// CETAK DOKUMEN — MODE STANDAR
// LK3 dan Kru dibuka via loadDocument berbasis nomor PKK
// (nomor LK3 di data berbeda format/urut dengan URL PDF, tidak bisa diprediksi)
// ==========================================
window.cetakDokumenScrape = function(event, jenis, noPkk) {
    if (event && event.preventDefault) event.preventDefault();

    const pkk = String(noPkk || '')
        .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
        .replace(/&quot;/g,'"').replace(/&#039;/g,"'").trim();

    if (!pkk || pkk === '-') {
        Swal.fire({ toast:true, icon:'warning', title:'Nomor PKK tidak tersedia',
            showConfirmButton:false, timer:2500, position:'top-end' });
        return;
    }

    if (jenis === 'LK3') {
        window.open(
            'https://simpadu-inaportnet.dephub.go.id/document/lk3/loadDocument/2?by=sps.nomor_pkk&keyword='
            + encodeURIComponent(pkk), '_blank'
        );
    } else {
        window.open(
            'https://sps-inaportnet.dephub.go.id/index.php/document/pelaut/loadDocument/2?by=sps.nomor_pkk&keyword='
            + encodeURIComponent(pkk), '_blank'
        );
    }
};


// ==========================================
// SESSION EXPIRY WARNING (FIX: peringatan sebelum logout)
// ==========================================
function startSessionMonitor() {
    const WARNING_BEFORE_MS = 5 * 60 * 1000; // 5 menit sebelum habis
    setInterval(() => {
        try {
            const s = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}');
            if (!s.expiry) return;
            const remaining = s.expiry - Date.now();
            if (remaining <= 0) {
                window.handleLogout();
            } else if (remaining <= WARNING_BEFORE_MS) {
                document.getElementById('sessionWarning').style.display = 'block';
            } else {
                document.getElementById('sessionWarning').style.display = 'none';
            }
        } catch(e) {}
    }, 30000); // cek setiap 30 detik
}

// ==========================================
// SET BULAN & TAHUN OTOMATIS MENGIKUTI WAKTU SAAT INI
// ==========================================
function setCurrentPeriod() {
    const now = new Date();
    const currentYear  = String(now.getFullYear());
    const currentMonth = String(now.getMonth() + 1).padStart(2, '0');

    const yearSelect  = document.getElementById('yearFilter');
    const monthSelect = document.getElementById('monthFilter');

    // Tahun: jika opsi tahun saat ini belum ada, tambahkan
    if (!yearSelect.querySelector(`option[value="${currentYear}"]`)) {
        const opt = document.createElement('option');
        opt.value = currentYear;
        opt.textContent = currentYear;
        // Sisipkan pada urutan yang benar
        const opts = [...yearSelect.options].map(o => parseInt(o.value));
        const insertBefore = [...yearSelect.options].find(o => parseInt(o.value) > parseInt(currentYear));
        insertBefore
            ? yearSelect.insertBefore(opt, insertBefore)
            : yearSelect.appendChild(opt);
    }

    yearSelect.value  = currentYear;
    monthSelect.value = currentMonth;
}

// ==========================================
// SET PORT DEFAULT KE INPUT (nama) & PASTIKAN KODE DIPAKAI KE BACKEND
// ==========================================
function setDefaultPortInput() {
    // Cari entri port berdasarkan kode yang ada di APP_CONFIG
    const portInfo = PORT_LIST.find(p =>
        p.kode_pelabuhan.toUpperCase() === (APP_CONFIG.DEFAULT_PORT_CODE || '').toUpperCase()
    );

    const input = document.getElementById('portNameInput');
    if (!input) return;

    if (portInfo) {
        // Selalu isi dengan NAMA pelabuhan supaya datalist match
        input.value = portInfo.nama_pelabuhan.toUpperCase();
    } else if (APP_CONFIG.DEFAULT_PORT_CODE) {
        // Fallback: kode tidak ditemukan di port.json, isi kode apa adanya
        input.value = APP_CONFIG.DEFAULT_PORT_CODE;
    }
}

// ==========================================
// INIT
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Set bulan & tahun ke waktu saat ini
    setCurrentPeriod();

    // 2. Baca config dari localStorage spesifik untuk akun yang sedang login
    const configKey = `inaportnet_config_${sessionDataObj?.username || 'default'}`;
    const savedConfig = localStorage.getItem(configKey) || localStorage.getItem('inaportnet_config');
    if (savedConfig) {
        try { APP_CONFIG = { ...APP_CONFIG, ...JSON.parse(savedConfig) }; } catch(e) {}
    }

    // 3. Override DEFAULT_PORT_CODE dari session user jika ada
    if (sessionDataObj && sessionDataObj.default_port) {
        APP_CONFIG.DEFAULT_PORT_CODE = sessionDataObj.default_port;
    }

    // 4. Load daftar pelabuhan dari port.json
    await loadPortData();

    // 5. Setelah PORT_LIST tersedia dan APP_CONFIG sudah benar, set input port
    setDefaultPortInput();

    // 6. Inisiasi datalist (untuk autocomplete)
    initPortDatalist();

    // 7. Event listener modal
    document.getElementById('detailModal').addEventListener('click', function(e) {
        if (e.target.id === 'detailModal') window.closeDetailModal();
    });
    document.getElementById('settingsModal').addEventListener('click', function(e) {
        if (e.target.id === 'settingsModal') window.closeSettingsModal();
    });

    // 8. Tampilkan nama & username dari session + config
    if (sessionDataObj) {
        const name     = sessionDataObj.name     || sessionDataObj.username || '';
        const username = sessionDataObj.username || '';
        const dnEl = document.getElementById('displayName');
        const unEl = document.getElementById('displayUsername');
        if (dnEl) dnEl.textContent = escHTML(name || username);
        if (unEl) unEl.textContent = escHTML(username);
    }

    // 9. Mulai monitor sesi
    startSessionMonitor();

    // 10. Load data — portCode sudah pasti benar karena config & port list sudah siap
    window.loadData();
});
