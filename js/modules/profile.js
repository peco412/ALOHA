/**
 * modules/profile.js — Nâng cấp toàn diện
 * Thêm mới:
 * - Upload chữ ký số cá nhân (dùng cho ký biểu mẫu)
 * - Upload CV, chứng chỉ, bằng cấp (nhiều file)
 * - Hiển thị ngày sinh, quê quán (đọc — do HR quản lý)
 * - Ảnh đại diện thật (upload)
 * - Phân quyền: HR/BGD/Admin xem đầy đủ; người khác chỉ xem thông tin cơ bản
 */

const ProfileModule = (() => {
  async function render(root) {
    const user = Auth.getCurrentUser();
    const fullUser = await DB.get(`users:${user.id}`);
    const u = fullUser || user;
    const centers = (await DB.get('meta:centers')) || [];
    const centerName = centers.find((c) => c.id === u.center)?.name || '—';

    root.innerHTML = `
      <div class="content-grid cols-2">
        <!-- Cột trái: Thông tin cá nhân có thể tự cập nhật -->
        <div>
          <div class="card mb-md">
            <div class="flex-row gap-sm mb-md" style="align-items:center;">
              ${u.avatarUrl
                ? `<img src="${u.avatarUrl}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;flex-shrink:0;" />`
                : `<div class="sidebar-avatar" style="background:var(--color-primary-light);color:var(--color-primary);width:64px;height:64px;font-size:22px;flex-shrink:0;">${UI.userInitials(u.name)}</div>`}
              <div>
                <h3 style="font-size:17px;margin:0;">${UI.escapeHtml(u.name)}</h3>
                <div class="text-muted" style="font-size:13px;">${UI.escapeHtml(u.position || '')}</div>
                <div class="text-faint" style="font-size:12px;">${ROLE_LABELS[u.role] || u.role}</div>
              </div>
            </div>

            <form id="profileForm">
              <div class="content-grid cols-2">
                <div class="field">
                  <label>Ảnh đại diện</label>
                  <input type="file" id="pAvatar" accept="image/*" />
                  <div class="text-faint" style="font-size:11.5px;margin-top:3px;">PNG/JPG — sẽ hiện thay initials</div>
                </div>
                <div class="field">
                  <label>Họ và tên</label>
                  <input type="text" id="pName" value="${UI.escapeHtml(u.name)}" />
                </div>
                <div class="field">
                  <label>Số điện thoại</label>
                  <input type="tel" id="pPhone" value="${UI.escapeHtml(u.phone || '')}" />
                </div>
                <div class="field">
                  <label>Email</label>
                  <input type="email" id="pEmail" value="${UI.escapeHtml(u.email || '')}" />
                </div>
                <div class="field" style="grid-column:1/-1;">
                  <label>Địa chỉ</label>
                  <input type="text" id="pAddress" value="${UI.escapeHtml(u.address || '')}" placeholder="Chưa cập nhật" />
                </div>
              </div>
              <button type="submit" class="btn btn-primary">Lưu thông tin cá nhân</button>
            </form>
          </div>

          <!-- Chữ ký số -->
          <div class="card mb-md">
            <div class="card-title">✍️ Chữ ký số cá nhân</div>
            <div class="text-faint" style="font-size:12.5px;margin-bottom:10px;">
              Dùng để ký vào biểu mẫu, đề xuất khi duyệt. Nên dùng ảnh PNG nền trong suốt.
            </div>
            ${u.signatureUrl
              ? `<div class="mb-sm"><img src="${u.signatureUrl}" style="height:60px;object-fit:contain;border:1px solid var(--color-border);border-radius:6px;padding:6px;background:#fff;" /></div>`
              : `<div class="text-faint mb-sm" style="font-size:12.5px;">Chưa có chữ ký — upload để sử dụng tính năng ký biểu mẫu.</div>`}
            <div class="flex-row gap-sm">
              <input type="file" id="pSignature" accept="image/png,image/jpeg" style="flex:1;" />
              <button class="btn btn-secondary" id="btnSaveSignature">Upload chữ ký</button>
            </div>
          </div>

          <!-- CV & Chứng chỉ -->
          <div class="card mb-md">
            <div class="card-title">📁 CV & Bằng cấp / Chứng chỉ</div>
            <div class="field">
              <label>Upload CV (PDF)</label>
              <div class="flex-row gap-sm">
                <input type="file" id="pCV" accept=".pdf" style="flex:1;" />
                <button class="btn btn-secondary" id="btnSaveCV">Upload CV</button>
              </div>
              ${u.cvUrl ? `<a href="${u.cvUrl}" target="_blank" class="attachment-chip mt-sm">📄 Xem CV hiện tại</a>` : ''}
            </div>
            <div class="field mt-md">
              <label>Upload chứng chỉ / bằng cấp</label>
              <div class="flex-row gap-sm">
                <input type="text" id="certName" placeholder="Tên chứng chỉ (VD: IELTS 7.0)" style="flex:1;" />
                <input type="file" id="certFile" accept=".pdf,.jpg,.png" />
                <button class="btn btn-secondary" id="btnAddCert">Thêm</button>
              </div>
            </div>
            <div id="certList" class="mt-sm">
              ${(u.certificates || []).length === 0
                ? `<div class="text-faint" style="font-size:12.5px;">Chưa có chứng chỉ nào.</div>`
                : (u.certificates || []).map((c, i) => `
                  <div class="flex-row gap-sm mb-sm" style="align-items:center;">
                    <a href="${c.url}" target="_blank" class="attachment-chip" style="flex:1;">📜 ${UI.escapeHtml(c.name)}</a>
                    <span class="text-faint" style="font-size:11px;">${c.uploadedAt ? UI.formatDate(c.uploadedAt) : ''}</span>
                    <button class="btn btn-danger btn-sm deleteCert" data-index="${i}">✕</button>
                  </div>`).join('')}
            </div>
          </div>
        </div>

        <!-- Cột phải: Thông tin công tác (đọc-chỉ, do HR quản lý) -->
        <div>
          <div class="card mb-md">
            <div class="card-title">📋 Thông tin công tác</div>
            <table style="width:100%;">
              <tr><td class="text-faint" style="width:150px;">Mã nhân viên</td><td class="mono" style="font-size:12px;">${u.id}</td></tr>
              <tr><td class="text-faint">Chức vụ</td><td>${UI.escapeHtml(u.position || '—')}</td></tr>
              <tr><td class="text-faint">Phòng ban</td><td>${UI.escapeHtml(u.dept || '—')}</td></tr>
              <tr><td class="text-faint">Trung tâm</td><td>${centerName}</td></tr>
              <tr><td class="text-faint">Vai trò hệ thống</td><td>${ROLE_LABELS[u.role] || u.role}</td></tr>
              <tr><td class="text-faint">Loại hợp đồng</td><td>${u.contractType === 'parttime' ? 'Bán thời gian' : u.contractType === 'probation' ? 'Thử việc' : 'Chính thức'}</td></tr>
              <tr><td class="text-faint">Ngày vào làm</td><td>${u.hireDate ? UI.formatDate(u.hireDate) : '—'}</td></tr>
              <tr><td class="text-faint">Ngày sinh</td><td>${u.dateOfBirth ? UI.formatDate(u.dateOfBirth) : '—'}</td></tr>
              <tr><td class="text-faint">Quê quán</td><td>${UI.escapeHtml(u.hometown || '—')}</td></tr>
              <tr><td class="text-faint">CCCD/CMND</td><td>${UI.escapeHtml(u.idNumber || '—')}</td></tr>
            </table>
            <div class="text-faint mt-sm" style="font-size:12px;">Thông tin hợp đồng & chức vụ do phòng Nhân sự quản lý.</div>
          </div>

          <!-- Trạng thái việc làm -->
          <div class="card mb-md">
            <div class="card-title">💼 Trạng thái việc làm</div>
            <div>${employmentStatusBadge(u.employmentStatus || 'active')}</div>
            ${u.terminationNote ? `<div class="text-faint mt-sm" style="font-size:12.5px;">${UI.escapeHtml(u.terminationNote)}</div>` : ''}
          </div>

          <!-- Đổi mật khẩu -->
          <div class="card">
            <div class="card-title">🔒 Đổi mật khẩu</div>
            <form id="pwForm">
              <div class="field"><label>Mật khẩu hiện tại</label><input type="password" id="oldPw" required /></div>
              <div class="field"><label>Mật khẩu mới (tối thiểu 6 ký tự)</label><input type="password" id="newPw" required minlength="6" /></div>
              <div class="field"><label>Xác nhận mật khẩu mới</label><input type="password" id="confirmPw" required /></div>
              <button type="submit" class="btn btn-secondary">Đổi mật khẩu</button>
            </form>
          </div>
        </div>
      </div>
    `;

    // Lưu thông tin cá nhân
    root.querySelector('#profileForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      let avatarUrl = u.avatarUrl || null;
      const avatarFile = document.getElementById('pAvatar').files[0];
      if (avatarFile) {
        try {
          const up = await DB.uploadFile(avatarFile, 'avatars');
          avatarUrl = up.url;
        } catch (err) { UI.toast('Lỗi upload ảnh: ' + err.message, 'error'); return; }
      }
      u.name     = document.getElementById('pName').value.trim();
      u.phone    = document.getElementById('pPhone').value.trim();
      u.email    = document.getElementById('pEmail').value.trim();
      u.address  = document.getElementById('pAddress').value.trim();
      u.avatarUrl = avatarUrl;
      const ok = await DB.set(`users:${u.id}`, u);
      if (!ok) { UI.toast('Lỗi lưu thông tin.', 'error'); return; }
      // Cập nhật session
      Object.assign(Auth.getCurrentUser(), { name: u.name, phone: u.phone, email: u.email, address: u.address, avatarUrl });
      sessionStorage.setItem('aloha_session', JSON.stringify(Auth.getCurrentUser()));
      UI.toast('Đã lưu thông tin cá nhân.', 'success');
      document.getElementById('userName').textContent = u.name;
      App.refreshCurrent();
    });

    // Upload chữ ký
    document.getElementById('btnSaveSignature')?.addEventListener('click', async () => {
      const file = document.getElementById('pSignature').files[0];
      if (!file) { UI.toast('Vui lòng chọn file ảnh chữ ký.', 'error'); return; }
      try {
        const up = await DB.uploadFile(file, 'signatures');
        u.signatureUrl = up.url;
        const ok = await DB.set(`users:${u.id}`, u);
        if (!ok) { UI.toast('Lỗi lưu chữ ký.', 'error'); return; }
        // Cập nhật session
        Auth.getCurrentUser().signatureUrl = up.url;
        sessionStorage.setItem('aloha_session', JSON.stringify(Auth.getCurrentUser()));
        UI.toast('Đã lưu chữ ký số.', 'success');
        App.refreshCurrent();
      } catch (err) { UI.toast('Lỗi upload: ' + err.message, 'error'); }
    });

    // Upload CV
    document.getElementById('btnSaveCV')?.addEventListener('click', async () => {
      const file = document.getElementById('pCV').files[0];
      if (!file) { UI.toast('Vui lòng chọn file CV.', 'error'); return; }
      try {
        const up = await DB.uploadFile(file, 'cv');
        u.cvUrl = up.url;
        const ok = await DB.set(`users:${u.id}`, u);
        if (!ok) { UI.toast('Lỗi lưu CV.', 'error'); return; }
        UI.toast('Đã upload CV thành công.', 'success');
        App.refreshCurrent();
      } catch (err) { UI.toast('Lỗi upload: ' + err.message, 'error'); }
    });

    // Thêm chứng chỉ
    document.getElementById('btnAddCert')?.addEventListener('click', async () => {
      const name = document.getElementById('certName').value.trim();
      const file = document.getElementById('certFile').files[0];
      if (!name || !file) { UI.toast('Vui lòng nhập tên và chọn file chứng chỉ.', 'error'); return; }
      try {
        const up = await DB.uploadFile(file, 'certificates');
        u.certificates = [...(u.certificates || []), { name, url: up.url, uploadedAt: new Date().toISOString() }];
        const ok = await DB.set(`users:${u.id}`, u);
        if (!ok) { UI.toast('Lỗi lưu chứng chỉ.', 'error'); return; }
        UI.toast('Đã thêm chứng chỉ.', 'success');
        App.refreshCurrent();
      } catch (err) { UI.toast('Lỗi upload: ' + err.message, 'error'); }
    });

    // Xóa chứng chỉ
    root.querySelectorAll('.deleteCert').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.index);
        u.certificates = (u.certificates || []).filter((_, i) => i !== idx);
        const ok = await DB.set(`users:${u.id}`, u);
        if (!ok) { UI.toast('Lỗi xóa chứng chỉ.', 'error'); return; }
        UI.toast('Đã xóa chứng chỉ.', 'success');
        App.refreshCurrent();
      });
    });

    // Đổi mật khẩu
    root.querySelector('#pwForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const oldPw    = document.getElementById('oldPw').value;
      const newPw    = document.getElementById('newPw').value;
      const confirmPw = document.getElementById('confirmPw').value;
      if (newPw !== confirmPw) { UI.toast('Mật khẩu mới và xác nhận không khớp.', 'error'); return; }
      const res = await Auth.changePassword(oldPw, newPw);
      if (res.ok) { UI.toast('Đổi mật khẩu thành công.', 'success'); e.target.reset(); }
      else UI.toast(res.error, 'error');
    });
  }

  function employmentStatusBadge(status) {
    const map = {
      active:     { label: 'Đang làm việc', cls: 'badge-completed' },
      on_leave:   { label: 'Nghỉ dài hạn',  cls: 'badge-pending' },
      suspended:  { label: 'Tạm ngưng',     cls: 'badge-default' },
      terminated: { label: 'Đã nghỉ việc',  cls: 'badge-rejected' },
    };
    const s = map[status] || map.active;
    return `<span class="badge ${s.cls}">${s.label}</span>`;
  }

  return { render };
})();
