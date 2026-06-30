/**
 * modules/accounting.js — Supabase Edition
 * Phân quyền mới:
 * - Trưởng phòng Kế toán / Admin / Exec: quản lý toàn bộ, duyệt, xem bảng lương tất cả
 * - Trưởng phòng ban khác / Quản lý TT: tạo đơn + theo dõi đơn của mình (không duyệt)
 * - Staff/Teacher: tạo đơn + theo dõi đơn của mình; nếu thuộc phòng Kế toán: nhận xử lý
 */

const AccountingModule = (() => {
  let activeTab = 'forms';
  const PAYROLL_MONTHS = ['2026-06', '2026-05', '2026-04'];

  async function render(root) {
    const user = Auth.getCurrentUser();
    const isAccManager = user.role === ROLES.ADMIN || user.role === ROLES.EXEC ||
      (user.role === ROLES.DEPT_HEAD && user.dept === 'Kế toán');

    root.innerHTML = `
      <div class="tabs">
        ${tab('forms', 'Đơn thanh toán / Tạm ứng')}
        ${tab('payroll', 'Bảng lương')}
      </div>
      <div id="accBody"></div>
    `;
    root.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => { activeTab = t.dataset.tab; render(root); }));

    const body = root.querySelector('#accBody');
    if (activeTab === 'forms') await renderForms(body, user, isAccManager);
    else await renderPayroll(body, user, isAccManager);
  }

  function tab(key, label) { return `<div class="tab ${activeTab === key ? 'active' : ''}" data-tab="${key}">${label}</div>`; }

  // ─── ĐƠN THANH TOÁN / TẠM ỨNG ────────────────────────────────────────────

  async function renderForms(root, user, isAccManager) {
    const all   = await DB.getTable('acc_forms:');
    const visible = isAccManager ? all : all.filter((f) => f.requestedBy === user.id);
    visible.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const users = await DB.getTable('users:');

    root.innerHTML = `
      <div class="flex-between mb-md">
        <div class="text-faint" style="font-size:12.5px;">${isAccManager ? 'Tiếp nhận hồ sơ, duyệt hoặc từ chối thanh toán' : 'Đơn bạn đã gửi'}</div>
        <button class="btn btn-primary" id="btnNewAccForm">+ Tạo đơn</button>
      </div>
      ${visible.length === 0 ? UI.emptyState('🧾', 'Chưa có biểu mẫu nào.') : `
        <div class="table-wrap"><table>
          <thead><tr><th>Mã</th><th>Loại đơn</th><th>Nội dung</th><th>Số tiền</th><th>Người gửi</th><th>Chứng từ</th><th>Trạng thái</th>${isAccManager ? '<th></th>' : ''}</tr></thead>
          <tbody>${visible.map((f) => formRow(f, users, isAccManager)).join('')}</tbody>
        </table></div>
      `}
    `;
    root.querySelector('#btnNewAccForm').addEventListener('click', () => openNewFormModal(user));
    if (isAccManager) {
      root.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', () => handleAction(btn.dataset.id, btn.dataset.act)));
    }
  }

  function formRow(f, users, isAccManager) {
    const requester = users.find((u) => u.id === f.requestedBy);
    return `<tr>
      <td class="mono" style="font-size:12px;">${f.id}</td>
      <td>${f.type === 'payment' ? 'Đơn thanh toán' : 'Đơn tạm ứng'}</td>
      <td>${UI.escapeHtml(f.title)}</td>
      <td><strong>${UI.formatMoney(f.amount)}</strong></td>
      <td>${requester?.name || f.requestedBy}</td>
      <td>${f.attachmentUrl ? `<a href="${f.attachmentUrl}" target="_blank">📎 Xem</a>` : '—'}</td>
      <td>${UI.statusBadge(f.status)}</td>
      ${isAccManager ? `<td>${f.status === 'pending' ? `
        <button class="btn btn-danger btn-sm" data-act="reject" data-id="${f.id}">Từ chối</button>
        <button class="btn btn-primary btn-sm" data-act="approve" data-id="${f.id}">Duyệt</button>
      ` : ''}</td>` : ''}
    </tr>`;
  }

  async function handleAction(id, act) {
    const f = await DB.get(`acc_forms:${id}`);
    f.status = act === 'approve' ? 'approved' : 'rejected';
    const ok = await DB.set(`acc_forms:${id}`, f);
    if (!ok) { UI.toast('Lỗi cập nhật. Kiểm tra Console (F12) để xem chi tiết.', 'error'); return; }
    UI.toast(act === 'approve' ? 'Đã duyệt thanh toán.' : 'Đã từ chối.', act === 'approve' ? 'success' : 'error');
    App.refreshCurrent();
  }

  function openNewFormModal(user) {
    const body = `
      <div class="field"><label>Loại đơn</label>
        <select id="accType"><option value="payment">Đơn thanh toán</option><option value="advance">Đơn tạm ứng</option></select>
      </div>
      <div class="field"><label>Nội dung <span style="color:red">*</span></label>
        <input type="text" id="accTitle" placeholder="VD: Thanh toán tiền điện trung tâm..." /></div>
      <div class="field"><label>Số tiền (VNĐ) <span style="color:red">*</span></label>
        <input type="number" id="accAmount" placeholder="VD: 4500000" /></div>
      <div class="field">
        <label>Hồ sơ chứng từ đính kèm</label>
        <input type="file" id="accFile" accept=".pdf,.jpg,.png,.xlsx" />
        <div class="text-faint" style="font-size:12px;margin-top:4px;">File thật — hóa đơn, biên lai...</div>
      </div>
    `;
    const footer = `<button class="btn btn-secondary" id="cancelAccForm">Hủy</button>
                    <button class="btn btn-primary" id="submitAccForm">Gửi đơn</button>`;
    UI.openModal('Tạo đơn thanh toán / tạm ứng', body, footer);
    document.getElementById('cancelAccForm').addEventListener('click', UI.closeModal);
    document.getElementById('submitAccForm').addEventListener('click', async () => {
      const title  = document.getElementById('accTitle').value.trim();
      const amount = Number(document.getElementById('accAmount').value);
      if (!title || !amount) { UI.toast('Vui lòng nhập đầy đủ nội dung và số tiền.', 'error'); return; }

      let attachmentUrl = null;
      const file = document.getElementById('accFile')?.files[0];
      if (file) {
        try {
          const up = await DB.uploadFile(file, 'acc_forms');
          attachmentUrl = up.url;
        } catch (e) { UI.toast('Lỗi tải file: ' + e.message, 'error'); return; }
      }

      const id = DB.genId('ACC-F');
      const ok = await DB.set(`acc_forms:${id}`, {
        id, type: document.getElementById('accType').value, title, amount,
        requestedBy: user.id, status: 'pending', attachmentUrl,
        createdAt: new Date().toISOString(),
      });
      if (!ok) { UI.toast('Lỗi gửi đơn. Kiểm tra Console (F12) để xem chi tiết.', 'error'); return; }
      UI.closeModal();
      UI.toast('Đã gửi đơn tới phòng Kế toán.', 'success');
      App.refreshCurrent();
    });
  }

  // ─── BẢNG LƯƠNG ──────────────────────────────────────────────────────────

  async function renderPayroll(root, user, isAccManager) {
    root.innerHTML = `
      <div class="card mb-md">
        <div class="flex-row gap-sm">
          <label class="text-faint" style="font-size:13px;">Tra cứu theo tháng:</label>
          <select id="payrollMonth">${PAYROLL_MONTHS.map((m) => `<option value="${m}">${m}</option>`).join('')}</select>
        </div>
      </div>
      <div id="payrollTable"></div>
      ${!isAccManager ? `<div class="text-faint mt-md" style="font-size:12px;">🔒 Bạn chỉ có thể xem bảng lương của chính mình. Trưởng phòng Kế toán / Ban Điều hành có quyền xem toàn bộ.</div>` : ''}
    `;
    const draw = async (month) => {
      const users = isAccManager ? await DB.getTable('users:') : [user];
      const wrap = document.getElementById('payrollTable');
      wrap.innerHTML = `
        <div class="table-wrap"><table>
          <thead><tr><th>Họ tên</th><th>Chức vụ</th><th>Lương cơ bản</th><th>Phụ cấp</th><th>Thực lĩnh</th><th>Trạng thái</th></tr></thead>
          <tbody>${users.map((u) => payrollRow(u, month)).join('')}</tbody>
        </table></div>
      `;
    };
    draw(PAYROLL_MONTHS[0]);
    document.getElementById('payrollMonth').addEventListener('change', (e) => draw(e.target.value));
  }

  function payrollRow(u, month) {
    const seed = u.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const base = 6000000 + (seed % 10) * 500000;
    const allowance = 500000 + (seed % 5) * 100000;
    const total = base + allowance;
    return `<tr>
      <td><strong>${UI.escapeHtml(u.name)}</strong></td>
      <td>${UI.escapeHtml(u.position || '')}</td>
      <td>${UI.formatMoney(base)}</td>
      <td>${UI.formatMoney(allowance)}</td>
      <td><strong>${UI.formatMoney(total)}</strong></td>
      <td>${month === PAYROLL_MONTHS[0] ? UI.statusBadge('in_progress') : UI.statusBadge('completed')}</td>
    </tr>`;
  }

  return { render };
})();
