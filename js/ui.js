/**
 * ui.js
 * Các hàm dựng UI dùng chung — mọi module nghiệp vụ gọi qua đây để
 * giao diện đồng nhất (badge trạng thái, modal, toast, định dạng ngày/tiền...).
 */

const UI = (() => {
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function formatDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  }

  function formatMoney(n) {
    if (n === null || n === undefined) return '—';
    return Number(n).toLocaleString('vi-VN') + ' đ';
  }

  // Nhãn + class CSS cho từng trạng thái dùng trong toàn hệ thống
  const STATUS_MAP = {
    pending_level1: { label: 'Chờ duyệt cấp 1', cls: 'badge-pending' },
    pending_level2: { label: 'Chờ duyệt cấp 2', cls: 'badge-pending' },
    pending: { label: 'Chờ duyệt', cls: 'badge-pending' },
    in_progress: { label: 'Đang xử lý', cls: 'badge-progress' },
    approved: { label: 'Đã phê duyệt', cls: 'badge-approved' },
    rejected: { label: 'Từ chối', cls: 'badge-rejected' },
    completed: { label: 'Hoàn thành', cls: 'badge-approved' },
    active: { label: 'Đang hoạt động', cls: 'badge-approved' },
    planning: { label: 'Đang lên kế hoạch', cls: 'badge-pending' },
    studying: { label: 'Đang học', cls: 'badge-approved' },
    lead: { label: 'Tư vấn', cls: 'badge-default' },
  };

  function statusBadge(status) {
    const meta = STATUS_MAP[status] || { label: status, cls: 'badge-default' };
    return `<span class="badge ${meta.cls}"><span class="dot"></span>${escapeHtml(meta.label)}</span>`;
  }

  function priorityPill(priority) {
    const map = { high: ['Cao', 'priority-high'], medium: ['Trung bình', 'priority-medium'], low: ['Thấp', 'priority-low'] };
    const [label, cls] = map[priority] || ['—', 'priority-medium'];
    return `<span class="priority-pill ${cls}">${label}</span>`;
  }

  function toast(message, type = 'default') {
    const stack = document.getElementById('toastStack');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  function openModal(title, bodyHtml, footerHtml = '') {
    const root = document.getElementById('modalRoot');
    root.innerHTML = `
      <div class="modal-overlay" id="modalOverlay">
        <div class="modal">
          <div class="modal-header">
            <h3>${title}</h3>
            <button class="modal-close" id="modalCloseBtn">&times;</button>
          </div>
          <div class="modal-body">${bodyHtml}</div>
          ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ''}
        </div>
      </div>
    `;
    const overlay = document.getElementById('modalOverlay');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
  }

  function closeModal() {
    document.getElementById('modalRoot').innerHTML = '';
  }

  function emptyState(glyph, message) {
    return `<div class="empty-state"><div class="glyph">${glyph}</div><div class="msg">${escapeHtml(message)}</div></div>`;
  }

  function userInitials(name) {
    if (!name) return '--';
    const parts = name.trim().split(/\s+/);
    return parts[parts.length - 1][0].toUpperCase();
  }

  function attachmentChip(att) {
    const iconMap = { PDF: '📄', Word: '📝', Excel: '📊', 'Hình ảnh': '🖼️' };
    // Không có URL hợp lệ => không phải link thật, hiển thị rõ ràng là không xem được
    // (thường do file upload thất bại khi tạo bản ghi này, hoặc dữ liệu cũ trước khi sửa lỗi)
    return `<span class="attachment-chip" style="opacity:0.6; cursor:not-allowed;" title="File này không có đường dẫn hợp lệ — có thể do lỗi khi upload lúc tạo. Vui lòng tạo lại đính kèm.">${iconMap[att.type] || '📎'} ${escapeHtml(att.name)} (không xem được)</span>`;
  }

  return {
    escapeHtml, formatDate, formatDateTime, formatMoney,
    statusBadge, priorityPill, toast, openModal, closeModal,
    emptyState, userInitials, attachmentChip,
  };
})();
