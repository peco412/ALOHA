/**
 * modules/operations.js
 * Trung tâm Điều hành — phân hệ quản trị cấp cao.
 * - Tiếp nhận toàn bộ đề xuất từ Marketing/Kế toán/Nhân sự/Quản lý trung tâm
 * - Duyệt cấp 2 / Phê duyệt / Từ chối / Yêu cầu chỉnh sửa
 * - Quản lý trạng thái toàn hệ thống
 * - Ban hành thông báo toàn hệ thống (UI dùng lại NotificationsModule)
 */

const OperationsModule = (() => {
  const STATUS_TABS = [
    { key: 'pending_level2', label: 'Chờ duyệt cấp 2' },
    { key: 'pending_level1', label: 'Đang chờ cấp 1' },
    { key: 'approved', label: 'Đã phê duyệt' },
    { key: 'rejected', label: 'Từ chối' },
    { key: 'all', label: 'Tất cả' },
  ];

  let currentTab = 'pending_level2';

  async function render(root) {
    const user = Auth.getCurrentUser();
    if (!canApproveLevel2(user.role)) {
      root.innerHTML = UI.emptyState('🔒', 'Bạn không có quyền truy cập phân hệ Trung tâm Điều hành.');
      return;
    }

    const proposals = await DB.getTable('proposals:');
    const stats = computeStats(proposals);

    root.innerHTML = `
      <div class="content-grid cols-4 mb-md">
        ${statCard('Chờ duyệt cấp 2', stats.pending_level2, '🕒')}
        ${statCard('Đang chờ cấp 1', stats.pending_level1, '📥')}
        ${statCard('Đã phê duyệt', stats.approved, '✅')}
        ${statCard('Từ chối', stats.rejected, '⛔')}
      </div>

      <div class="card section-block">
        <div class="flex-between mb-md">
          <div>
            <h3>Đề xuất toàn hệ thống</h3>
            <div class="text-faint" style="font-size:12.5px;">Marketing · Kế toán · Nhân sự · Quản lý trung tâm</div>
          </div>
          <button class="btn btn-secondary btn-sm" id="btnBroadcast">📢 Ban hành thông báo toàn hệ thống</button>
        </div>
        <div class="tabs" id="opsTabs"></div>
        <div id="opsTableWrap"></div>
      </div>
    `;

    renderTabs(root, proposals);
    renderTable(root, proposals);

    root.querySelector('#btnBroadcast').addEventListener('click', () => openBroadcastModal());
  }

  function computeStats(proposals) {
    return {
      pending_level2: proposals.filter((p) => p.status === 'pending_level2').length,
      pending_level1: proposals.filter((p) => p.status === 'pending_level1').length,
      approved: proposals.filter((p) => p.status === 'approved').length,
      rejected: proposals.filter((p) => p.status === 'rejected').length,
    };
  }

  function statCard(label, value, icon) {
    return `<div class="card stat-card">
      <div class="flex-between"><div class="stat-value">${value}</div><div style="font-size:20px;">${icon}</div></div>
      <div class="stat-label">${label}</div>
    </div>`;
  }

  function renderTabs(root, proposals) {
    const wrap = root.querySelector('#opsTabs');
    wrap.innerHTML = STATUS_TABS.map((t) => {
      const count = t.key === 'all' ? proposals.length : proposals.filter((p) => p.status === t.key).length;
      return `<div class="tab ${currentTab === t.key ? 'active' : ''}" data-tab="${t.key}">${t.label} <span class="text-faint">(${count})</span></div>`;
    }).join('');
    wrap.querySelectorAll('.tab').forEach((el) => {
      el.addEventListener('click', () => { currentTab = el.dataset.tab; render(document.getElementById('content')); });
    });
  }

  function renderTable(root, proposals) {
    const filtered = currentTab === 'all' ? proposals : proposals.filter((p) => p.status === currentTab);
    filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const wrap = root.querySelector('#opsTableWrap');

    if (filtered.length === 0) {
      wrap.innerHTML = UI.emptyState('📭', 'Không có đề xuất nào trong mục này.');
      return;
    }

    wrap.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Mã đề xuất</th><th>Tiêu đề</th><th>Phân hệ</th><th>Người tạo</th><th>Ngày tạo</th><th>Trạng thái</th><th></th>
          </tr></thead>
          <tbody>
            ${filtered.map((p) => rowHtml(p)).join('')}
          </tbody>
        </table>
      </div>
    `;

    wrap.querySelectorAll('tr.clickable').forEach((tr) => {
      tr.addEventListener('click', () => openDetailModal(tr.dataset.id));
    });
  }

  function rowHtml(p) {
    return `<tr class="clickable" data-id="${p.id}">
      <td class="mono">${p.id}</td>
      <td>${UI.escapeHtml(p.title)}</td>
      <td>${moduleLabel(p.module)}</td>
      <td>${creatorName(p.createdBy)}</td>
      <td>${UI.formatDate(p.createdAt)}</td>
      <td>${UI.statusBadge(p.status)}</td>
      <td><button class="btn btn-secondary btn-sm">Xem</button></td>
    </tr>`;
  }

  function moduleLabel(mod) {
    const map = { center: 'Quản lý Trung tâm', marketing: 'Marketing', accounting: 'Kế toán', hr: 'Nhân sự' };
    return map[mod] || mod;
  }

  // Cache tên người dùng để không phải query lại nhiều lần
  let userCache = null;
  function creatorName(userId) {
    if (!userCache) return userId;
    const u = userCache.find((x) => x.id === userId);
    return u ? u.name : userId;
  }

  async function openDetailModal(proposalId) {
    if (!userCache) userCache = await DB.getTable('users:');
    const p = await DB.get(`proposals:${proposalId}`);
    if (!p) return;

    const user = Auth.getCurrentUser();
    const canAct = p.status === 'pending_level2' && canApproveLevel2(user.role);

    const body = `
      <div class="mb-md">
        <div class="text-faint mono" style="font-size:12px;">${p.id}</div>
        <h3 style="margin-top:4px;">${UI.escapeHtml(p.title)}</h3>
      </div>
      <div class="flex-row gap-sm mb-md">
        ${UI.statusBadge(p.status)}
        <span class="text-faint" style="font-size:12.5px;">Phân hệ: ${moduleLabel(p.module)} · Tạo bởi ${creatorName(p.createdBy)} · ${UI.formatDate(p.createdAt)}</span>
      </div>
      <div class="card" style="background:var(--color-bg); margin-bottom:18px;">
        <div style="font-size:13.5px; line-height:1.6;">${UI.escapeHtml(p.description)}</div>
        ${p.attachments && p.attachments.length ? `<div class="mt-md">${p.attachments.map((a) =>
          a.url ? `<a href="${a.url}" target="_blank" class="attachment-chip">📎 ${UI.escapeHtml(a.name)}</a>` : UI.attachmentChip(a)
        ).join('')}</div>` : ''}
      </div>

      <div class="section-head"><h3 style="font-size:14px;">Lịch sử xử lý</h3></div>
      ${renderTimeline(p)}

      ${canAct ? `
        <div class="field mt-md">
          <label for="opsNote">Ghi chú duyệt (tùy chọn)</label>
          <textarea id="opsNote" placeholder="Nhập ghi chú cho quyết định của bạn..."></textarea>
        </div>
      ` : ''}
    `;

    const footer = canAct ? `
      <button class="btn btn-secondary" id="btnRequestEdit">Yêu cầu chỉnh sửa</button>
      <button class="btn btn-danger" id="btnReject">Từ chối</button>
      <button class="btn btn-primary" id="btnApprove">Phê duyệt</button>
    ` : `<button class="btn btn-secondary" id="btnCloseOnly">Đóng</button>`;

    UI.openModal('Chi tiết đề xuất', body, footer);

    if (canAct) {
      document.getElementById('btnApprove').addEventListener('click', () => decide(p, 'level2_approved', 'approved'));
      document.getElementById('btnReject').addEventListener('click', () => decide(p, 'level2_rejected', 'rejected'));
      document.getElementById('btnRequestEdit').addEventListener('click', () => decide(p, 'level2_request_edit', 'pending_level1'));
    } else {
      document.getElementById('btnCloseOnly').addEventListener('click', UI.closeModal);
    }
  }

  function renderTimeline(p) {
    const stepLabels = {
      created: 'Tạo đề xuất',
      level1_approved: 'Duyệt cấp 1',
      level1_rejected: 'Từ chối ở cấp 1',
      level2_approved: 'Duyệt cấp 2 — Phê duyệt',
      level2_rejected: 'Từ chối ở cấp 2',
      level2_request_edit: 'Yêu cầu chỉnh sửa (cấp 2)',
    };
    const items = p.history.map((h) => {
      const stateCls = h.step.includes('rejected') ? 'rejected' : 'done';
      return `<div class="timeline-step ${stateCls}">
        <div class="timeline-dot">${h.step.includes('rejected') ? '✕' : '✓'}</div>
        <div class="timeline-title">${stepLabels[h.step] || h.step}</div>
        <div class="timeline-meta">${creatorName(h.by)} · ${UI.formatDateTime(h.at)}</div>
        ${h.note ? `<div class="timeline-note">${UI.escapeHtml(h.note)}</div>` : ''}
      </div>`;
    }).join('');

    // Bước tương lai nếu vẫn đang chờ
    let futureStep = '';
    if (p.status === 'pending_level1') {
      futureStep = `<div class="timeline-step pending"><div class="timeline-dot">⏳</div><div class="timeline-title">Chờ duyệt cấp 1</div></div>
        <div class="timeline-step future"><div class="timeline-dot"></div><div class="timeline-title text-faint">Duyệt cấp 2</div></div>`;
    } else if (p.status === 'pending_level2') {
      futureStep = `<div class="timeline-step pending"><div class="timeline-dot">⏳</div><div class="timeline-title">Chờ duyệt cấp 2</div></div>`;
    }

    return `<div class="timeline">${items}${futureStep}</div>`;
  }

  async function decide(p, step, newStatus) {
    const user = Auth.getCurrentUser();
    const note = document.getElementById('opsNote')?.value.trim() || '';
    p.status = newStatus;
    p.history.push({ step, by: user.id, at: new Date().toISOString(), note });
    const ok = await DB.set(`proposals:${p.id}`, p);
    if (!ok) { UI.toast('Lỗi cập nhật đề xuất. Kiểm tra Console (F12) để xem chi tiết.', 'error'); return; }
    UI.closeModal();
    UI.toast(
      newStatus === 'approved' ? 'Đã phê duyệt đề xuất.' : newStatus === 'rejected' ? 'Đã từ chối đề xuất.' : 'Đã gửi yêu cầu chỉnh sửa.',
      newStatus === 'approved' ? 'success' : newStatus === 'rejected' ? 'error' : 'default'
    );
    App.refreshCurrent();
  }

  function openBroadcastModal() {
    NotificationsModule.openComposeModal({ scope: 'all', lockScope: true, onDone: () => App.refreshCurrent() });
  }

  return { render };
})();
