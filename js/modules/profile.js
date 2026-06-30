/**
 * modules/profile.js
 * Quản lý thông tin cá nhân: ảnh đại diện (initials), thông tin cơ bản,
 * thông tin công tác (đọc-chỉ với hợp đồng/chức vụ — do HR quản lý),
 * và đổi mật khẩu.
 */

const ProfileModule = (() => {
  async function render(root) {
    const user = Auth.getCurrentUser();
    const centers = (await DB.get('meta:centers')) || [];
    const centerName = centers.find((c) => c.id === user.center)?.name || '—';

    root.innerHTML = `
      <div class="content-grid cols-2">
        <div class="card">
          <div class="flex-row gap-sm mb-md">
            <div class="sidebar-avatar" style="background:var(--color-primary-light); color:var(--color-primary); width:56px; height:56px; font-size:20px;">${UI.userInitials(user.name)}</div>
            <div>
              <h3 style="font-size:17px;">${UI.escapeHtml(user.name)}</h3>
              <div class="text-muted" style="font-size:13px;">${UI.escapeHtml(user.position)}</div>
            </div>
          </div>
          <form id="profileForm">
            <div class="content-grid cols-2">
              <div class="field"><label>Họ và tên</label><input type="text" id="pName" value="${UI.escapeHtml(user.name)}" /></div>
              <div class="field"><label>Số điện thoại</label><input type="text" id="pPhone" value="${UI.escapeHtml(user.phone || '')}" /></div>
              <div class="field"><label>Email</label><input type="email" id="pEmail" value="${UI.escapeHtml(user.email || '')}" /></div>
              <div class="field"><label>Địa chỉ</label><input type="text" id="pAddress" value="${UI.escapeHtml(user.address || '')}" placeholder="Chưa cập nhật" /></div>
            </div>
            <button type="submit" class="btn btn-primary">Lưu thay đổi</button>
          </form>
        </div>

        <div>
          <div class="card mb-md">
            <div class="card-title">Thông tin công tác</div>
            <table>
              <tr><td class="text-faint">Mã nhân viên</td><td class="mono">${user.id}</td></tr>
              <tr><td class="text-faint">Chức vụ</td><td>${UI.escapeHtml(user.position)}</td></tr>
              <tr><td class="text-faint">Phòng ban</td><td>${UI.escapeHtml(user.dept)}</td></tr>
              <tr><td class="text-faint">Trung tâm công tác</td><td>${centerName}</td></tr>
              <tr><td class="text-faint">Vai trò hệ thống</td><td>${ROLE_LABELS[user.role]}</td></tr>
            </table>
            <div class="text-faint mt-sm" style="font-size:12px;">Thông tin hợp đồng &amp; chức vụ do phòng Nhân sự quản lý.</div>
          </div>

          <div class="card">
            <div class="card-title">Đổi mật khẩu</div>
            <form id="pwForm">
              <div class="field"><label>Mật khẩu hiện tại</label><input type="password" id="oldPw" required /></div>
              <div class="field"><label>Mật khẩu mới</label><input type="password" id="newPw" required minlength="6" /></div>
              <button type="submit" class="btn btn-secondary">Đổi mật khẩu</button>
            </form>
          </div>
        </div>
      </div>
    `;

    root.querySelector('#profileForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      user.name = document.getElementById('pName').value.trim();
      user.phone = document.getElementById('pPhone').value.trim();
      user.email = document.getElementById('pEmail').value.trim();
      user.address = document.getElementById('pAddress').value.trim();
      await DB.set(`users:${user.id}`, user);
      UI.toast('Đã lưu thông tin cá nhân.', 'success');
      App.refreshCurrent();
      document.getElementById('userName').textContent = user.name;
    });

    root.querySelector('#pwForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const oldPw = document.getElementById('oldPw').value;
      const newPw = document.getElementById('newPw').value;
      const res = await Auth.changePassword(oldPw, newPw);
      if (res.ok) {
        UI.toast('Đổi mật khẩu thành công.', 'success');
        e.target.reset();
      } else {
        UI.toast(res.error, 'error');
      }
    });
  }

  return { render };
})();
