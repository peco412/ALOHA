/**
 * storage.js — Supabase Edition
 * Thay thế toàn bộ lớp storage.js cũ (file JSON) bằng Supabase.
 * Mọi module nghiệp vụ (notifications, hr, accounting...) gọi qua DB.* giống hệt bản cũ.
 * Phần client (modules/) KHÔNG cần sửa — đúng theo thiết kế ban đầu.
 *
 * Yêu cầu: thêm thẻ <script> nạp Supabase JS SDK trước file này trong HTML:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
 */

const DB = (() => {
  // Khởi tạo Supabase client (URL + anon key từ config.js)
  const _client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ─── Helpers nội bộ ───────────────────────────────────────────────────────

  function _table(name) { return _client.from(name); }

  function _camelToSnake(str) {
    return str.replace(/([A-Z])/g, '_$1').toLowerCase();
  }

  // Chuyển keys camelCase → snake_case cho Postgres
  function _toRow(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[_camelToSnake(k)] = (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date))
        ? _toRow(v) : v;
    }
    return out;
  }

  // Chuyển snake_case → camelCase cho JS
  function _toCamel(str) {
    return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  }
  function _fromRow(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(_fromRow);
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[_toCamel(k)] = (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date))
        ? _fromRow(v) : v;
    }
    return out;
  }

  // ─── Map key-prefix → tên bảng Supabase ──────────────────────────────────
  // Giữ nguyên quy ước key cũ để module không phải sửa
  const TABLE_MAP = {
    'users:':         'users',
    'classes:':       'classes',
    'students:':      'students',
    'proposals:':     'proposals',
    'hr_forms:':      'hr_forms',
    'mkt_requests:':  'mkt_requests',
    'acc_forms:':     'acc_forms',
    'notifications:': 'notifications',
    'schedule:':      'weekly_schedule',
    'meta:centers':   '__centers__',   // special key
  };

  function _resolveTable(key) {
    if (key === 'meta:centers') return { table: 'centers', id: null, special: 'centers_list' };
    for (const [prefix, table] of Object.entries(TABLE_MAP)) {
      if (prefix !== 'meta:centers' && key.startsWith(prefix)) {
        const id = key.slice(prefix.length);
        return { table, id };
      }
    }
    // fallback: lưu vào bảng key-value không có (ignore silently)
    return null;
  }

  // ─── API công khai (giữ signature giống bản cũ) ───────────────────────────

  /** Đọc 1 record theo key. Trả về null nếu không có. */
  async function get(key) {
    try {
      const info = _resolveTable(key);
      if (!info) return null;

      // Special: meta:centers → lấy toàn bộ bảng centers
      if (info.special === 'centers_list') {
        const { data } = await _table('centers').select('*').order('name');
        return data ? data.map(_fromRow) : [];
      }

      if (!info.id) return null;
      const { data, error } = await _table(info.table).select('*').eq('id', info.id).single();
      if (error || !data) return null;
      return _fromRow(data);
    } catch { return null; }
  }

  /** Ghi 1 record (upsert). */
  async function set(key, value) {
    try {
      const info = _resolveTable(key);
      if (!info || info.special) return false;

      // Đảm bảo id được set đúng
      const row = _toRow({ ...value, id: info.id });
      const { error } = await _table(info.table).upsert(row, { onConflict: 'id' });
      if (error) {
        console.error('DB.set error (Supabase):', key, '→ table:', info.table, '→', error.message, error);
        return false;
      }
      return true;
    } catch (e) {
      console.error('DB.set error (exception):', key, e);
      return false;
    }
  }

  /** Xóa 1 record. */
  async function remove(key) {
    try {
      const info = _resolveTable(key);
      if (!info || !info.id) return false;
      const { error } = await _table(info.table).delete().eq('id', info.id);
      return !error;
    } catch { return false; }
  }

  /** Liệt kê keys theo prefix — trả về mảng key string để tương thích cũ. */
  async function listKeys(prefix) {
    try {
      const info = _resolveTable(prefix);
      if (!info) return [];
      const { data } = await _table(info.table).select('id');
      if (!data) return [];
      return data.map((r) => `${prefix}${r.id}`);
    } catch { return []; }
  }

  /** Lấy toàn bộ record theo prefix dạng bảng. */
  async function getTable(prefix) {
    try {
      const info = _resolveTable(prefix);
      if (!info) return [];
      const { data } = await _table(info.table).select('*').order('created_at', { ascending: false });
      return data ? data.map(_fromRow) : [];
    } catch { return []; }
  }

  /** Sinh ID ngắn. */
  function genId(prefix = 'ID') {
    const t = Date.now().toString(36).toUpperCase();
    const r = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `${prefix}-${t}${r}`;
  }

  // isSeeded / markSeeded — không cần với Supabase (seed bằng SQL)
  async function isSeeded() { return true; }
  async function markSeeded() {}

  // ─── Upload file thật lên Supabase Storage ────────────────────────────────

  /**
   * Tải file lên Supabase Storage bucket 'attachments'.
   * Trả về { url, name, type } để lưu vào attachments[] của proposal/form.
   */
  async function uploadFile(file, folder = 'uploads') {
    const ext = file.name.split('.').pop();
    const path = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const { data, error } = await _client.storage.from('attachments').upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    });
    if (error) throw error;
    const { data: urlData } = _client.storage.from('attachments').getPublicUrl(data.path);
    return { name: file.name, type: ext.toUpperCase(), url: urlData.publicUrl, path: data.path };
  }

  /**
   * Xóa file khỏi Supabase Storage.
   */
  async function deleteFile(filePath) {
    await _client.storage.from('attachments').remove([filePath]);
  }

  // Expose Supabase client gốc để Auth module dùng
  function getClient() { return _client; }

  return { get, set, remove, listKeys, getTable, genId, isSeeded, markSeeded, uploadFile, deleteFile, getClient };
})();
