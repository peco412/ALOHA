/**
 * modules/notifications.js
 * - Mọi vai trò: xem danh sách, tìm kiếm, đánh dấu đã đọc/chưa đọc
 * - Vai trò quản lý: ban hành thông báo theo phạm vi (toàn hệ thống / phòng ban / trung tâm / nhóm)
 *
 * Trạng thái "đã đọc" lưu theo user trong cùng object thông báo (mảng readBy)
 * để đơn giản hóa demo — bản thật nên tách bảng riêng (notification_reads).
 */

const NotificationsModule = (() => {
  let searchTerm = '';

  async function render(root) {
    const user = Auth.getCurrentUser();
    const all = await DB.getTable('notifications:');
    const visible = filterByScope(all, user);
    visible.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const canCompose = isDeptOrCenterManager(user.role) || user.role === ROLES.EXEC;

    root.innerHTML = `
      <div class="flex-between mb-md">
        <input type="text" class="field" id="searchNotif" placeholder="🔍 Tìm thông báo..." style="max-width:320px; padding:9px 12px; border:1px solid var(--color-border); border-radius:6px; width:100%;" value="${UI.escapeHtml(searchTerm)}" />
        ${canCompose ? `<button class="btn btn-primary" id="btnCompose">+ Ban hành thông báo</button>` : ''}
      </div>
      <div id="notifList"></div>
    `;

    renderList(visible.filter(matchSearch));

    root.querySelector('#searchNotif').addEventListener('input', (e) => {
      searchTerm = e.target.value;
      renderList(visible.filter(matchSearch));
    });

    if (canCompose) {
      root.querySelector('#btnCompose').addEventListener('click', () => openComposeModal({}));
    }
  }

  function matchSearch(n) {
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase();
    return n.title.toLowerCase().includes(s) || n.body.toLowerCase().includes(s);
  }

  function filterByScope(all, user) {
    return all.filter((n) => {
      if (n.scope === 'all') return true;
      if (n.scope.startsWith('dept:')) return n.scope === `dept:${user.dept}`;
      if (n.scope.startsWith('center:')) return n.scope === `center:${user.center}`;
      if (n.scope.startsWith('role:')) return n.scope === `role:${user.role}`;
      return true;
    });
  }

  function renderList(items) {
    const wrap = document.getElementById('notifList');
    if (!wrap) return;
    if (items.length === 0) {
      wrap.innerHTML = UI.emptyState('🔔', 'Không có thông báo nào.');
      return;
    }
    const user = Auth.getCurrentUser();
    wrap.innerHTML = items.map((n) => {
      const isRead = (n.readBy || []).includes(user.id);
      return `<div class="card mb-sm" style="${isRead ? '' : 'border-left:3px solid var(--color-primary);'}" data-id="${n.id}">
        <div class="flex-between">
          <div style="flex:1;">
            <div class="flex-row gap-sm mb-sm">
              <strong style="font-size:14.5px;">${UI.escapeHtml(n.title)}</strong>
              ${!isRead ? '<span class="badge badge-pending">Mới</span>' : ''}
              <span class="badge badge-default">${scopeLabel(n.scope)}</span>
            </div>
            <div class="text-muted" style="font-size:13px; line-height:1.5;">${UI.escapeHtml(n.body)}</div>
            <div class="text-faint mt-sm" style="font-size:12px;">${UI.formatDateTime(n.createdAt)}</div>
          </div>
          <button class="btn btn-ghost btn-sm toggle-read" data-id="${n.id}">${isRead ? 'Đánh dấu chưa đọc' : 'Đánh dấu đã đọc'}</button>
        </div>
      </div>`;
    }).join('');

    wrap.querySelectorAll('.toggle-read').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await toggleRead(btn.dataset.id);
        App.refreshCurrent();
      });
    });
  }

  function scopeLabel(scope) {
    if (scope === 'all') return 'Toàn hệ thống';
    if (scope.startsWith('dept:')) return 'Phòng ' + scope.split(':')[1];
    if (scope.startsWith('center:')) return 'Trung tâm';
    if (scope.startsWith('role:')) return 'Theo vai trò';
    return scope;
  }

  async function toggleRead(notifId) {
    const user = Auth.getCurrentUser();
    const n = await DB.get(`notifications:${notifId}`);
    if (!n) return;
    n.readBy = n.readBy || [];
    const idx = n.readBy.indexOf(user.id);
    if (idx >= 0) n.readBy.splice(idx, 1); else n.readBy.push(user.id);
    const ok = await DB.set(`notifications:${notifId}`, n);
    if (!ok) UI.toast('Lỗi cập nhật trạng thái đọc. Kiểm tra Console (F12).', 'error');
  }

  /**
   * options:
   *  - scope: giá trị mặc định cho phạm vi gửi
   *  - lockScope: true => không cho đổi phạm vi (dùng khi ban hành từ Trung tâm Điều hành = toàn hệ thống)
   *  - onDone: callback sau khi gửi thành công
   */
  async function openComposeModal(options = {}) {
    const user = Auth.getCurrentUser();
    const centers = (await DB.get('meta:centers')) || [];
    const lockScope = !!options.lockScope;
    const defaultScope = options.scope || 'all';

    const scopeOptions = [
      { value: 'all', label: 'Toàn hệ thống' },
      { value: `dept:${user.dept}`, label: `Phòng ${user.dept}` },
      ...centers.map((c) => ({ value: `center:${c.id}`, label: `Trung tâm ${c.name}` })),
    ];

    const body = `
      <div class="field">
        <label>Tiêu đề thông báo</label>
        <input type="text" id="notifTitle" placeholder="VD: Lịch họp giao ban tháng 7" />
      </div>
      <div class="field">
        <label>Nội dung</label>
        <textarea id="notifBody" placeholder="Nội dung chi tiết..."></textarea>
      </div>
      <div class="field">
        <label>Gửi theo</label>
        <select id="notifScope" ${lockScope ? 'disabled' : ''}>
          ${scopeOptions.map((o) => `<option value="${o.value}" ${o.value === defaultScope ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
        ${lockScope ? '<div class="text-faint mt-sm" style="font-size:12px;">Thông báo từ Trung tâm Điều hành luôn gửi toàn hệ thống.</div>' : ''}
      </div>
      <div class="field">
        <label>Hẹn lịch phát hành (tùy chọn)</label>
        <input type="datetime-local" id="notifSchedule" />
      </div>
    `;
    const footer = `
      <button class="btn btn-secondary" id="cancelNotif">Hủy</button>
      <button class="btn btn-primary" id="submitNotif">Ban hành</button>
    `;
    UI.openModal('Ban hành thông báo', body, footer);

    document.getElementById('cancelNotif').addEventListener('click', UI.closeModal);
    document.getElementById('submitNotif').addEventListener('click', async () => {
      const title = document.getElementById('notifTitle').value.trim();
      const bodyText = document.getElementById('notifBody').value.trim();
      const scope = document.getElementById('notifScope').value;
      const schedule = document.getElementById('notifSchedule').value;

      if (!title || !bodyText) {
        UI.toast('Vui lòng nhập tiêu đề và nội dung.', 'error');
        return;
      }

      const id = DB.genId('NTF');
      const isScheduled = !!schedule && new Date(schedule) > new Date();
      const ok = await DB.set(`notifications:${id}`, {
        id, title, body: bodyText, scope,
        createdBy: user.id,
        createdAt: isScheduled ? new Date(schedule).toISOString() : new Date().toISOString(),
        readBy: [],
        scheduled: isScheduled,
      });
      if (!ok) { UI.toast('Lỗi ban hành thông báo. Kiểm tra Console (F12) để xem chi tiết.', 'error'); return; }

      UI.closeModal();
      UI.toast(isScheduled ? 'Đã hẹn lịch phát hành thông báo.' : 'Đã ban hành thông báo.', 'success');
      if (options.onDone) options.onDone();
      App.refreshCurrent();
    });
  }

  return { render, openComposeModal };
})();
