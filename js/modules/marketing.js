/**
 * modules/marketing.js — Supabase Edition
 * Phân quyền mới:
 * - Trưởng phòng Marketing (dept_head, dept=Marketing): quản lý toàn bộ, phân công, duyệt
 * - Trưởng phòng ban KHÁC / Quản lý TT: tạo yêu cầu + theo dõi đơn của mình
 * - Staff/Teacher: tạo yêu cầu + theo dõi đơn của mình
 * - Staff thuộc phòng Marketing: nhận phân công + nộp kết quả
 * - Admin/Exec: xem tất cả
 */

const MarketingModule = (() => {
  let activeTab = 'requests';

  const CATEGORIES = {
    design: 'Thiết kế', digital: 'Digital Marketing', media: 'Truyền thông',
    event: 'Tổ chức sự kiện', video: 'Quay phim', photo: 'Chụp ảnh',
    print: 'In ấn', content: 'Nội dung',
  };

  async function render(root) {
    const user = Auth.getCurrentUser();
    // Trưởng phòng Marketing và admin/exec quản lý toàn bộ
    const isMktManager = user.role === ROLES.ADMIN || user.role === ROLES.EXEC ||
      (user.role === ROLES.DEPT_HEAD && user.dept === 'Marketing');
    // Nhân viên Marketing: nhận phân công
    const isMktStaff = user.dept === 'Marketing' && user.role === ROLES.STAFF;

    root.innerHTML = `
      <div class="tabs">
        ${tab('requests',  'Yêu cầu hỗ trợ')}
        ${tab('proposals', 'Đề xuất kế hoạch')}
      </div>
      <div id="mktBody"></div>
    `;
    root.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => { activeTab = t.dataset.tab; render(root); }));

    const body = root.querySelector('#mktBody');
    if (activeTab === 'requests') await renderRequests(body, user, isMktManager, isMktStaff);
    else await renderProposals(body, user, isMktManager);
  }

  function tab(key, label) { return `<div class="tab ${activeTab === key ? 'active' : ''}" data-tab="${key}">${label}</div>`; }

  // ─── YÊU CẦU HỖ TRỢ ──────────────────────────────────────────────────────

  async function renderRequests(root, user, isMktManager, isMktStaff) {
    const all   = await DB.getTable('mkt_requests:');
    const users = await DB.getTable('users:');

    let visible;
    if (isMktManager) {
      visible = all; // quản lý thấy tất cả
    } else if (isMktStaff) {
      // Nhân viên MKT: thấy việc được phân công + đơn mình tạo
      visible = all.filter((r) => r.requestedBy === user.id || r.assignedTo === user.id);
    } else {
      // Người dùng khác: chỉ thấy đơn mình tạo
      visible = all.filter((r) => r.requestedBy === user.id);
    }
    visible.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const hint = isMktManager
      ? 'Tiếp nhận, phân công và theo dõi tiến độ'
      : isMktStaff
        ? 'Yêu cầu bạn tạo và công việc được phân công cho bạn'
        : 'Yêu cầu bạn đã gửi tới phòng Marketing';

    root.innerHTML = `
      <div class="flex-between mb-md">
        <div class="text-faint" style="font-size:12.5px;">${hint}</div>
        <button class="btn btn-primary" id="btnNewReq">+ Tạo yêu cầu</button>
      </div>
      ${visible.length === 0 ? UI.emptyState('📣', 'Chưa có yêu cầu nào.') : `
        <div class="content-grid cols-2">
          ${visible.map((r) => requestCard(r, users, isMktManager, isMktStaff, user)).join('')}
        </div>
      `}
    `;

    root.querySelector('#btnNewReq').addEventListener('click', () => openNewRequestModal(user));
    root.querySelectorAll('[data-manage]').forEach((btn) => btn.addEventListener('click', () => openManageModal(btn.dataset.manage, users, isMktManager, isMktStaff, user)));
  }

  function requestCard(r, users, isMktManager, isMktStaff, currentUser) {
    const requester = users.find((u) => u.id === r.requestedBy);
    const assignee  = users.find((u) => u.id === r.assignedTo);
    const isMyTask  = r.assignedTo === currentUser.id;

    return `<div class="card">
      <div class="flex-between mb-sm">
        <span class="badge badge-default">${CATEGORIES[r.category] || r.category}</span>
        ${UI.priorityPill(r.priority)}
      </div>
      <h3 style="font-size:14.5px;margin-bottom:6px;">${UI.escapeHtml(r.title)}</h3>
      <div class="text-faint" style="font-size:12px;">Người yêu cầu: ${requester?.name || r.requestedBy}</div>
      <div class="text-faint" style="font-size:12px;">Hạn xử lý: ${r.deadline ? UI.formatDate(r.deadline) : '—'}</div>
      ${r.result ? `<div style="margin-top:8px;padding:6px 8px;background:var(--color-primary-light);border-radius:6px;font-size:12px;"><strong>Kết quả:</strong> ${UI.escapeHtml(r.result)}</div>` : ''}
      ${r.resultFileUrl ? `<a href="${r.resultFileUrl}" target="_blank" style="font-size:12px;color:var(--color-primary);display:block;margin-top:4px;">📎 Xem file kết quả</a>` : ''}
      <div class="flex-between mt-md">
        ${UI.statusBadge(r.status)}
        <span class="text-faint" style="font-size:12px;">${assignee ? '👤 ' + assignee.name : 'Chưa phân công'}</span>
      </div>
      ${(isMktManager || isMyTask) ? `<button class="btn btn-secondary btn-sm mt-md" data-manage="${r.id}" style="width:100%;">
        ${isMktManager ? 'Quản lý / Phân công' : 'Cập nhật kết quả'}
      </button>` : ''}
    </div>`;
  }

  function openNewRequestModal(user) {
    const body = `
      <div class="field"><label>Loại yêu cầu</label>
        <select id="reqCategory">${Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Tiêu đề yêu cầu <span style="color:red">*</span></label>
        <input type="text" id="reqTitle" placeholder="VD: Thiết kế poster tuyển sinh hè 2026" /></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="field"><label>Độ ưu tiên</label>
          <select id="reqPriority">
            <option value="low">Thấp</option><option value="medium" selected>Trung bình</option><option value="high">Cao</option>
          </select>
        </div>
        <div class="field"><label>Thời hạn xử lý</label><input type="date" id="reqDeadline" /></div>
      </div>
      <div class="field">
        <label>Đính kèm brief / tài liệu (tùy chọn)</label>
        <input type="file" id="reqFile" accept=".pdf,.doc,.docx,.jpg,.png,.xlsx" />
        <div class="text-faint" style="font-size:12px;margin-top:4px;">File thật — sẽ được lưu lên Supabase Storage</div>
      </div>
    `;
    const footer = `<button class="btn btn-secondary" id="cancelReq">Hủy</button>
                    <button class="btn btn-primary" id="submitReq">Gửi yêu cầu</button>`;
    UI.openModal('Tạo yêu cầu hỗ trợ Marketing', body, footer);
    document.getElementById('cancelReq').addEventListener('click', UI.closeModal);
    document.getElementById('submitReq').addEventListener('click', async () => {
      const title = document.getElementById('reqTitle').value.trim();
      if (!title) { UI.toast('Vui lòng nhập tiêu đề.', 'error'); return; }

      let attachmentUrl = null;
      const file = document.getElementById('reqFile')?.files[0];
      if (file) {
        try {
          const up = await DB.uploadFile(file, 'mkt_requests');
          attachmentUrl = up.url;
        } catch (e) { UI.toast('Lỗi tải file: ' + e.message, 'error'); return; }
      }

      const id = DB.genId('MKT-REQ');
      const ok = await DB.set(`mkt_requests:${id}`, {
        id, title,
        category:    document.getElementById('reqCategory').value,
        priority:    document.getElementById('reqPriority').value,
        deadline:    document.getElementById('reqDeadline').value || null,
        requestedBy: user.id,
        center:      user.center,
        status:      'pending',
        assignedTo:  null,
        attachmentUrl,
        createdAt:   new Date().toISOString(),
      });
      if (!ok) { UI.toast('Lỗi gửi yêu cầu. Kiểm tra Console (F12) để xem chi tiết.', 'error'); return; }
      UI.closeModal();
      UI.toast('Đã gửi yêu cầu tới phòng Marketing.', 'success');
      App.refreshCurrent();
    });
  }

  async function openManageModal(id, users, isMktManager, isMktStaff, currentUser) {
    const r = await DB.get(`mkt_requests:${id}`);
    const mktStaff = users.filter((u) => u.dept === 'Marketing');
    const isMyTask = r.assignedTo === currentUser.id;

    const body = isMktManager ? `
      <div class="field"><label>Trạng thái</label>
        <select id="mngStatus">
          <option value="pending"     ${r.status === 'pending'     ? 'selected' : ''}>Chờ xử lý</option>
          <option value="in_progress" ${r.status === 'in_progress' ? 'selected' : ''}>Đang xử lý</option>
          <option value="completed"   ${r.status === 'completed'   ? 'selected' : ''}>Hoàn thành</option>
          <option value="rejected"    ${r.status === 'rejected'    ? 'selected' : ''}>Từ chối</option>
        </select>
      </div>
      <div class="field"><label>Phân công nhân sự (có thể phân chính mình)</label>
        <select id="mngAssignTo">
          <option value="">— Chưa phân công —</option>
          ${mktStaff.map((u) => `<option value="${u.id}" ${u.id === r.assignedTo ? 'selected' : ''}>${u.name} ${u.id === currentUser.id ? '(chính bạn)' : ''}</option>`).join('')}
        </select>
      </div>
      ${r.attachmentUrl ? `<div class="field"><a href="${r.attachmentUrl}" target="_blank" style="color:var(--color-primary);">📎 Xem tài liệu yêu cầu</a></div>` : ''}
    ` : `
      <div class="field"><label>Kết quả công việc</label>
        <textarea id="mngResult" placeholder="Mô tả kết quả đã thực hiện...">${r.result || ''}</textarea>
      </div>
      <div class="field"><label>Upload file kết quả (tùy chọn)</label>
        <input type="file" id="mngFile" />
        ${r.resultFileUrl ? `<a href="${r.resultFileUrl}" target="_blank" style="font-size:12px;color:var(--color-primary);display:block;margin-top:4px;">📎 File kết quả hiện tại</a>` : ''}
      </div>
    `;

    const footer = `<button class="btn btn-secondary" id="cancelMng">Hủy</button>
                    <button class="btn btn-primary" id="saveMng">${isMktManager ? 'Lưu' : 'Nộp kết quả'}</button>`;
    UI.openModal(isMktManager ? 'Quản lý yêu cầu' : 'Nộp kết quả công việc', body, footer);

    document.getElementById('cancelMng').addEventListener('click', UI.closeModal);
    document.getElementById('saveMng').addEventListener('click', async () => {
      if (isMktManager) {
        r.status     = document.getElementById('mngStatus').value;
        r.assignedTo = document.getElementById('mngAssignTo').value || null;
      } else {
        r.result = document.getElementById('mngResult').value.trim();
        const file = document.getElementById('mngFile')?.files[0];
        if (file) {
          try {
            const up = await DB.uploadFile(file, 'mkt_results');
            r.resultFileUrl = up.url;
          } catch (e) { UI.toast('Lỗi tải file: ' + e.message, 'error'); return; }
        }
        if (r.result) r.status = 'completed';
      }
      const ok = await DB.set(`mkt_requests:${id}`, r);
      if (!ok) { UI.toast('Lỗi cập nhật. Kiểm tra Console (F12) để xem chi tiết.', 'error'); return; }
      UI.closeModal();
      UI.toast(isMktManager ? 'Đã cập nhật.' : 'Đã nộp kết quả.', 'success');
      App.refreshCurrent();
    });
  }

  // ─── ĐỀ XUẤT KẾ HOẠCH ────────────────────────────────────────────────────

  async function renderProposals(root, user, isMktManager) {
    const all   = await DB.getTable('proposals:');
    // Trưởng phòng MKT/admin: thấy tất cả đề xuất Marketing
    // Người khác: thấy đề xuất mình tạo
    const proposals = all.filter((p) =>
      p.module === 'marketing' && (isMktManager || p.createdBy === user.id)
    );
    proposals.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const users = await DB.getTable('users:');

    root.innerHTML = `
      <div class="flex-between mb-md">
        <div class="text-faint" style="font-size:12.5px;">Quy trình: Trưởng phòng MKT tạo → Ban Điều hành duyệt (Cấp 2)</div>
        ${isMktManager ? `<button class="btn btn-primary" id="btnNewMktProp">+ Tạo đề xuất</button>` : ''}
      </div>
      ${proposals.length === 0 ? UI.emptyState('📋', 'Chưa có đề xuất kế hoạch.') : `
        <div class="table-wrap"><table>
          <thead><tr><th>Mã</th><th>Tiêu đề</th><th>Người tạo</th><th>Ngày tạo</th><th>Trạng thái</th><th></th></tr></thead>
          <tbody>${proposals.map((p) => {
            const creator = users.find((u) => u.id === p.createdBy);
            return `<tr class="clickable" data-id="${p.id}">
              <td class="mono" style="font-size:12px;">${p.id}</td>
              <td>${UI.escapeHtml(p.title)}</td>
              <td>${creator?.name || p.createdBy}</td>
              <td>${UI.formatDate(p.createdAt)}</td>
              <td>${UI.statusBadge(p.status)}</td>
              <td><button class="btn btn-secondary btn-sm">Xem</button></td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>
      `}
    `;
    if (isMktManager) root.querySelector('#btnNewMktProp').addEventListener('click', () => openCreateProposal(user));
    root.querySelectorAll('tr.clickable').forEach((tr) => tr.addEventListener('click', () => openProposalDetail(tr.dataset.id, user, isMktManager, users)));
  }

  async function openCreateProposal(user) {
    const body = `
      <div class="field"><label>Tiêu đề đề xuất <span style="color:red">*</span></label>
        <input type="text" id="mktPropTitle" placeholder="VD: Ngân sách quảng cáo Facebook tháng 8" /></div>
      <div class="field"><label>Nội dung chi tiết <span style="color:red">*</span></label>
        <textarea id="mktPropDesc" placeholder="Mô tả kế hoạch, ngân sách, mục tiêu..."></textarea></div>
      <div class="field">
        <label>Đính kèm tài liệu (tùy chọn)</label>
        <input type="file" id="mktPropFile" accept=".pdf,.doc,.docx,.xlsx,.pptx,.jpg,.png" />
      </div>
    `;
    const footer = `<button class="btn btn-secondary" id="cancelMktProp">Hủy</button>
                    <button class="btn btn-primary" id="submitMktProp">Gửi đề xuất</button>`;
    UI.openModal('Tạo đề xuất kế hoạch Marketing', body, footer);
    document.getElementById('cancelMktProp').addEventListener('click', UI.closeModal);
    document.getElementById('submitMktProp').addEventListener('click', async () => {
      const title       = document.getElementById('mktPropTitle').value.trim();
      const description = document.getElementById('mktPropDesc').value.trim();
      if (!title || !description) { UI.toast('Vui lòng nhập đầy đủ.', 'error'); return; }

      let attachments = [];
      const file = document.getElementById('mktPropFile')?.files[0];
      if (file) {
        try {
          const up = await DB.uploadFile(file, 'proposals');
          attachments = [{ name: up.name, type: up.type, url: up.url }];
        } catch (e) { UI.toast('Lỗi tải file: ' + e.message, 'error'); return; }
      }

      const id = DB.genId('PRP');
      const ok = await DB.set(`proposals:${id}`, {
        id, title, description, type: 'marketing_plan', module: 'marketing',
        center: user.center || null, createdBy: user.id, createdAt: new Date().toISOString(),
        attachments, status: 'pending_level2',
        history: [
          { step: 'created', by: user.id, at: new Date().toISOString(), note: 'Tạo đề xuất' },
          { step: 'level1_approved', by: user.id, at: new Date().toISOString(), note: 'Tự duyệt cấp 1 (Trưởng phòng Marketing)' },
        ],
      });
      if (!ok) { UI.toast('Lỗi gửi đề xuất. Kiểm tra Console (F12) để xem chi tiết.', 'error'); return; }
      UI.closeModal();
      UI.toast('Đã gửi đề xuất lên Ban Điều hành.', 'success');
      App.refreshCurrent();
    });
  }

  async function openProposalDetail(id, user, isMktManager, users) {
    const p       = await DB.get(`proposals:${id}`);
    if (!p) return;
    const creator = users.find((u) => u.id === p.createdBy);

    const body = `
      <div class="mb-md">
        <div class="text-faint mono" style="font-size:12px;">${p.id}</div>
        <h3 style="margin-top:4px;">${UI.escapeHtml(p.title)}</h3>
      </div>
      <div class="flex-row gap-sm mb-md">
        ${UI.statusBadge(p.status)}
        <span class="text-faint" style="font-size:12.5px;">Tạo bởi ${creator?.name || p.createdBy} · ${UI.formatDate(p.createdAt)}</span>
      </div>
      <div class="card" style="background:var(--color-bg);margin-bottom:16px;">
        <div style="font-size:13.5px;line-height:1.6;">${UI.escapeHtml(p.description)}</div>
        ${(p.attachments || []).length ? `<div class="mt-md">${p.attachments.map((a) =>
          a.url ? `<a href="${a.url}" target="_blank" class="attachment-chip">📎 ${UI.escapeHtml(a.name)}</a>` : UI.attachmentChip(a)
        ).join('')}</div>` : ''}
      </div>
      <div class="section-head"><h3 style="font-size:14px;">Lịch sử xử lý</h3></div>
      <div class="timeline">${(p.history || []).map((h) => `
        <div class="timeline-step ${h.step.includes('rejected') ? 'rejected' : 'done'}">
          <div class="timeline-dot">${h.step.includes('rejected') ? '✕' : '✓'}</div>
          <div class="timeline-title">${histLabel(h.step)}</div>
          <div class="timeline-meta">${users.find((u) => u.id === h.by)?.name || h.by} · ${UI.formatDateTime(h.at)}</div>
          ${h.note ? `<div class="timeline-note">${UI.escapeHtml(h.note)}</div>` : ''}
        </div>`).join('')}
      </div>
    `;

    UI.openModal('Chi tiết đề xuất', body, `<button class="btn btn-secondary" id="closeMktDetail">Đóng</button>`);
    document.getElementById('closeMktDetail').addEventListener('click', UI.closeModal);
  }

  function histLabel(step) {
    const m = { created: 'Tạo đề xuất', level1_approved: 'Duyệt cấp 1', level1_rejected: 'Từ chối cấp 1', level2_approved: 'Ban Điều hành phê duyệt', level2_rejected: 'Ban Điều hành từ chối' };
    return m[step] || step;
  }

  return { render };
})();
