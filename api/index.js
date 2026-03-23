import { google } from 'googleapis';

/**
 * ==============================================================
 * INISIALISASI GOOGLE SHEETS API
 * Pastikan Environment Variables Vercel telah diatur:
 * - GOOGLE_CLIENT_EMAIL
 * - GOOGLE_PRIVATE_KEY
 * - SPREADSHEET_ID
 * - MODE_TESTING (opsional, set 'true' atau 'false')
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

/**
 * ==============================================================
 * FUNGSI UTILITAS
 * ==============================================================
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatDate(date, format) {
  const options = { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
  const formatter = new Intl.DateTimeFormat('id-ID', options);
  const parts = formatter.formatToParts(date);
  
  const p = {};
  parts.forEach(({ type, value }) => { p[type] = value; });
  
  if (format === 'yyyy-MM-dd') return `${p.year}-${p.month}-${p.day}`;
  if (format === 'yyyy-MM-dd HH:mm:ss') return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
  if (format === 'yyyy') return p.year;
  if (format === 'MM') return p.month;
  return date.toISOString();
}

function _tglString(dateString) {
  return 'tgl:' + dateString;
}

function _parseTgl(raw) {
  if (raw instanceof Date) {
    return formatDate(raw, 'yyyy-MM-dd HH:mm:ss');
  }
  const s = String(raw).trim();
  if (s.startsWith('tgl:')) return s.substring(4);
  return s;
}

function _parseTglDate(raw) {
  const full = _parseTgl(raw);
  return full ? full.substring(0, 10) : '';
}

/**
 * ==============================================================
 * HELPER GOOGLE SHEETS API
 * ==============================================================
 */
async function getSheetValues(range) {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
    return res.data.values || [];
  } catch (error) {
    console.error(`Error getSheetValues (${range}):`, error.message);
    return [];
  }
}

async function getSheetId(sheetName) {
  const res = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheet = res.data.sheets.find(s => s.properties.title === sheetName);
  return sheet ? sheet.properties.sheetId : null;
}

async function createSheetIfNotExists(sheetName, headers) {
  let sheetId = await getSheetId(sheetName);
  if (!sheetId) {
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{ addSheet: { properties: { title: sheetName } } }]
        }
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [headers] }
      });
    } catch (e) {
      console.error('Error createSheet:', e.message);
    }
  }
}

/**
 * ==============================================================
 * FUNGSI MEMBACA & MENYIMPAN KONFIGURASI
 * ==============================================================
 */
async function getConfig() {
  await createSheetIfNotExists('CONFIG', ['Kunci', 'Nilai', 'Keterangan']);
  const data = await getSheetValues('CONFIG!A:C');
  let configObj = {};
  for (let i = 1; i < data.length; i++) {
    const key = data[i][0];
    const value = data[i][1];
    if (key) configObj[key] = String(value).trim();
  }
  // Jika kosong, set default
  if (Object.keys(configObj).length === 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'CONFIG!A:C',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          ['DEFAULT_PORT_CODE', 'IDLPO', 'Kode Pelabuhan default'],
          ['USE_SCRAPING', 'FALSE', 'Gunakan Scraping (TRUE/FALSE)']
        ]
      }
    });
    configObj = { DEFAULT_PORT_CODE: 'IDLPO', USE_SCRAPING: 'FALSE' };
  }
  return configObj;
}

async function updateConfig(newConfig) {
  const data = await getSheetValues('CONFIG!A:C');
  const requests = [];
  const rowsToAppend = [];

  for (let key in newConfig) {
    let found = false;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === key) {
        requests.push({
          updateCells: {
            range: { sheetId: await getSheetId('CONFIG'), startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 1, endColumnIndex: 2 },
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

  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests } });
  }
  if (rowsToAppend.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID, range: 'CONFIG!A:C', valueInputOption: 'USER_ENTERED', requestBody: { values: rowsToAppend }
    });
  }
}

/**
 * ==============================================================
 * MANAJEMEN AKUN PENGGUNA
 * ==============================================================
 */
async function getAllUsers() {
  await createSheetIfNotExists('USERS', ['username', 'password', 'nama', 'role', 'aktif', 'default_port']);
  const values = await getSheetValues('USERS!A:F');
  const users = [];
  
  if (values.length <= 1) {
    // Inject admin default jika kosong
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID, range: 'USERS!A:F', valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['admin', 'password123', 'Administrator', 'admin', 'TRUE', '']] }
    });
    values.push(['admin', 'password123', 'Administrator', 'admin', 'TRUE', '']);
  }

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row[0]) continue;
    users.push({
      username: String(row[0]).trim(),
      nama: String(row[2]).trim(),
      role: String(row[3]).trim(),
      aktif: String(row[4]).trim().toUpperCase() === 'TRUE',
      default_port: String(row[5] || '').trim(),
      _row: i + 1
    });
  }
  return users;
}

async function findUser(username) {
  await createSheetIfNotExists('USERS', ['username', 'password', 'nama', 'role', 'aktif', 'default_port']);
  const values = await getSheetValues('USERS!A:F');
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim().toLowerCase() === username.toLowerCase()) {
      return {
        username: String(values[i][0]).trim(),
        password: String(values[i][1]).trim(),
        nama: String(values[i][2]).trim(),
        role: String(values[i][3]).trim(),
        aktif: String(values[i][4]).trim().toUpperCase() === 'TRUE',
        default_port: String(values[i][5] || '').trim(),
        _row: i + 1
      };
    }
  }
  return null;
}

async function saveUser(userData, isNew) {
  if (isNew) {
    const row = [
      userData.username,
      userData.password || '',
      userData.nama || '',
      userData.role || 'user',
      userData.aktif !== false ? 'TRUE' : 'FALSE',
      userData.default_port || ''
    ];
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID, range: 'USERS!A:F', valueInputOption: 'USER_ENTERED', requestBody: { values: [row] }
    });
  } else {
    const values = await getSheetValues('USERS!A:F');
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][0]).trim().toLowerCase() === userData.username.toLowerCase()) {
        const row = [
          userData.username,
          userData.password ? userData.password : String(values[i][1]).trim(),
          userData.nama !== undefined ? userData.nama : String(values[i][2]).trim(),
          userData.role !== undefined ? userData.role : String(values[i][3]).trim(),
          userData.aktif !== undefined ? (userData.aktif !== false ? 'TRUE' : 'FALSE') : String(values[i][4]).trim(),
          userData.default_port !== undefined ? userData.default_port : String(values[i][5] || '').trim()
        ];
        const sheetId = await getSheetId('USERS');
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
}

async function deleteUser(username) {
  const values = await getSheetValues('USERS!A:F');
  const sheetId = await getSheetId('USERS');
  for (let i = values.length - 1; i >= 1; i--) {
    if (String(values[i][0]).trim().toLowerCase() === username.toLowerCase()) {
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

/**
 * ==============================================================
 * MANAJEMEN CACHE
 * ==============================================================
 */
async function simpanKeCacheData(sheetName, key, dataString, dateString) {
  const CHUNK_SIZE = 45000;
  await createSheetIfNotExists(sheetName, ['Cache_Key_ID', 'JSON_Data', 'Tanggal_Fetch', 'Chunk_Index']);
  
  const chunks = [];
  for (let i = 0; i < dataString.length; i += CHUNK_SIZE) {
    chunks.push(dataString.substring(i, i + CHUNK_SIZE));
  }

  const values = await getSheetValues(`${sheetName}!A:D`);
  const sheetId = await getSheetId(sheetName);
  const deleteRequests = [];

  // Cari baris lama untuk dihapus (dari bawah ke atas)
  for (let i = values.length - 1; i >= 1; i--) {
    const rowKey = String(values[i][0]).trim();
    if (rowKey === key || rowKey.startsWith(key + '|')) {
      deleteRequests.push({
        deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: i, endIndex: i + 1 } }
      });
    }
  }

  if (deleteRequests.length > 0) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: deleteRequests } });
  }

  const tglSimpan = _tglString(dateString);
  const newRows = chunks.map((chunk, idx) => [key + '|' + (idx + 1), chunk, tglSimpan, idx + 1]);

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
      const rowKey = String(values[i][0] || '').trim();

      let chunkIdx = -1;
      if (rowKey === key) {
        chunkIdx = 0;
      } else if (rowKey.startsWith(key + '|')) {
        chunkIdx = parseInt(rowKey.substring(key.length + 1));
        if (isNaN(chunkIdx)) continue;
      }
      if (chunkIdx === -1) continue;

      const tglFull = _parseTgl(values[i][2]);
      const tglDate = _parseTglDate(values[i][2]);
      if (filterTanggal && tglDate !== filterTanggal) continue;

      chunkMap[chunkIdx] = String(values[i][1] || '');
      tanggalDitemukan = tglFull;
    }

    if (Object.keys(chunkMap).length === 0) return null;

    const sortedIdx = Object.keys(chunkMap).map(Number).sort((a, b) => a - b);
    const full = sortedIdx.map(k => chunkMap[k]).join('');

    return { data: full, fetched_at: tanggalDitemukan || '' };
  } catch (e) {
    console.error('_bacaCacheByKey error:', e.message);
    return null;
  }
}

async function cekCacheValidData(sheetName, key, todayString) {
  return await _bacaCacheByKey(sheetName, key, todayString);
}

async function bacaCacheUsangData(sheetName, key) {
  return await _bacaCacheByKey(sheetName, key, null);
}

/**
 * ========================================================================
 * FUNGSI IMPOR DATA XLS DARI HTML TABLE
 * ========================================================================
 */
async function IMPORTHTMLXLS(url) {
  if (!url) throw new Error("URL diperlukan");
  const MAX_RETRIES = 7;
  const RETRY_DELAY = 3000;

  async function fetchWithRetries(url, retries) {
    let attempt = 0;
    while (attempt < retries) {
      try {
        const response = await fetch(url, {
          headers: {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Accept-Encoding": "gzip, deflate, br, zstd",
            "Accept-Language": "id,en-US;q=0.9,en;q=0.8",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"
          }
        });
        if (response.ok) return await response.text();
        throw new Error('HTTP ' + response.status);
      } catch (e) {
        attempt++;
        if (attempt >= retries) throw new Error('Gagal mengambil file setelah ' + retries + ' percobaan: ' + e.message);
        await sleep(RETRY_DELAY);
      }
    }
  }

  try {
    const htmlContent = await fetchWithRetries(url, MAX_RETRIES);

    const theadMatch = htmlContent.match(/<thead[\s\S]*?<\/thead>/i);
    const theadHTML  = theadMatch ? theadMatch[0] : "";
    const headerRows = [...theadHTML.matchAll(/<tr[\s\S]*?<\/tr>/gi)];
    const headers    = [];

    headerRows.forEach((row, rowIndex) => {
      const cells = [...row[0].matchAll(/<t[dh][^>]*?>[\s\S]*?<\/t[dh]>/gi)];
      if (!headers[rowIndex]) headers[rowIndex] = [];
      let cellIndex = 0;
      cells.forEach((cell) => {
        while (headers[rowIndex][cellIndex]) cellIndex++;
        let content = cell[0]
          .replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ")
          .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
        const colspanMatch = cell[0].match(/colspan="(\d+)"/i);
        const colspan = colspanMatch ? parseInt(colspanMatch[1]) : 1;
        const rowspanMatch = cell[0].match(/rowspan="(\d+)"/i);
        const rowspan = rowspanMatch ? parseInt(rowspanMatch[1]) : 1;
        headers[rowIndex][cellIndex] = content;
        if (colspan > 1) {
          for (let i = 1; i < colspan; i++) headers[rowIndex][cellIndex + i] = content;
        }
        if (rowspan > 1) {
          for (let i = 1; i < rowspan; i++) {
            if (!headers[rowIndex + i]) headers[rowIndex + i] = [];
            headers[rowIndex + i][cellIndex] = " ";
          }
        }
        cellIndex++;
      });
    });

    const tbodyMatch = htmlContent.match(/<tbody[\s\S]*?<\/tbody>/i);
    const tbodyHTML  = tbodyMatch ? tbodyMatch[0] : "";
    const rows       = [...tbodyHTML.matchAll(/<tr[\s\S]*?<\/tr>/gi)];
    const data       = [];

    rows.forEach((row, rowIndex) => {
      const cells = [...row[0].matchAll(/<t[dh][^>]*?>[\s\S]*?<\/t[dh]>/gi)];
      if (!data[rowIndex]) data[rowIndex] = [];
      let cellIndex = 0;
      cells.forEach((cell) => {
        while (data[rowIndex][cellIndex]) cellIndex++;
        let content = cell[0]
          .replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ")
          .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
        if (/^\d+\.\d+$/.test(content.trim())) {
          content = parseFloat(content).toLocaleString("id-ID", { minimumFractionDigits: 2 });
        }
        const rowspanMatch = cell[0].match(/rowspan="(\d+)"/i);
        const rowspan = rowspanMatch ? parseInt(rowspanMatch[1]) : 1;
        data[rowIndex][cellIndex] = content;
        if (rowspan > 1) {
          for (let i = 1; i < rowspan; i++) {
            if (!data[rowIndex + i]) data[rowIndex + i] = [];
            if (cellIndex <= 1) {
              data[rowIndex + i][cellIndex] = content;
            } else {
              data[rowIndex + i][cellIndex] = " ";
            }
          }
        }
        cellIndex++;
      });
    });

    return [...headers, ...data];
  } catch (e) {
    return [["Error:", e.message]];
  }
}

/**
 * ==============================================================
 * ENDPOINT UTAMA VERCEL (MENGGANTIKAN doGet & doPost)
 * ==============================================================
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── LOGIKA POST (LOGIN & UPDATE CONFIG) ──
  if (req.method === 'POST') {
    try {
      const postData = req.body;

      if (postData.action === "login") {
        const user = await findUser(postData.username || '');
        if (!user) return res.status(200).json({ status: "error", message: "Username tidak ditemukan." });
        if (!user.aktif) return res.status(200).json({ status: "error", message: "Akun tidak aktif." });
        if (user.password !== postData.password) return res.status(200).json({ status: "error", message: "Password salah!" });
        
        const config = await getConfig();
        return res.status(200).json({
          status: "success", message: "Login berhasil", config: config,
          username: user.username, nama: user.nama, role: user.role,
          default_port: user.default_port || config.DEFAULT_PORT_CODE || 'IDLPO'
        });
      }

      if (postData.action === "updateConfig") {
        const incoming = postData.config || {};
        if ("AUTH_PASSWORD" in incoming && incoming.AUTH_PASSWORD === "") delete incoming.AUTH_PASSWORD;
        await updateConfig(incoming);
        return res.status(200).json({ status: "success", message: "Konfigurasi berhasil disimpan." });
      }

      if (postData.action === "getUsers") {
        const users = await getAllUsers();
        return res.status(200).json({ status: "success", users: users });
      }

      if (postData.action === "saveUser") {
        const u = postData.user || {};
        if (!u.username) throw new Error("Username wajib diisi.");
        const existing = await findUser(u.username);
        if (!existing && !u.password) throw new Error("Password wajib untuk akun baru.");
        await saveUser(u, !existing);
        return res.status(200).json({ status: "success", message: (existing ? "Akun diperbarui." : "Akun baru dibuat.") });
      }

      if (postData.action === "deleteUser") {
        if (!postData.username) throw new Error("Username wajib diisi.");
        const ok = await deleteUser(postData.username);
        return res.status(200).json({ status: ok ? "success" : "error", message: ok ? "Akun dihapus." : "Akun tidak ditemukan." });
      }

      return res.status(400).json({ status: "error", message: "Action tidak dikenali." });
    } catch (error) {
      return res.status(500).json({ status: "error", message: error.message });
    }
  }

  // ── LOGIKA GET (MENARIK DATA DASHBOARD) ──
  if (req.method === 'GET') {
    const portCode = req.query.portCode || 'IDLPO';
    const year     = req.query.year || formatDate(new Date(), 'yyyy');
    const month    = req.query.month || formatDate(new Date(), 'MM');

    const cacheKey    = portCode + '_' + year + '_' + month;
    const todayString = formatDate(new Date(), 'yyyy-MM-dd');
    const timestamp   = new Date().getTime();

    const MODE_TESTING = process.env.MODE_TESTING === 'true';

    // Mode Testing
    if (MODE_TESTING) {
      const rawObj = await bacaCacheUsangData('CACHE_JSON', cacheKey);
      if (!rawObj) return res.status(200).json({ status: 'error', message: 'Tidak ada data cache untuk mode testing.' });
      const parsed = JSON.parse(rawObj.data);
      const data   = Array.isArray(parsed) ? parsed : (parsed.data || []);
      return res.status(200).json({ status: 'success', source: 'cache_testing', data: data, fetched_at: rawObj.fetched_at || todayString });
    }

    // [1] Cache hari ini
    const cachedTodayObj = await cekCacheValidData('CACHE_JSON', cacheKey, todayString);
    if (cachedTodayObj) {
      try {
        const obj = JSON.parse(cachedTodayObj.data);
        let data = Array.isArray(obj) ? obj : (obj.data || []);
        const cachedFetchedAt = cachedTodayObj.fetched_at || todayString;

        const lk3RawObj = await cekCacheValidData('CACHE_LK3', cacheKey, todayString) || await bacaCacheUsangData('CACHE_LK3', cacheKey);
        if (lk3RawObj) {
          try {
            const lk3Arr = JSON.parse(lk3RawObj.data || lk3RawObj);
            const xlsMap = {};
            if (lk3Arr && lk3Arr.length > 2) {
              for (let li = 2; li < lk3Arr.length; li++) {
                const lrow = lk3Arr[li];
                if (!lrow || lrow.length <= 1) continue;
                const lpkk = String(lrow[1] || '').trim();
                if (!lpkk || lpkk === '' || lpkk === '-') continue;
                if (!xlsMap[lpkk]) xlsMap[lpkk] = { detail_bongkar: [], detail_muat: [] };
                
                const lbk = String(lrow[24] || '').trim();
                if (lbk && lbk !== '-') xlsMap[lpkk].detail_bongkar.push({
                  komoditi: lbk, jenis: String(lrow[25] || '').trim(), ton: String(lrow[26] || '-').trim(),
                  m3: String(lrow[27] || '-').trim(), unit: String(lrow[28] || '-').trim(), orang: String(lrow[29] || '-').trim()
                });
                
                const lmu = String(lrow[30] || '').trim();
                if (lmu && lmu !== '-') xlsMap[lpkk].detail_muat.push({
                  komoditi: lmu, jenis: String(lrow[31] || '').trim(), ton: String(lrow[32] || '-').trim(),
                  m3: String(lrow[33] || '-').trim(), unit: String(lrow[34] || '-').trim(), orang: String(lrow[35] || '-').trim()
                });
              }
            }
            data = data.map(item => {
              const pk = item.nomor_pkk ? String(item.nomor_pkk).trim() : '';
              const x = xlsMap[pk];
              if (x) { item.detail_bongkar = x.detail_bongkar; item.detail_muat = x.detail_muat; }
              return item;
            });
          } catch(lk3Err) { console.error('Re-merge LK3 gagal:', lk3Err.message); }
        }
        return res.status(200).json({ status: 'success', source: 'cache_hari_ini', data: data, fetched_at: cachedFetchedAt });
      } catch (parseErr) { console.error('Parse cache gagal, lanjut fetch:', parseErr.message); }
    }

    // [2] Cache miss -> fetch JSON + XLS
    let jsonData = [];
    let xlsDataArray = [];

    try {
      const jsonUrl = `https://monitoring-inaportnet.dephub.go.id/monitoring/byPort/list/${portCode}/dn/${year}/${month}?_=${timestamp}`;
      const xlsUrl  = `https://monitoring-inaportnet.dephub.go.id/report/lk3/${portCode}/dn/${year}/${month}`;

      const respJson = await fetch(jsonUrl, {
        headers: {
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"
        }
      });
      if (!respJson.ok) throw new Error('HTTP ' + respJson.status);

      const parsedJson = await respJson.json();
      jsonData = Array.isArray(parsedJson) ? parsedJson : (Array.isArray(parsedJson.data) ? parsedJson.data : []);
      if (jsonData.length === 0) throw new Error('Data JSON kosong dari server.');

      try {
        xlsDataArray = await IMPORTHTMLXLS(xlsUrl);
        if (xlsDataArray && xlsDataArray.length > 0) {
          await simpanKeCacheData('CACHE_LK3', cacheKey, JSON.stringify(xlsDataArray), todayString);
        }
      } catch (xlsErr) { console.error('XLS gagal:', xlsErr.message); }

    } catch (fetchErr) {
      // [3] Fetch gagal -> fallback cache kemarin
      const staleObj = await bacaCacheUsangData('CACHE_JSON', cacheKey);
      if (staleObj) {
        try {
          const staleParsed = JSON.parse(staleObj.data);
          const staleData = Array.isArray(staleParsed) ? staleParsed : (staleParsed.data || []);
          return res.status(200).json({ status: 'success', source: 'stale_cache', message: 'Fetch gagal, menampilkan data terakhir: ' + fetchErr.message, data: staleData, fetched_at: staleObj.fetched_at || todayString });
        } catch(e) {}
      }
      return res.status(500).json({ status: 'error', source: 'no_cache', message: fetchErr.message });
    }

    // Mapping XLS -> xlsMap
    const xlsMap = {};
    if (xlsDataArray && xlsDataArray.length > 2) {
      for (let i = 2; i < xlsDataArray.length; i++) {
        const row = xlsDataArray[i];
        if (!row || row.length <= 1) continue;
        const pkk = row[1];
        if (!pkk || String(pkk).trim() === '' || String(pkk).trim() === '-') continue;
        const pkkKey = String(pkk).trim();
        
        if (!xlsMap[pkkKey]) {
          xlsMap[pkkKey] = {
            perusahaan: String(row[5] || '-').trim(), jenis_kapal_xls: String(row[6] || '-').trim(),
            dr_max_xls: String(row[10] || '-').trim(), dr_depan_xls: String(row[11] || '-').trim(),
            dr_belakang_xls: String(row[12] || '-').trim(), dr_tengah_xls: String(row[13] || '-').trim(),
            tiba_dari_xls: String(row[18] || '-').trim(), tiba_tanggal_xls: String(row[19] || '-').trim(),
            tiba_sandar_xls: String(row[20] || '-').trim(), berangkat_ke_xls: String(row[21] || '-').trim(),
            berangkat_tanggal_xls: String(row[22] || '-').trim(), berangkat_tolak_xls: String(row[23] || '-').trim(),
            waktu_respon_xls: String(row[40] || '-').trim(), detail_bongkar: [], detail_muat: []
          };
        } else {
          const cu = (field, col) => {
            const v = String(row[col] || '').trim();
            if (v && v !== '-' && (xlsMap[pkkKey][field] === '-' || xlsMap[pkkKey][field] === '')) xlsMap[pkkKey][field] = v;
          };
          cu('perusahaan',5); cu('jenis_kapal_xls',6); cu('dr_max_xls',10); cu('dr_depan_xls',11); cu('dr_belakang_xls',12); cu('dr_tengah_xls',13);
          cu('tiba_dari_xls',18); cu('tiba_tanggal_xls',19); cu('tiba_sandar_xls',20); cu('berangkat_ke_xls',21); cu('berangkat_tanggal_xls',22); cu('berangkat_tolak_xls',23); cu('waktu_respon_xls',40);
        }
        
        const bk = String(row[24] || '').trim();
        if (bk && bk !== '-') xlsMap[pkkKey].detail_bongkar.push({
          komoditi: bk, jenis: String(row[25] || '').trim(), ton: String(row[26] || '-').trim(),
          m3: String(row[27] || '-').trim(), unit: String(row[28] || '-').trim(), orang: String(row[29] || '-').trim()
        });
        
        const mu = String(row[30] || '').trim();
        if (mu && mu !== '-') xlsMap[pkkKey].detail_muat.push({
          komoditi: mu, jenis: String(row[31] || '').trim(), ton: String(row[32] || '-').trim(),
          m3: String(row[33] || '-').trim(), unit: String(row[34] || '-').trim(), orang: String(row[35] || '-').trim()
        });
      }
    }

    // Merge JSON + XLS
    const mergedData = jsonData.map(item => {
      const pk = item.nomor_pkk ? String(item.nomor_pkk).trim() : '';
      const x = xlsMap[pk] || {};
      if (x.tiba_dari_xls && x.tiba_dari_xls !== '-') item.pelabuhan_asal = x.tiba_dari_xls;
      if (x.tiba_tanggal_xls && x.tiba_tanggal_xls !== '-') item.eta = x.tiba_tanggal_xls;
      if (x.tiba_sandar_xls && x.tiba_sandar_xls !== '-') item.lokasi_sandar = x.tiba_sandar_xls;
      if (x.berangkat_ke_xls && x.berangkat_ke_xls !== '-') item.pelabuhan_tujuan = x.berangkat_ke_xls;
      if (x.berangkat_tanggal_xls && x.berangkat_tanggal_xls !== '-') item.etd = x.berangkat_tanggal_xls;
      if (x.berangkat_tolak_xls && x.berangkat_tolak_xls !== '-') item.lokasi_tolak = x.berangkat_tolak_xls;
      return Object.assign({}, item, x);
    });

    // Simpan ke CACHE_JSON
    const finalStr = JSON.stringify({ data: mergedData });
    const nowFull = formatDate(new Date(), 'yyyy-MM-dd HH:mm:ss');
    await simpanKeCacheData('CACHE_JSON', cacheKey, finalStr, nowFull);

    return res.status(200).json({
      status: 'success', source: 'live_fetch', data: mergedData, fetched_at: nowFull
    });
  }

  return res.status(405).json({ status: 'error', message: 'Method tidak diizinkan' });
}
