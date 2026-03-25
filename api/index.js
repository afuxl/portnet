import { google } from 'googleapis';

/**
 * ==============================================================
 * INISIALISASI GOOGLE SHEETS API
 * Environment Variables yang diperlukan di Vercel:
 * GOOGLE_CLIENT_EMAIL  — email service account
 * GOOGLE_PRIVATE_KEY   — private key (dengan \n literal)
 * SPREADSHEET_ID       — ID spreadsheet Google Sheets
 * MODE_TESTING         — opsional: 'true' / 'false'
 * ==============================================================
 */
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  },
  scopes: SCOPES,
});
const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// ================================================================
// UTILITAS
// ================================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatDate(date, format) {
  const options = {
    timeZone: 'Asia/Makassar',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  };
  const parts = {};
  new Intl.DateTimeFormat('id-ID', options).formatToParts(date)
    .forEach(({ type, value }) => { parts[type] = value; });

  if (format === 'yyyy-MM-dd')         return `${parts.year}-${parts.month}-${parts.day}`;
  if (format === 'yyyy-MM-dd HH:mm:ss') return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
  if (format === 'yyyy')               return parts.year;
  if (format === 'MM')                 return parts.month;
  return date.toISOString();
}

function _tglString(dateString) {
  // Prefix 'tgl:' mencegah Google Sheets mengubah string menjadi tipe Date
  return 'tgl:' + dateString;
}

function _parseTgl(raw) {
  if (raw instanceof Date) return formatDate(raw, 'yyyy-MM-dd HH:mm:ss');
  const s = String(raw).trim();
  return s.startsWith('tgl:') ? s.substring(4) : s;
}

function _parseTglDate(raw) {
  const full = _parseTgl(raw);
  return full ? full.substring(0, 10) : '';
}

// ================================================================
// HELPER GOOGLE SHEETS API
// ================================================================

async function getSheetValues(range) {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
    return res.data.values || [];
  } catch (error) {
    console.error(`getSheetValues(${range}):`, error.message);
    return [];
  }
}

async function getSheetId(sheetName) {
  const res = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheet = res.data.sheets.find(s => s.properties.title === sheetName);
  return sheet ? sheet.properties.sheetId : null;
}

async function createSheetIfNotExists(sheetName, headers) {
  const sheetId = await getSheetId(sheetName);
  if (sheetId !== null) return; // sudah ada, tidak perlu dibuat
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] }
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [headers] }
    });
  } catch (e) {
    console.error('createSheetIfNotExists:', e.message);
  }
}

// ================================================================
// KONFIGURASI
// ================================================================

async function getConfig() {
  await createSheetIfNotExists('CONFIG', ['Kunci', 'Nilai', 'Keterangan']);
  const data = await getSheetValues('CONFIG!A:C');
  const configObj = {};
  for (let i = 1; i < data.length; i++) {
    const key   = data[i][0];
    const value = data[i][1];
    if (key) configObj[key] = String(value ?? '').trim();
  }
  if (Object.keys(configObj).length === 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'CONFIG!A:C',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          ['DEFAULT_PORT_CODE', 'ID***', 'Kode Pelabuhan default'],
          ['USE_SCRAPING',      'FALSE', 'Gunakan Scraping (TRUE/FALSE)']
        ]
      }
    });
    return { DEFAULT_PORT_CODE: 'ID***', USE_SCRAPING: 'FALSE' };
  }
  return configObj;
}

async function updateConfig(newConfig) {
  const data = await getSheetValues('CONFIG!A:C');
  const requests      = [];
  const rowsToAppend  = [];
  const sheetId       = await getSheetId('CONFIG');

  for (const key in newConfig) {
    let found = false;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === key) {
        requests.push({
          updateCells: {
            range: { sheetId, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 1, endColumnIndex: 2 },
            rows: [{ values: [{ userEnteredValue: { stringValue: String(newConfig[key]) } }] }],
            fields: 'userEnteredValue'
          }
        });
        found = true;
        break;
      }
    }
    if (!found) rowsToAppend.push([key, newConfig[key], 'Ditambahkan secara dinamis']);
  }

  if (requests.length > 0)
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests } });
  if (rowsToAppend.length > 0)
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID, range: 'CONFIG!A:C',
      valueInputOption: 'USER_ENTERED', requestBody: { values: rowsToAppend }
    });
}

// ================================================================
// MANAJEMEN PENGGUNA
// ================================================================

async function getAllUsers() {
  await createSheetIfNotExists('USERS', ['username', 'password', 'nama', 'role', 'aktif', 'default_port']);
  const values = await getSheetValues('USERS!A:F');
  const users  = [];

  // [BUG FIX] Jika sheet masih kosong (hanya header), buat akun admin default
  // yang benar — sebelumnya menyimpan ' ' (spasi) sebagai username & password
  if (values.length <= 1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID, range: 'USERS!A:F',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['admin', '*********', 'Administrator', 'admin', 'TRUE', '']] }
    });
    users.push({ username: 'admin', nama: 'Administrator', role: 'admin', aktif: true, default_port: '', _row: 2 });
    return users;
  }

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    // Lewati baris yang username-nya kosong atau hanya spasi (sisa bug lama)
    if (!row[0] || !String(row[0]).trim()) continue;
    users.push({
      username:     String(row[0]).trim(),
      nama:         String(row[2] ?? '').trim(),
      role:         String(row[3] ?? '').trim(),
      aktif:        String(row[4] ?? '').trim().toUpperCase() === 'TRUE',
      default_port: String(row[5] ?? '').trim(),
      _row:         i + 1
    });
  }
  return users;
}

async function findUser(username) {
  await createSheetIfNotExists('USERS', ['username', 'password', 'nama', 'role', 'aktif', 'default_port']);
  const values = await getSheetValues('USERS!A:F');
  for (let i = 1; i < values.length; i++) {
    const u = String(values[i][0] ?? '').trim();
    if (!u) continue; // lewati baris username kosong/spasi
    if (u.toLowerCase() === username.toLowerCase()) {
      return {
        username:     u,
        password:     String(values[i][1] ?? '').trim(),
        nama:         String(values[i][2] ?? '').trim(),
        role:         String(values[i][3] ?? '').trim(),
        aktif:        String(values[i][4] ?? '').trim().toUpperCase() === 'TRUE',
        default_port: String(values[i][5] ?? '').trim(),
        _row:         i + 1
      };
    }
  }
  return null;
}

async function saveUser(userData, isNew) {
  if (isNew) {
    const row = [
      userData.username,
      userData.password     || '',
      userData.nama         || '',
      userData.role         || 'user',
      userData.aktif !== false ? 'TRUE' : 'FALSE',
      userData.default_port || ''
    ];
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID, range: 'USERS!A:F',
      valueInputOption: 'USER_ENTERED', requestBody: { values: [row] }
    });
  } else {
    const values  = await getSheetValues('USERS!A:F');
    const sheetId = await getSheetId('USERS');
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][0] ?? '').trim().toLowerCase() !== userData.username.toLowerCase()) continue;
      const row = [
        userData.username,
        userData.password     ? userData.password                               : String(values[i][1] ?? '').trim(),
        userData.nama         !== undefined ? userData.nama                     : String(values[i][2] ?? '').trim(),
        userData.role         !== undefined ? userData.role                     : String(values[i][3] ?? '').trim(),
        userData.aktif        !== undefined ? (userData.aktif !== false ? 'TRUE' : 'FALSE') : String(values[i][4] ?? '').trim(),
        userData.default_port !== undefined ? userData.default_port             : String(values[i][5] ?? '').trim()
      ];
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{
            updateCells: {
              range: { sheetId, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 0, endColumnIndex: 6 },
              rows: [{ values: row.map(val => ({ userEnteredValue: { stringValue: String(val) } })) }],
              fields: 'userEnteredValue'
            }
          }]
        }
      });
      return;
    }
  }
}

async function deleteUser(username) {
  const values  = await getSheetValues('USERS!A:F');
  const sheetId = await getSheetId('USERS');
  // Iterasi dari bawah agar index tidak bergeser saat hapus
  for (let i = values.length - 1; i >= 1; i--) {
    if (String(values[i][0] ?? '').trim().toLowerCase() === username.toLowerCase()) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: i, endIndex: i + 1 } } }]
        }
      });
      return true;
    }
  }
  return false;
}

// ================================================================
// MANAJEMEN CACHE
// ================================================================

async function simpanKeCacheData(sheetName, key, dataString, dateString) {
  const CHUNK_SIZE = 45000;
  await createSheetIfNotExists(sheetName, ['Cache_Key_ID', 'JSON_Data', 'Tanggal_Fetch', 'Chunk_Index']);

  const chunks = [];
  for (let i = 0; i < dataString.length; i += CHUNK_SIZE)
    chunks.push(dataString.substring(i, i + CHUNK_SIZE));

  const values  = await getSheetValues(`${sheetName}!A:D`);
  const sheetId = await getSheetId(sheetName);

  // Kumpulkan baris lama yang perlu dihapus
  const rowsToDelete = [];
  for (let i = values.length - 1; i >= 1; i--) {
    const rowKey = String(values[i][0] ?? '').trim();
    if (rowKey === key || rowKey.startsWith(key + '|')) rowsToDelete.push(i);
  }

  // [BUG FIX] Urutkan dari BESAR ke KECIL agar penghapusan tidak menggeser index
  // Sebelumnya dikirim tanpa diurutkan, sehingga index bergeser dan chunk yang
  // salah bisa terhapus jika ada lebih dari 1 chunk.
  rowsToDelete.sort((a, b) => b - a);

  if (rowsToDelete.length > 0) {
    // Kirim satu per satu agar urutan descending benar-benar dipatuhi
    for (const rowIdx of rowsToDelete) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{
            deleteDimension: {
              range: { sheetId, dimension: 'ROWS', startIndex: rowIdx, endIndex: rowIdx + 1 }
            }
          }]
        }
      });
    }
  }

  const tglSimpan = _tglString(dateString);
  const newRows   = chunks.map((chunk, idx) => [key + '|' + (idx + 1), chunk, tglSimpan, idx + 1]);
  if (newRows.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:D`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: newRows }
    });
  }
  console.log(`Cache disimpan: ${key} | ${chunks.length} chunk(s) | ${dateString}`);
}

async function _bacaCacheByKey(sheetName, key, filterTanggal) {
  try {
    const values = await getSheetValues(`${sheetName}!A:D`);
    if (values.length === 0) return null;

    const chunkMap = {};
    let tanggalDitemukan = null;

    for (let i = 1; i < values.length; i++) {
      const rowKey = String(values[i][0] ?? '').trim();
      let chunkIdx = -1;

      if (rowKey === key) {
        chunkIdx = 0; // format lama (tanpa pipe) — tetap toleran
      } else if (rowKey.startsWith(key + '|')) {
        chunkIdx = parseInt(rowKey.substring(key.length + 1));
        if (isNaN(chunkIdx)) continue;
      }
      if (chunkIdx === -1) continue;

      const tglFull = _parseTgl(values[i][2]);
      const tglDate = _parseTglDate(values[i][2]);
      if (filterTanggal && tglDate !== filterTanggal) continue;

      chunkMap[chunkIdx] = String(values[i][1] ?? '');
      tanggalDitemukan   = tglFull;
    }

    if (Object.keys(chunkMap).length === 0) return null;

    const sortedIdx = Object.keys(chunkMap).map(Number).sort((a, b) => a - b);
    const full      = sortedIdx.map(k => chunkMap[k]).join('');
    return { data: full, fetched_at: tanggalDitemukan || '' };

  } catch (e) {
    console.error('_bacaCacheByKey error:', e.message);
    return null;
  }
}

async function cekCacheValidData(sheetName, key, todayString) {
  return _bacaCacheByKey(sheetName, key, todayString);
}

async function bacaCacheUsangData(sheetName, key) {
  return _bacaCacheByKey(sheetName, key, null);
}

// ================================================================
// HELPER: merge LK3 cache ke data JSON (dipakai di 2 tempat)
// ================================================================
async function _mergeLK3(data, cacheKey, todayString) {
  // [BUG FIX] Akses .data secara konsisten — lk3RawObj selalu berupa
  // object {data, fetched_at}, bukan string. Kode lama: JSON.parse(lk3RawObj.data || lk3RawObj)
  // yang tidak benar karena lk3RawObj tidak pernah string.
  const lk3RawObj = await cekCacheValidData('CACHE_LK3', cacheKey, todayString)
                 || await bacaCacheUsangData('CACHE_LK3', cacheKey);
  if (!lk3RawObj) return data;

  try {
    const lk3Arr = JSON.parse(lk3RawObj.data); // .data adalah string JSON
    const xlsMap = {};
    if (lk3Arr && lk3Arr.length > 2) {
      for (let li = 2; li < lk3Arr.length; li++) {
        const lrow = lk3Arr[li];
        if (!lrow || lrow.length <= 1) continue;
        const lpkk = String(lrow[1] ?? '').trim();
        if (!lpkk || lpkk === '-') continue;
        if (!xlsMap[lpkk]) xlsMap[lpkk] = { detail_bongkar: [], detail_muat: [] };

        const lbk = String(lrow[24] ?? '').trim();
        if (lbk && lbk !== '-') xlsMap[lpkk].detail_bongkar.push({
          komoditi: lbk,                           jenis: String(lrow[25] ?? '').trim(),
          ton:  String(lrow[26] ?? '-').trim(),    m3:   String(lrow[27] ?? '-').trim(),
          unit: String(lrow[28] ?? '-').trim(),    orang:String(lrow[29] ?? '-').trim()
        });
        const lmu = String(lrow[30] ?? '').trim();
        if (lmu && lmu !== '-') xlsMap[lpkk].detail_muat.push({
          komoditi: lmu,                           jenis: String(lrow[31] ?? '').trim(),
          ton:  String(lrow[32] ?? '-').trim(),    m3:   String(lrow[33] ?? '-').trim(),
          unit: String(lrow[34] ?? '-').trim(),    orang:String(lrow[35] ?? '-').trim()
        });
      }
    }
    return data.map(item => {
      const pk = item.nomor_pkk ? String(item.nomor_pkk).trim() : '';
      const x  = xlsMap[pk];
      if (x) { item.detail_bongkar = x.detail_bongkar; item.detail_muat = x.detail_muat; }
      return item;
    });
  } catch (e) {
    console.error('_mergeLK3 gagal:', e.message);
    return data;
  }
}

// ================================================================
// HELPER: mapping XLS array → xlsMap object
// ================================================================
function _buildXlsMap(xlsDataArray) {
  const xlsMap = {};
  if (!xlsDataArray || xlsDataArray.length <= 2) return xlsMap;

  for (let i = 2; i < xlsDataArray.length; i++) {
    const row    = xlsDataArray[i];
    if (!row || row.length <= 1) continue;
    const pkkKey = String(row[1] ?? '').trim();
    if (!pkkKey || pkkKey === '-') continue;

    if (!xlsMap[pkkKey]) {
      xlsMap[pkkKey] = {
        perusahaan:            String(row[5]  ?? '-').trim(),
        jenis_kapal_xls:       String(row[6]  ?? '-').trim(),
        dr_max_xls:            String(row[10] ?? '-').trim(),
        dr_depan_xls:          String(row[11] ?? '-').trim(),
        dr_belakang_xls:       String(row[12] ?? '-').trim(),
        dr_tengah_xls:         String(row[13] ?? '-').trim(),
        tiba_dari_xls:         String(row[18] ?? '-').trim(),
        tiba_tanggal_xls:      String(row[19] ?? '-').trim(),
        tiba_sandar_xls:       String(row[20] ?? '-').trim(),
        berangkat_ke_xls:      String(row[21] ?? '-').trim(),
        berangkat_tanggal_xls: String(row[22] ?? '-').trim(),
        berangkat_tolak_xls:   String(row[23] ?? '-').trim(),
        waktu_respon_xls:      String(row[40] ?? '-').trim(),
        detail_bongkar: [], detail_muat: []
      };
    } else {
      const cu = (field, col) => {
        const v = String(row[col] ?? '').trim();
        if (v && v !== '-' && (xlsMap[pkkKey][field] === '-' || xlsMap[pkkKey][field] === ''))
          xlsMap[pkkKey][field] = v;
      };
      cu('perusahaan',5); cu('jenis_kapal_xls',6);
      cu('dr_max_xls',10); cu('dr_depan_xls',11); cu('dr_belakang_xls',12); cu('dr_tengah_xls',13);
      cu('tiba_dari_xls',18); cu('tiba_tanggal_xls',19); cu('tiba_sandar_xls',20);
      cu('berangkat_ke_xls',21); cu('berangkat_tanggal_xls',22); cu('berangkat_tolak_xls',23);
      cu('waktu_respon_xls',40);
    }

    const bk = String(row[24] ?? '').trim();
    if (bk && bk !== '-') xlsMap[pkkKey].detail_bongkar.push({
      komoditi: bk,                          jenis: String(row[25] ?? '').trim(),
      ton:  String(row[26] ?? '-').trim(),   m3:   String(row[27] ?? '-').trim(),
      unit: String(row[28] ?? '-').trim(),   orang:String(row[29] ?? '-').trim()
    });
    const mu = String(row[30] ?? '').trim();
    if (mu && mu !== '-') xlsMap[pkkKey].detail_muat.push({
      komoditi: mu,                          jenis: String(row[31] ?? '').trim(),
      ton:  String(row[32] ?? '-').trim(),   m3:   String(row[33] ?? '-').trim(),
      unit: String(row[34] ?? '-').trim(),   orang:String(row[35] ?? '-').trim()
    });
  }
  return xlsMap;
}

// ================================================================
// IMPOR DATA XLS DARI HTML TABLE
// ================================================================
async function IMPORTHTMLXLS(url) {
  if (!url) throw new Error('URL diperlukan');
  const MAX_RETRIES = 7;
  const RETRY_DELAY = 3000;

  async function fetchWithRetries(targetUrl, retries) {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        // [FIX] Tambah AbortController timeout 25 detik — native fetch tidak punya
        // timeout bawaan, bisa hang selamanya hingga Vercel function timeout.
        const controller = new AbortController();
        const timer      = setTimeout(() => controller.abort(), 30000);
        const response   = await fetch(targetUrl, {
          signal: controller.signal,
          headers: {
            'Accept':                  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Encoding':         'gzip, deflate, br, zstd',
            'Accept-Language':         'id,en-US;q=0.9,en;q=0.8',
            'Connection':              'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'User-Agent':              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36'
          }
        });
        clearTimeout(timer);
        if (response.ok) return await response.text();
        throw new Error('HTTP ' + response.status);
      } catch (e) {
        if (attempt >= retries - 1) throw new Error(`Gagal setelah ${retries} percobaan: ${e.message}`);
        await sleep(RETRY_DELAY);
      }
    }
  }

  try {
    const htmlContent = await fetchWithRetries(url, MAX_RETRIES);
    const clean = s => s
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');

    // Parse <thead>
    const theadMatch = htmlContent.match(/<thead[\s\S]*?<\/thead>/i);
    const theadHTML  = theadMatch ? theadMatch[0] : '';
    const headers    = [];
    [...theadHTML.matchAll(/<tr[\s\S]*?<\/tr>/gi)].forEach((row, rowIndex) => {
      if (!headers[rowIndex]) headers[rowIndex] = [];
      let cellIndex = 0;
      [...row[0].matchAll(/<t[dh][^>]*?>[\s\S]*?<\/t[dh]>/gi)].forEach(cell => {
        while (headers[rowIndex][cellIndex]) cellIndex++;
        const content  = clean(cell[0]);
        const colspan  = parseInt((cell[0].match(/colspan="(\d+)"/i)||[,'1'])[1]);
        const rowspan  = parseInt((cell[0].match(/rowspan="(\d+)"/i)||[,'1'])[1]);
        headers[rowIndex][cellIndex] = content;
        for (let ci = 1; ci < colspan; ci++) headers[rowIndex][cellIndex + ci] = content;
        for (let ri = 1; ri < rowspan; ri++) {
          if (!headers[rowIndex + ri]) headers[rowIndex + ri] = [];
          headers[rowIndex + ri][cellIndex] = ' ';
        }
        cellIndex++;
      });
    });

    // Parse <tbody>
    const tbodyMatch = htmlContent.match(/<tbody[\s\S]*?<\/tbody>/i);
    const tbodyHTML  = tbodyMatch ? tbodyMatch[0] : '';
    const data       = [];
    [...tbodyHTML.matchAll(/<tr[\s\S]*?<\/tr>/gi)].forEach((row, rowIndex) => {
      if (!data[rowIndex]) data[rowIndex] = [];
      let cellIndex = 0;
      [...row[0].matchAll(/<t[dh][^>]*?>[\s\S]*?<\/t[dh]>/gi)].forEach(cell => {
        while (data[rowIndex][cellIndex]) cellIndex++;
        let content = clean(cell[0]);
        if (/^\d+\.\d+$/.test(content.trim()))
          content = parseFloat(content).toLocaleString('id-ID', { minimumFractionDigits: 2 });
        const rowspan = parseInt((cell[0].match(/rowspan="(\d+)"/i)||[,'1'])[1]);
        data[rowIndex][cellIndex] = content;
        if (rowspan > 1) {
          for (let ri = 1; ri < rowspan; ri++) {
            if (!data[rowIndex + ri]) data[rowIndex + ri] = [];
            // Hanya kolom 0 (no urut) dan 1 (PKK) yang direplikasi ke bawah
            data[rowIndex + ri][cellIndex] = cellIndex <= 1 ? content : ' ';
          }
        }
        cellIndex++;
      });
    });

    return [...headers, ...data];
  } catch (e) {
    return [['Error:', e.message]];
  }
}

// ================================================================
// ENDPOINT UTAMA VERCEL
// ================================================================
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // [FIX] Tambahkan header anti-cache agar Vercel CDN / Browser tidak menyimpan respons GET
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── POST: Login & manajemen user/config ──────────────────────
  if (req.method === 'POST') {
    try {
      const postData = req.body;

      if (postData.action === 'login') {
        const user = await findUser(postData.username || '');
        if (!user)       return res.status(200).json({ status: 'error', message: 'Username tidak ditemukan.' });
        if (!user.aktif) return res.status(200).json({ status: 'error', message: 'Akun tidak aktif.' });
        if (user.password !== postData.password)
          return res.status(200).json({ status: 'error', message: 'Password salah!' });

        const config = await getConfig();
        return res.status(200).json({
          status:       'success',
          message:      'Login berhasil',
          config,
          username:     user.username,
          nama:         user.nama,
          role:         user.role,
          default_port: user.default_port || config.DEFAULT_PORT_CODE || ''
        });
      }

      if (postData.action === 'updateConfig') {
        const incoming = postData.config || {};
        if ('AUTH_PASSWORD' in incoming && incoming.AUTH_PASSWORD === '') delete incoming.AUTH_PASSWORD;
        await updateConfig(incoming);
        return res.status(200).json({ status: 'success', message: 'Konfigurasi berhasil disimpan.' });
      }

      if (postData.action === 'getUsers') {
        const users = await getAllUsers();
        return res.status(200).json({ status: 'success', users });
      }

      if (postData.action === 'saveUser') {
        const u = postData.user || {};
        if (!u.username) throw new Error('Username wajib diisi.');
        const existing = await findUser(u.username);
        if (!existing && !u.password) throw new Error('Password wajib untuk akun baru.');
        await saveUser(u, !existing);
        return res.status(200).json({ status: 'success', message: existing ? 'Akun diperbarui.' : 'Akun baru dibuat.' });
      }

      if (postData.action === 'deleteUser') {
        if (!postData.username) throw new Error('Username wajib diisi.');
        const ok = await deleteUser(postData.username);
        return res.status(200).json({
          status:  ok ? 'success' : 'error',
          message: ok ? 'Akun dihapus.' : 'Akun tidak ditemukan.'
        });
      }

      return res.status(400).json({ status: 'error', message: 'Action tidak dikenali.' });

    } catch (error) {
      return res.status(500).json({ status: 'error', message: error.message });
    }
  }

  // ── GET: Ambil data dashboard ─────────────────────────────────
  if (req.method === 'GET') {
    const portCode = req.query.portCode || '';
    const year     = req.query.year  || formatDate(new Date(), 'yyyy');
    const month    = req.query.month || formatDate(new Date(), 'MM');

    // [BARU] Strategi fetch — dikirim dari frontend (main.js)
    // 'live_first'  : fetch live dulu, cache hanya jika live gagal (default lama)
    // 'cache_first' : pakai cache jika ada (hari ini atau usang), live hanya jika cache kosong
    const strategy    = req.query.strategy || 'live_first';

    const cacheKey    = `${portCode}_${year}_${month}`;
    const todayString = formatDate(new Date(), 'yyyy-MM-dd');
    const timestamp   = Date.now();

    // ── Mode Testing ──────────────────────────────────────────
    // [FIX] Jangan gunakan mode testing (yang memaksa membaca cache) jika pengguna secara eksplisit meminta live_first
    if (process.env.MODE_TESTING === 'true' && strategy !== 'live_first') {
      const rawObj = await bacaCacheUsangData('CACHE_JSON', cacheKey);
      if (!rawObj) return res.status(200).json({ status: 'error', message: 'Tidak ada data cache untuk mode testing.' });
      const parsed = JSON.parse(rawObj.data);
      const data   = Array.isArray(parsed) ? parsed : (parsed.data || []);
      return res.status(200).json({ status: 'success', source: 'cache_testing', data, fetched_at: rawObj.fetched_at || todayString });
    }

    // ── Strategi: cache_first ────────────────────────────────
    // Terima cache APA SAJA yang ada (hari ini ATAU usang/kemarin).
    // Live fetch hanya dijalankan jika tidak ada cache sama sekali.
    if (strategy === 'cache_first') {
      const cacheObj = await cekCacheValidData('CACHE_JSON', cacheKey, todayString)
                    || await bacaCacheUsangData('CACHE_JSON', cacheKey);
      if (cacheObj) {
        try {
          const parsed = JSON.parse(cacheObj.data);
          let data     = Array.isArray(parsed) ? parsed : (parsed.data || []);
          data         = await _mergeLK3(data, cacheKey, todayString);
          // Bedakan badge: cache hari ini vs cache usang
          const isToday = cacheObj.fetched_at && cacheObj.fetched_at.substring(0,10) === todayString;
          const src     = isToday ? 'cache_hari_ini' : 'stale_cache';
          console.log(`GET cache_first HIT (${src}). [${cacheKey}]`);
          return res.status(200).json({ status: 'success', source: src, data, fetched_at: cacheObj.fetched_at || todayString });
        } catch (e) {
          console.error('cache_first parse gagal, lanjut live fetch:', e.message);
        }
      }
      // Tidak ada cache sama sekali → jatuh ke live fetch di bawah
      console.log(`GET cache_first MISS — cache kosong, mulai live fetch. [${cacheKey}]`);
    }

    // ── [2] Live fetch JSON + XLS ─────────────────────────────
    console.log(`GET MISS/live — mulai fetch. [${cacheKey}]`);
    let jsonData     = [];
    let xlsDataArray = [];

    try {
      const jsonUrl = `https://monitoring-inaportnet.dephub.go.id/monitoring/byPort/list/${portCode}/dn/${year}/${month}?_=${timestamp}`;
      const xlsUrl  = `https://monitoring-inaportnet.dephub.go.id/report/lk3/${portCode}/dn/${year}/${month}`;

      // [FIX] Tambah AbortController timeout 25 detik untuk fetch JSON
      const jsonCtrl  = new AbortController();
      const jsonTimer = setTimeout(() => jsonCtrl.abort(), 25000);
      const respJson  = await fetch(jsonUrl, {
        signal: jsonCtrl.signal,
        headers: {
          'Accept':      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'User-Agent':  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36'
        }
      });
      clearTimeout(jsonTimer);
      if (!respJson.ok) throw new Error('HTTP ' + respJson.status);

      const parsedJson = await respJson.json();
      jsonData = Array.isArray(parsedJson) ? parsedJson : (Array.isArray(parsedJson.data) ? parsedJson.data : []);
      if (jsonData.length === 0) throw new Error('Data JSON kosong dari server.');
      console.log(`Fetch JSON OK: ${jsonData.length} record.`);

      try {
        xlsDataArray = await IMPORTHTMLXLS(xlsUrl);
        if (xlsDataArray && xlsDataArray.length > 2) {
          await simpanKeCacheData('CACHE_LK3', cacheKey, JSON.stringify(xlsDataArray), todayString);
          console.log(`Fetch XLS OK: ${xlsDataArray.length} baris.`);
        }
      } catch (xlsErr) {
        console.error('XLS gagal, lanjut tanpa LK3:', xlsErr.message);
        xlsDataArray = [];
      }

    } catch (fetchErr) {
      // ── [3] Fetch gagal → fallback cache usang ─────────────
      console.error('Fetch gagal:', fetchErr.message);
      const staleObj = await bacaCacheUsangData('CACHE_JSON', cacheKey);
      if (staleObj) {
        try {
          const staleParsed = JSON.parse(staleObj.data);
          const staleData   = Array.isArray(staleParsed) ? staleParsed : (staleParsed.data || []);
          return res.status(200).json({
            status: 'success', source: 'stale_cache',
            message: `Fetch gagal, menampilkan data terakhir: ${fetchErr.message}`,
            data: staleData, fetched_at: staleObj.fetched_at || todayString
          });
        } catch (e) { /* tidak bisa parse stale, lanjut error */ }
      }
      return res.status(500).json({ status: 'error', source: 'no_cache', message: fetchErr.message });
    }

    // ── Mapping & Merge XLS ke JSON ───────────────────────────
    const xlsMap    = _buildXlsMap(xlsDataArray);
    const mergedData = jsonData.map(item => {
      const pk = item.nomor_pkk ? String(item.nomor_pkk).trim() : '';
      const x  = xlsMap[pk] || {};
      if (x.tiba_dari_xls          && x.tiba_dari_xls          !== '-') item.pelabuhan_asal   = x.tiba_dari_xls;
      if (x.tiba_tanggal_xls       && x.tiba_tanggal_xls       !== '-') item.eta              = x.tiba_tanggal_xls;
      if (x.tiba_sandar_xls        && x.tiba_sandar_xls        !== '-') item.lokasi_sandar    = x.tiba_sandar_xls;
      if (x.berangkat_ke_xls       && x.berangkat_ke_xls       !== '-') item.pelabuhan_tujuan = x.berangkat_ke_xls;
      if (x.berangkat_tanggal_xls  && x.berangkat_tanggal_xls  !== '-') item.etd              = x.berangkat_tanggal_xls;
      if (x.berangkat_tolak_xls    && x.berangkat_tolak_xls    !== '-') item.lokasi_tolak     = x.berangkat_tolak_xls;
      return Object.assign({}, item, x);
    });

    // ── Simpan ke cache & kembalikan ──────────────────────────
    const finalStr = JSON.stringify({ data: mergedData });
    const nowFull  = formatDate(new Date(), 'yyyy-MM-dd HH:mm:ss');
    await simpanKeCacheData('CACHE_JSON', cacheKey, finalStr, nowFull);
    console.log(`GET selesai: ${mergedData.length} kapal | ${finalStr.length} chars | ${cacheKey}`);

    return res.status(200).json({ status: 'success', source: 'live_fetch', data: mergedData, fetched_at: nowFull });
  }

  return res.status(405).json({ status: 'error', message: 'Method tidak diizinkan' });
}
