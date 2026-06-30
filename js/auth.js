/**
 * auth.js — Supabase Edition
 * Xác thực bằng username/password lưu trong bảng users (so khớp mật khẩu đơn giản).
 * Để production thật sự an toàn: dùng Supabase Auth (email magic link / OAuth),
 * hoặc hash mật khẩu bcrypt trong Edge Function trước khi so khớp.
 *
 * Session lưu trong sessionStorage (không mất khi tải lại tab, mất khi đóng trình duyệt).
 */

const Auth = (() => {
  const SESSION_KEY = 'aloha_session';
  let _current = null;

  // Khôi phục session từ sessionStorage khi load lại trang
  function _loadSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) _current = JSON.parse(raw);
    } catch {}
  }
  _loadSession();

  async function login(username, password) {
    // Tìm user theo username
    const client = DB.getClient();
    const { data, error } = await client
      .from('users')
      .select('*')
      .eq('username', username)
      .single();

    if (error || !data) return { ok: false, error: 'Sai tên đăng nhập hoặc mật khẩu.' };

    // Chặn đăng nhập nếu nhân viên đã nghỉ việc hoặc bị tạm ngưng
    if (data.employment_status === 'terminated') {
      return { ok: false, error: 'Tài khoản đã ngừng hoạt động (nhân viên đã nghỉ việc). Liên hệ phòng Nhân sự nếu có thắc mắc.' };
    }
    if (data.employment_status === 'suspended') {
      return { ok: false, error: 'Tài khoản đang bị tạm ngưng. Liên hệ phòng Nhân sự để biết thêm chi tiết.' };
    }

    // Kiểm tra mật khẩu: bản demo so plaintext (seed bằng SQL đơn giản).
    // Để production: gọi Edge Function hash bcrypt.
    // password_hash trong bảng lưu plaintext cho demo, đổi thành bcrypt khi production.
    const passwordOk = data.password_hash === password || data.password_hash === '$2b$10$demo';
    // Dòng trên cho phép password_hash = '$2b$10$demo' (seed mẫu) qua với bất kỳ password nào cho tiện demo
    if (!passwordOk && data.password_hash !== '$2b$10$demo') {
      return { ok: false, error: 'Sai tên đăng nhập hoặc mật khẩu.' };
    }

    // Chuyển snake_case → camelCase
    const user = {
      id: data.id, username: data.username, name: data.name,
      role: data.role, position: data.position, dept: data.dept,
      center: data.center, phone: data.phone, email: data.email,
      avatarUrl: data.avatar_url,
    };
    _current = user;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
    return { ok: true, user };
  }

  function logout() {
    _current = null;
    sessionStorage.removeItem(SESSION_KEY);
  }

  function getCurrentUser() { return _current; }
  function isLoggedIn() { return _current !== null; }

  async function changePassword(oldPassword, newPassword) {
    if (!_current) return { ok: false, error: 'Chưa đăng nhập.' };
    const client = DB.getClient();
    const { data } = await client.from('users').select('password_hash').eq('id', _current.id).single();
    if (!data || (data.password_hash !== oldPassword && data.password_hash !== '$2b$10$demo')) {
      return { ok: false, error: 'Mật khẩu hiện tại không đúng.' };
    }
    const { error } = await client.from('users').update({ password_hash: newPassword }).eq('id', _current.id);
    if (error) return { ok: false, error: 'Lỗi cập nhật mật khẩu.' };
    return { ok: true };
  }

  return { login, logout, getCurrentUser, isLoggedIn, changePassword };
})();
