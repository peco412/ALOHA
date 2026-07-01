/**
 * modules/hr.js — Supabase Edition + Tính năng mới
 * Nhân sự:
 * - Danh sách nhân viên + THÊM NHÂN VIÊN MỚI (với upload file ảnh thật)
 * - Kho hồ sơ với tìm kiếm
 * - Biểu mẫu nghỉ phép / công tác (tạo, duyệt, phân công)
 * - Đề xuất kế hoạch (duyệt 2 cấp)
 *
 * Phân quyền mới:
 * - admin, exec, dept_head (Nhân sự): xem tất cả + thêm nhân viên + duyệt
 * - Trưởng phòng ban khác / quản lý trung tâm: chỉ xem danh sách (không duyệt)
 * - staff/teacher: tạo đơn, xem đơn của mình
 */

const HRModule = (() => {
  let activeTab = 'staff';

  async function render(root) {
    const user = Auth.getCurrentUser();
    const isHRManager = (user.role === ROLES.ADMIN) ||
      (user.role === ROLES.EXEC) ||
      (user.role === ROLES.DEPT_HEAD && user.dept === 'Nhân sự');
    const canViewStaff = isHRManager || user.role === ROLES.DEPT_HEAD || user.role === ROLES.CENTER_MANAGER;

    root.innerHTML = `
      <div class="tabs">
        ${canViewStaff ? tab('staff', 'Danh sách nhân viên') : ''}
        ${canViewStaff ? tab('records', 'Kho hồ sơ') : ''}
        ${tab('forms', 'Biểu mẫu (Nghỉ phép / Công tác)')}
        ${tab('proposals', 'Đề xuất kế hoạch')}
      </div>
      <div id="hrBody"></div>
    `;
    root.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => { activeTab = t.dataset.tab; render(root); }));

    // Đảm bảo tab hợp lệ
    if (!canViewStaff && (activeTab === 'staff' || activeTab === 'records')) activeTab = 'forms';

    const body = root.querySelector('#hrBody');
    if (activeTab === 'staff') await renderStaffList(body, user, isHRManager);
    else if (activeTab === 'records') await renderRecords(body, user, isHRManager);
    else if (activeTab === 'forms') await renderForms(body, user, isHRManager);
    else if (activeTab === 'proposals') await renderHRProposals(body, user, isHRManager);
  }

  function tab(key, label) {
    return `<div class="tab ${activeTab === key ? 'active' : ''}" data-tab="${key}">${label}</div>`;
  }

  // ─── DANH SÁCH NHÂN VIÊN ──────────────────────────────────────────────────

  async function renderStaffList(root, user, isHRManager) {
    const [users, centers] = await Promise.all([
      DB.getTable('users:'),
      DB.get('meta:centers'),
    ]);
    const centersList = centers || [];
    users.sort((a, b) => a.name.localeCompare(b.name, 'vi'));

    // Trưởng phòng ban khác chỉ xem, không thêm mới
    const canAdd = isHRManager;
    const activeCount = users.filter((u) => (u.employmentStatus || 'active') === 'active').length;
    const inactiveCount = users.length - activeCount;

    root.innerHTML = `
      <div class="flex-between mb-md">
        <div class="flex-row gap-sm" style="align-items:center;">
          <input type="text" id="staffSearch" placeholder="🔍 Tìm theo tên, phòng ban..." style="padding:8px 12px; border:1px solid var(--color-border); border-radius:6px; width:280px;" />
          <select id="staffStatusFilter" style="padding:8px 10px; border:1px solid var(--color-border); border-radius:6px;">
            <option value="active">Đang làm việc (${activeCount})</option>
            <option value="all">Tất cả (${users.length})</option>
            <option value="inactive">Đã nghỉ / Tạm ngưng (${inactiveCount})</option>
          </select>
        </div>
        ${canAdd ? `<button class="btn btn-primary" id="btnAddStaff">+ Thêm nhân viên</button>` : '<span class="text-faint" style="font-size:12.5px;">Chỉ xem (không có quyền thêm)</span>'}
      </div>
      <div class="table-wrap" id="staffTableWrap">
        <table>
          <thead><tr><th>Họ tên</th><th>Chức vụ</th><th>Phòng ban</th><th>Trung tâm</th><th>Liên hệ</th><th>Trạng thái</th><th></th></tr></thead>
          <tbody id="staffBody"></tbody>
        </table>
      </div>
    `;

    function draw() {
      const statusFilter = root.querySelector('#staffStatusFilter').value;
      const q = (root.querySelector('#staffSearch').value || '').toLowerCase();
      const filtered = users.filter((u) => {
        const st = u.employmentStatus || 'active';
        const matchStatus = statusFilter === 'all' || (statusFilter === 'active' ? st === 'active' : st !== 'active');
        const matchQuery = !q || u.name.toLowerCase().includes(q) || (u.dept || '').toLowerCase().includes(q);
        return matchStatus && matchQuery;
      });
      root.querySelector('#staffBody').innerHTML = filtered.length === 0
        ? `<tr><td colspan="7">${UI.emptyState('🧑‍💼', 'Không có nhân viên phù hợp.')}</td></tr>`
        : filtered.map((u) => staffRow(u, centersList, isHRManager)).join('');
      root.querySelectorAll('.btnViewProfile').forEach((btn) => {
        btn.addEventListener('click', (e) => { e.stopPropagation(); openStaffProfile(btn.dataset.id, isHRManager); });
      });
      if (isHRManager) {
        root.querySelectorAll('.btnStaffStatus').forEach((btn) => {
          btn.addEventListener('click', (e) => { e.stopPropagation(); openStaffStatusModal(btn.dataset.id); });
        });
      }
    }
    draw();

    root.querySelector('#staffSearch').addEventListener('input', draw);
    root.querySelector('#staffStatusFilter').addEventListener('change', draw);

    if (canAdd) {
      root.querySelector('#btnAddStaff').addEventListener('click', () => openAddStaffModal(centersList));
    }
  }

  function staffRow(u, centers, isHRManager) {
    const centerName = u.center ? (centers.find((c) => c.id === u.center)?.name || u.center) : '—';
    const st = u.employmentStatus || 'active';
    const rowDim = st !== 'active' ? 'opacity:0.6;' : '';
    const avatarHtml = u.avatarUrl
      ? `<img src="${u.avatarUrl}" style="width:30px;height:30px;border-radius:50%;object-fit:cover;flex-shrink:0;" />`
      : `<div class="sidebar-avatar" style="background:var(--color-primary-light);color:var(--color-primary);width:30px;height:30px;font-size:11px;flex-shrink:0;">${UI.userInitials(u.name)}</div>`;
    const nameCell = `<div class="flex-row gap-sm" style="align-items:center;">${avatarHtml}<strong>${UI.escapeHtml(u.name)}</strong></div>`;

    // Người không phải HR/BGD/Admin chỉ thấy thông tin cơ bản
    if (!isHRManager) {
      return `<tr style="${rowDim}">
        <td>${nameCell}</td>
        <td>${UI.escapeHtml(u.dept || '—')}</td>
        <td>${UI.escapeHtml(centerName)}</td>
        <td>${UI.escapeHtml(u.phone || '—')}</td>
        <td>${UI.escapeHtml(u.email || '—')}</td>
        <td></td><td></td>
      </tr>`;
    }

    return `<tr style="${rowDim}">
      <td>${nameCell}</td>
      <td>${UI.escapeHtml(u.position || '—')}</td>
      <td>${UI.escapeHtml(u.dept || '—')}</td>
      <td>${UI.escapeHtml(centerName)}</td>
      <td>${UI.escapeHtml(u.phone || '—')}<br/><span class="text-faint" style="font-size:11px;">${UI.escapeHtml(u.email || '')}</span></td>
      <td>${employmentStatusBadge(st)}</td>
      <td>
        <button class="btn btn-secondary btn-sm btnViewProfile" data-id="${u.id}">Xem hồ sơ</button>
        <button class="btn btn-secondary btn-sm btnStaffStatus" data-id="${u.id}" style="margin-left:4px;">Trạng thái</button>
      </td>
    </tr>`;
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

  async function openStaffStatusModal(userId) {
    const u = await DB.get(`users:${userId}`);
    if (!u) return;
    const body = `
      <div class="mb-md">
        <strong>${UI.escapeHtml(u.name)}</strong>
        <div class="text-faint" style="font-size:12.5px;">${UI.escapeHtml(u.position || '')}</div>
      </div>
      <div class="field">
        <label>Trạng thái việc làm</label>
        <select id="empStatus">
          <option value="active" ${(u.employmentStatus || 'active') === 'active' ? 'selected' : ''}>Đang làm việc</option>
          <option value="on_leave" ${u.employmentStatus === 'on_leave' ? 'selected' : ''}>Nghỉ dài hạn / Thai sản</option>
          <option value="suspended" ${u.employmentStatus === 'suspended' ? 'selected' : ''}>Tạm ngưng công tác</option>
          <option value="terminated" ${u.employmentStatus === 'terminated' ? 'selected' : ''}>Đã nghỉ việc</option>
        </select>
      </div>
      <div class="field">
        <label>Ngày hiệu lực (nếu nghỉ việc/tạm ngưng)</label>
        <input type="date" id="empDate" value="${u.terminationDate || ''}" />
      </div>
      <div class="field">
        <label>Ghi chú / Lý do</label>
        <textarea id="empNote" placeholder="VD: Nghỉ việc theo nguyện vọng cá nhân, bắt đầu nghỉ thai sản từ...">${u.terminationNote || ''}</textarea>
      </div>
      <div class="card" style="background:#fff7ed;border:1px solid #fdba74;font-size:12.5px;color:#9a3412;">
        ⚠️ Lưu ý: hệ thống không xóa cứng hồ sơ nhân viên để giữ nguyên lịch sử lớp học,
        đơn từ, đề xuất đã liên kết. Khi đổi trạng thái "Đã nghỉ việc", nhân viên sẽ
        không đăng nhập được nữa và sẽ ẩn khỏi danh sách mặc định.
      </div>
    `;
    const footer = `<button class="btn btn-secondary" id="cancelEmpStatus">Hủy</button>
                    <button class="btn btn-primary" id="saveEmpStatus">Lưu trạng thái</button>`;
    UI.openModal('Cập nhật trạng thái việc làm', body, footer);
    document.getElementById('cancelEmpStatus').addEventListener('click', UI.closeModal);
    document.getElementById('saveEmpStatus').addEventListener('click', async () => {
      const status = document.getElementById('empStatus').value;
      const date   = document.getElementById('empDate').value || null;
      const note   = document.getElementById('empNote').value.trim();
      u.employmentStatus = status;
      u.terminationDate  = (status === 'terminated' || status === 'suspended') ? date : null;
      u.terminationNote  = note;
      const ok = await DB.set(`users:${u.id}`, u);
      if (!ok) { UI.toast('Lỗi cập nhật trạng thái. Kiểm tra Console (F12).', 'error'); return; }
      UI.closeModal();
      UI.toast('Đã cập nhật trạng thái việc làm.', 'success');
      App.refreshCurrent();
    });
  }

  async function openStaffProfile(userId, isHRManager) {
    const u = await DB.get(`users:${userId}`);
    const centers = (await DB.get('meta:centers')) || [];
    const centerName = u.center ? (centers.find((c) => c.id === u.center)?.name || u.center) : '—';

    const avatarHtml = u.avatarUrl
      ? `<img src="${u.avatarUrl}" style="width:56px;height:56px;border-radius:50%;object-fit:cover;" />`
      : `<div class="sidebar-avatar" style="background:var(--color-primary-light);color:var(--color-primary);width:56px;height:56px;font-size:18px;">${UI.userInitials(u.name)}</div>`;

    const body = `
      <div class="flex-row gap-sm mb-md" style="align-items:center;">
        ${avatarHtml}
        <div>
          <h3 style="font-size:16px;margin:0;">${UI.escapeHtml(u.name)}</h3>
          <div class="text-muted" style="font-size:13px;">${UI.escapeHtml(u.position || '')}</div>
          <div class="text-faint" style="font-size:12px;">${ROLE_LABELS[u.role] || u.role}</div>
        </div>
      </div>
      <table style="width:100%;">
        <tr><td class="text-faint" style="width:160px;">Mã nhân viên</td><td class="mono">${u.id}</td></tr>
        <tr><td class="text-faint">Trạng thái</td><td>${employmentStatusBadge(u.employmentStatus || 'active')}</td></tr>
        <tr><td class="text-faint">Phòng ban</td><td>${UI.escapeHtml(u.dept || '—')}</td></tr>
        <tr><td class="text-faint">Trung tâm</td><td>${UI.escapeHtml(centerName)}</td></tr>
        <tr><td class="text-faint">Số điện thoại</td><td>${UI.escapeHtml(u.phone || '—')}</td></tr>
        <tr><td class="text-faint">Email</td><td>${UI.escapeHtml(u.email || '—')}</td></tr>
        <tr><td class="text-faint">CCCD/CMND</td><td>${UI.escapeHtml(u.idNumber || '—')}</td></tr>
        <tr><td class="text-faint">Địa chỉ</td><td>${UI.escapeHtml(u.address || '—')}</td></tr>
        <tr><td class="text-faint">Ngày vào làm</td><td>${u.hireDate ? UI.formatDate(u.hireDate) : '—'}</td></tr>
        <tr><td class="text-faint">Loại hợp đồng</td><td>${u.contractType === 'parttime' ? 'Bán thời gian' : u.contractType === 'probation' ? 'Thử việc' : 'Chính thức'}</td></tr>
        ${u.terminationDate ? `<tr><td class="text-faint">Ngày hiệu lực</td><td>${UI.formatDate(u.terminationDate)}</td></tr>` : ''}
        ${u.terminationNote ? `<tr><td class="text-faint">Lý do</td><td>${UI.escapeHtml(u.terminationNote)}</td></tr>` : ''}
        ${u.note ? `<tr><td class="text-faint">Ghi chú</td><td>${UI.escapeHtml(u.note)}</td></tr>` : ''}
      </table>
    `;

    const footer = isHRManager
      ? `<button class="btn btn-secondary" id="closeProfile">Đóng</button>
         <button class="btn btn-secondary" id="changeStatus" data-id="${u.id}">Đổi trạng thái</button>
         <button class="btn btn-primary" id="editProfile" data-id="${u.id}">Chỉnh sửa</button>`
      : `<button class="btn btn-secondary" id="closeProfile">Đóng</button>`;

    UI.openModal('Hồ sơ nhân sự', body, footer);
    document.getElementById('closeProfile').addEventListener('click', UI.closeModal);
    if (isHRManager) {
      document.getElementById('editProfile').addEventListener('click', () => {
        UI.closeModal();
        openEditStaffModal(u, centers);
      });
      document.getElementById('changeStatus').addEventListener('click', () => {
        UI.closeModal();
        openStaffStatusModal(u.id);
      });
    }
  }

  async function openAddStaffModal(centers) {
    const body = buildStaffForm(null, centers);
    const footer = `<button class="btn btn-secondary" id="cancelStaff">Hủy</button>
                    <button class="btn btn-primary" id="submitStaff">Thêm nhân viên</button>`;
    UI.openModal('Thêm nhân viên mới', body, footer);
    setupStaffForm(null, centers);
    document.getElementById('cancelStaff').addEventListener('click', UI.closeModal);
    document.getElementById('submitStaff').addEventListener('click', () => saveStaff(null, centers));
  }

  async function openEditStaffModal(u, centers) {
    const body = buildStaffForm(u, centers);
    const footer = `<button class="btn btn-secondary" id="cancelStaff">Hủy</button>
                    <button class="btn btn-primary" id="submitStaff">Lưu thay đổi</button>`;
    UI.openModal('Chỉnh sửa hồ sơ nhân viên', body, footer);
    setupStaffForm(u, centers);
    document.getElementById('cancelStaff').addEventListener('click', UI.closeModal);
    document.getElementById('submitStaff').addEventListener('click', () => saveStaff(u, centers));
  }

  function buildStaffForm(u, centers) {
    const roles = [
      { value: ROLES.STAFF, label: 'Nhân viên' },
      { value: ROLES.TEACHER, label: 'Giáo viên' },
      { value: ROLES.DEPT_HEAD, label: 'Trưởng/Phó phòng ban' },
      { value: ROLES.CENTER_MANAGER, label: 'Quản lý trung tâm' },
      { value: ROLES.EXEC, label: 'Ban Điều hành (TGD/PGD)' },
      { value: ROLES.ADMIN, label: 'Quản trị hệ thống' },
    ];
    const depts = ['Nhân sự', 'Kế toán', 'Marketing', 'Giảng dạy', 'Tư vấn', 'Vận hành', 'IT', 'Ban Điều hành', 'Khác'];
    const contractTypes = [
      { value: 'fulltime', label: 'Hợp đồng chính thức' },
      { value: 'parttime', label: 'Bán thời gian' },
      { value: 'probation', label: 'Thử việc' },
    ];

    return `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        <div class="field" style="grid-column:1/-1;">
          <label>Ảnh đại diện (tùy chọn)</label>
          <input type="file" id="staffAvatar" accept="image/*" />
          ${u?.avatarUrl ? `<img src="${u.avatarUrl}" style="width:48px;height:48px;border-radius:50%;margin-top:6px;object-fit:cover;" />` : ''}
          <div id="avatarPreview" style="margin-top:6px;"></div>
        </div>
        <div class="field">
          <label>Họ và tên <span style="color:red">*</span></label>
          <input type="text" id="staffName" value="${u?.name || ''}" placeholder="Nguyễn Văn A" />
        </div>
        <div class="field">
          <label>Tên đăng nhập <span style="color:red">*</span></label>
          <input type="text" id="staffUsername" value="${u?.username || ''}" placeholder="nv.tena" ${u ? 'readonly style="background:#f5f5f5"' : ''} />
        </div>
        ${!u ? `<div class="field">
          <label>Mật khẩu tạm <span style="color:red">*</span></label>
          <input type="password" id="staffPassword" placeholder="Mật khẩu ban đầu" />
        </div>` : ''}
        <div class="field">
          <label>Chức vụ</label>
          <input type="text" id="staffPosition" value="${u?.position || ''}" placeholder="VD: Nhân viên Kế toán" />
        </div>
        <div class="field">
          <label>Vai trò hệ thống <span style="color:red">*</span></label>
          <select id="staffRole">
            ${roles.map((r) => `<option value="${r.value}" ${u?.role === r.value ? 'selected' : ''}>${r.label}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Phòng ban</label>
          <select id="staffDept">
            <option value="">— Chọn phòng ban —</option>
            ${depts.map((d) => `<option value="${d}" ${u?.dept === d ? 'selected' : ''}>${d}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Trung tâm (nếu có)</label>
          <select id="staffCenter">
            <option value="">— Văn phòng / Không thuộc TT —</option>
            ${(centers || []).map((c) => `<option value="${c.id}" ${u?.center === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Số điện thoại</label>
          <input type="tel" id="staffPhone" value="${u?.phone || ''}" placeholder="0900000000" />
        </div>
        <div class="field">
          <label>Email</label>
          <input type="email" id="staffEmail" value="${u?.email || ''}" placeholder="ten@aloha.edu.vn" />
        </div>
        <div class="field">
          <label>CCCD/CMND</label>
          <input type="text" id="staffIdNumber" value="${u?.idNumber || ''}" placeholder="012345678901" />
        </div>
        <div class="field">
          <label>Ngày vào làm</label>
          <input type="date" id="staffHireDate" value="${u?.hireDate || ''}" />
        </div>
        <div class="field">
          <label>Loại hợp đồng</label>
          <select id="staffContractType">
            ${contractTypes.map((c) => `<option value="${c.value}" ${(u?.contractType || 'fulltime') === c.value ? 'selected' : ''}>${c.label}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="grid-column:1/-1;">
          <label>Địa chỉ</label>
          <input type="text" id="staffAddress" value="${u?.address || ''}" placeholder="Số nhà, đường, quận/huyện, tỉnh" />
        </div>
        <div class="field" style="grid-column:1/-1;">
          <label>Ghi chú</label>
          <textarea id="staffNote" placeholder="Ghi chú thêm về nhân viên...">${u?.note || ''}</textarea>
        </div>
      </div>
    `;
  }

  function setupStaffForm(u, centers) {
    // Preview ảnh
    const avatarInput = document.getElementById('staffAvatar');
    if (avatarInput) {
      avatarInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        document.getElementById('avatarPreview').innerHTML =
          `<img src="${url}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;" />`;
      });
    }
  }

  async function saveStaff(existing, centers) {
    const name = document.getElementById('staffName').value.trim();
    const username = document.getElementById('staffUsername').value.trim();
    const role = document.getElementById('staffRole').value;
    if (!name || !username || !role) { UI.toast('Vui lòng điền tên, tên đăng nhập và vai trò.', 'error'); return; }

    let avatarUrl = existing?.avatarUrl || null;
    const avatarFile = document.getElementById('staffAvatar')?.files[0];
    if (avatarFile) {
      try {
        const uploaded = await DB.uploadFile(avatarFile, 'avatars');
        avatarUrl = uploaded.url;
        UI.toast('Đã tải ảnh lên.', 'success');
      } catch (e) {
        UI.toast('Lỗi tải ảnh: ' + e.message, 'error');
      }
    }

    const password = !existing ? document.getElementById('staffPassword')?.value : null;
    const id = existing?.id || DB.genId('u');
    const data = {
      id, username, name, role,
      position: document.getElementById('staffPosition').value.trim(),
      dept: document.getElementById('staffDept').value,
      center: document.getElementById('staffCenter').value || null,
      phone: document.getElementById('staffPhone').value.trim(),
      email: document.getElementById('staffEmail').value.trim(),
      idNumber: document.getElementById('staffIdNumber').value.trim(),
      hireDate: document.getElementById('staffHireDate').value || null,
      contractType: document.getElementById('staffContractType').value,
      address: document.getElementById('staffAddress').value.trim(),
      note: document.getElementById('staffNote').value.trim(),
      avatarUrl,
      ...(password ? { passwordHash: password } : {}),
    };

    const ok = await DB.set(`users:${id}`, data);
    if (ok) {
      UI.closeModal();
      UI.toast(existing ? 'Đã cập nhật hồ sơ nhân viên.' : 'Đã thêm nhân viên mới vào hệ thống.', 'success');
      App.refreshCurrent();
    } else {
      UI.toast('Lỗi lưu dữ liệu. Vui lòng thử lại.', 'error');
    }
  }

  // ─── KHO HỒ SƠ ────────────────────────────────────────────────────────────

  async function renderRecords(root, user, isHRManager) {
    const users = await DB.getTable('users:');
    root.innerHTML = `
      <div class="card mb-md">
        <input type="text" id="recordSearch" placeholder="🔍 Tìm hồ sơ theo tên, phòng ban..." style="width:100%; padding:9px 12px; border:1px solid var(--color-border); border-radius:6px;" />
      </div>
      <div class="content-grid cols-3" id="recordGrid"></div>
    `;
    const grid = root.querySelector('#recordGrid');
    function draw(q = '') {
      const filtered = users.filter((u) =>
        u.name.toLowerCase().includes(q.toLowerCase()) ||
        (u.dept || '').toLowerCase().includes(q.toLowerCase())
      );
      grid.innerHTML = filtered.length === 0 ? UI.emptyState('🗂️', 'Không tìm thấy hồ sơ phù hợp.') :
        filtered.map((u) => `<div class="card" style="cursor:pointer;" data-uid="${u.id}">
          <div class="flex-row gap-sm" style="align-items:center;">
            ${u.avatarUrl
              ? `<img src="${u.avatarUrl}" style="width:38px;height:38px;border-radius:50%;object-fit:cover;flex-shrink:0;" />`
              : `<div class="sidebar-avatar" style="background:var(--color-primary-light);color:var(--color-primary);width:38px;height:38px;font-size:13px;flex-shrink:0;">${UI.userInitials(u.name)}</div>`}
            <div>
              <div style="font-weight:600; font-size:13.5px;">${UI.escapeHtml(u.name)}</div>
              <div class="text-faint" style="font-size:12px;">${UI.escapeHtml(u.position || '')} · ${UI.escapeHtml(u.dept || '')}</div>
              <div class="text-faint" style="font-size:11px;">📁 Hồ sơ ${u.idNumber ? '✓ CCCD' : 'chưa đầy đủ'}</div>
            </div>
          </div>
        </div>`).join('');
      grid.querySelectorAll('[data-uid]').forEach((el) => {
        el.addEventListener('click', () => openStaffProfile(el.dataset.uid, isHRManager));
      });
    }
    draw();
    root.querySelector('#recordSearch').addEventListener('input', (e) => draw(e.target.value));
  }

  // ─── BIỂU MẪU: ĐƠN NGHỈ PHÉP / CÔNG TÁC ─────────────────────────────────

  async function renderForms(root, user, isHRManager) {
    const allForms = await DB.getTable('hr_forms:');
    const allUsers = await DB.getTable('users:');
    // isHRManager thấy tất cả; nhân viên thấy đơn của mình
    const visible = isHRManager ? allForms : allForms.filter((f) => f.requestedBy === user.id);
    visible.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Danh sách nhân viên NS để phân công (chỉ HR Manager mới cần)
    const hrStaff = isHRManager ? allUsers.filter((u) => u.dept === 'Nhân sự' || u.role === ROLES.DEPT_HEAD) : [];

    root.innerHTML = `
      <div class="flex-between mb-md">
        <div class="text-faint" style="font-size:12.5px;">${isHRManager ? 'Tiếp nhận, phân công và duyệt biểu mẫu' : 'Đơn bạn đã gửi'}</div>
        <button class="btn btn-primary" id="btnNewForm">+ Tạo đơn</button>
      </div>
      ${visible.length === 0 ? UI.emptyState('📄', 'Chưa có biểu mẫu nào.') : `
        <div class="table-wrap"><table>
          <thead><tr><th>Mã</th><th>Loại đơn</th><th>Nội dung</th><th>Người gửi</th><th>Phân công</th><th>Ngày tạo</th><th>Trạng thái</th>${isHRManager ? '<th></th>' : ''}</tr></thead>
          <tbody>${(await Promise.all(visible.map((f) => formRow(f, allUsers, isHRManager, hrStaff)))).join('')}</tbody>
        </table></div>
      `}
    `;

    root.querySelector('#btnNewForm').addEventListener('click', () => openNewFormModal(user));
    if (isHRManager) {
      root.querySelectorAll('[data-act]').forEach((btn) => {
        btn.addEventListener('click', (e) => { e.stopPropagation(); handleFormAction(btn.dataset.id, btn.dataset.act); });
      });
      root.querySelectorAll('[data-assign]').forEach((sel) => {
        sel.addEventListener('change', async () => {
          const f = await DB.get(`hr_forms:${sel.dataset.assign}`);
          f.assignedTo = sel.value || null;
          f.status = sel.value ? 'in_progress' : 'pending';
          const ok = await DB.set(`hr_forms:${f.id}`, f);
          if (!ok) { UI.toast('Lỗi phân công. Kiểm tra Console (F12).', 'error'); return; }
          UI.toast('Đã phân công.', 'success');
          App.refreshCurrent();
        });
      });
    }
  }

  async function formRow(f, allUsers, isHRManager, hrStaff) {
    const requester = allUsers.find((u) => u.id === f.requestedBy);
    const assignee = allUsers.find((u) => u.id === f.assignedTo);
    const typeLabel = f.type === 'leave' ? 'Đơn nghỉ phép' : f.type === 'business_trip' ? 'Đơn công tác' : 'Biểu mẫu khác';
    const assignHtml = isHRManager ? `
      <select data-assign="${f.id}" style="font-size:12px; padding:4px 6px; border:1px solid var(--color-border); border-radius:4px;">
        <option value="">— Chưa phân công —</option>
        ${hrStaff.map((u) => `<option value="${u.id}" ${f.assignedTo === u.id ? 'selected' : ''}>${u.name}</option>`).join('')}
      </select>` : (assignee?.name || '—');

    return `<tr>
      <td class="mono" style="font-size:12px;">${f.id}</td>
      <td>${typeLabel}</td>
      <td>${UI.escapeHtml(f.detail || f.title || '')}</td>
      <td>${requester?.name || f.requestedBy}</td>
      <td>${assignHtml}</td>
      <td>${UI.formatDate(f.createdAt)}</td>
      <td>${UI.statusBadge(f.status)}</td>
      ${isHRManager ? `<td>${f.status === 'pending' || f.status === 'in_progress' ? `
        <button class="btn btn-danger btn-sm" data-act="reject" data-id="${f.id}">Từ chối</button>
        <button class="btn btn-primary btn-sm" data-act="approve" data-id="${f.id}">Duyệt</button>
      ` : ''}</td>` : ''}
    </tr>`;
  }

  async function handleFormAction(id, act) {
    const f = await DB.get(`hr_forms:${id}`);
    f.status = act === 'approve' ? 'approved' : 'rejected';
    const ok = await DB.set(`hr_forms:${id}`, f);
    if (!ok) { UI.toast('Lỗi cập nhật đơn. Kiểm tra Console (F12).', 'error'); return; }
    UI.toast(act === 'approve' ? 'Đã duyệt đơn.' : 'Đã từ chối đơn.', act === 'approve' ? 'success' : 'error');
    App.refreshCurrent();
  }

  function openNewFormModal(user) {
    const body = `
      <div class="field">
        <label>Loại đơn</label>
        <select id="formType">
          <option value="leave">Đơn nghỉ phép</option>
          <option value="business_trip">Đơn công tác</option>
          <option value="other">Khác</option>
        </select>
      </div>
      <div class="field"><label>Nội dung / lý do <span style="color:red">*</span></label><textarea id="formDetail" placeholder="VD: Xin nghỉ phép 2 ngày từ 05/07 đến 06/07 để giải quyết việc gia đình"></textarea></div>
      <div class="field">
        <label>Đính kèm tài liệu (tùy chọn)</label>
        <input type="file" id="formFile" accept=".pdf,.doc,.docx,.jpg,.png" />
        <div class="text-faint" style="font-size:12px; margin-top:4px;">Hỗ trợ: PDF, Word, ảnh</div>
      </div>
    `;
    const footer = `<button class="btn btn-secondary" id="cancelForm">Hủy</button>
                    <button class="btn btn-primary" id="submitForm">Gửi đơn</button>`;
    UI.openModal('Tạo biểu mẫu', body, footer);
    document.getElementById('cancelForm').addEventListener('click', UI.closeModal);
    document.getElementById('submitForm').addEventListener('click', async () => {
      const type = document.getElementById('formType').value;
      const detail = document.getElementById('formDetail').value.trim();
      if (!detail) { UI.toast('Vui lòng nhập nội dung.', 'error'); return; }

      let attachmentUrl = null;
      const file = document.getElementById('formFile')?.files[0];
      if (file) {
        try {
          const uploaded = await DB.uploadFile(file, 'hr_forms');
          attachmentUrl = uploaded.url;
        } catch (e) {
          UI.toast('Lỗi tải file: ' + e.message, 'error');
          return;
        }
      }

      const id = DB.genId('HR-F');
      const ok = await DB.set(`hr_forms:${id}`, {
        id, type,
        title: type === 'leave' ? 'Đơn nghỉ phép' : type === 'business_trip' ? 'Đơn công tác' : 'Biểu mẫu khác',
        detail, requestedBy: user.id, assignedTo: null,
        status: 'pending', attachmentUrl,
        createdAt: new Date().toISOString(),
      });
      if (!ok) { UI.toast('Lỗi gửi đơn. Kiểm tra Console (F12) để xem chi tiết.', 'error'); return; }
      UI.closeModal();
      UI.toast('Đã gửi đơn, chờ phòng Nhân sự xử lý.', 'success');
      App.refreshCurrent();
    });
  }

  // ─── ĐỀ XUẤT KẾ HOẠCH (duyệt 2 cấp) ─────────────────────────────────────

  async function renderHRProposals(root, user, isHRManager) {
    const proposals = (await DB.getTable('proposals:')).filter((p) => p.module === 'hr');
    proposals.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    root.innerHTML = `
      <div class="flex-between mb-md">
        <div class="text-faint" style="font-size:12.5px;">Quy trình: Trưởng phòng NS tạo → tự duyệt cấp 1 → Ban Điều hành duyệt cấp 2</div>
        ${isHRManager ? `<button class="btn btn-primary" id="btnNewHRProp">+ Tạo đề xuất</button>` : ''}
      </div>
      ${proposals.length === 0 ? UI.emptyState('📋', 'Chưa có đề xuất kế hoạch nhân sự.') : `
        <div class="table-wrap"><table>
          <thead><tr><th>Mã</th><th>Tiêu đề</th><th>Ngày tạo</th><th>Trạng thái</th><th></th></tr></thead>
          <tbody>${proposals.map((p) => `<tr class="clickable" data-id="${p.id}">
            <td class="mono" style="font-size:12px;">${p.id}</td>
            <td>${UI.escapeHtml(p.title)}</td>
            <td>${UI.formatDate(p.createdAt)}</td>
            <td>${UI.statusBadge(p.status)}</td>
            <td><button class="btn btn-secondary btn-sm">Xem</button></td>
          </tr>`).join('')}</tbody>
        </table></div>
      `}
    `;

    if (isHRManager) root.querySelector('#btnNewHRProp').addEventListener('click', () => openCreateHRProposal(user));
    root.querySelectorAll('tr.clickable').forEach((tr) => tr.addEventListener('click', () => openHRProposalDetail(tr.dataset.id)));
  }

  async function openCreateHRProposal(user) {
    const body = `
      <div class="field"><label>Tiêu đề đề xuất <span style="color:red">*</span></label>
        <input type="text" id="hrPropTitle" placeholder="VD: Đề xuất tuyển dụng thêm giáo viên tại Trà Vinh" /></div>
      <div class="field"><label>Nội dung chi tiết <span style="color:red">*</span></label>
        <textarea id="hrPropDesc" placeholder="Mô tả nhu cầu, lý do, số lượng, ngân sách dự kiến..."></textarea></div>
      <div class="field">
        <label>Đính kèm tài liệu (tùy chọn)</label>
        <input type="file" id="hrPropFile" accept=".pdf,.doc,.docx,.xlsx,.png,.jpg" />
      </div>
    `;
    const footer = `<button class="btn btn-secondary" id="cancelHRProp">Hủy</button>
                    <button class="btn btn-primary" id="submitHRProp">Gửi đề xuất</button>`;
    UI.openModal('Tạo đề xuất kế hoạch nhân sự', body, footer);
    document.getElementById('cancelHRProp').addEventListener('click', UI.closeModal);
    document.getElementById('submitHRProp').addEventListener('click', async () => {
      const title = document.getElementById('hrPropTitle').value.trim();
      const description = document.getElementById('hrPropDesc').value.trim();
      if (!title || !description) { UI.toast('Vui lòng nhập đầy đủ thông tin.', 'error'); return; }

      let attachments = [];
      const file = document.getElementById('hrPropFile')?.files[0];
      if (file) {
        try {
          const uploaded = await DB.uploadFile(file, 'proposals');
          attachments = [{ name: uploaded.name, type: uploaded.type, url: uploaded.url }];
        } catch (e) {
          UI.toast('Lỗi tải file: ' + e.message, 'error'); return;
        }
      }

      const id = DB.genId('PRP');
      const ok = await DB.set(`proposals:${id}`, {
        id, title, description, type: 'hr_plan', module: 'hr', center: null,
        createdBy: user.id, createdAt: new Date().toISOString(), attachments,
        status: 'pending_level2',
        history: [
          { step: 'created', by: user.id, at: new Date().toISOString(), note: 'Tạo đề xuất' },
          { step: 'level1_approved', by: user.id, at: new Date().toISOString(), note: 'Tự duyệt cấp 1 (Trưởng phòng Nhân sự)' },
        ],
      });
      if (!ok) { UI.toast('Lỗi gửi đề xuất. Kiểm tra Console (F12) để xem chi tiết.', 'error'); return; }
      UI.closeModal();
      UI.toast('Đã gửi đề xuất lên Trung tâm Điều hành.', 'success');
      App.refreshCurrent();
    });
  }

  async function openHRProposalDetail(id) {
    const p = await DB.get(`proposals:${id}`);
    if (!p) return;
    const users = await DB.getTable('users:');
    const creator = users.find((u) => u.id === p.createdBy);
    const body = `
      <div class="mb-md"><div class="text-faint mono" style="font-size:12px;">${p.id}</div>
        <h3 style="margin-top:4px;">${UI.escapeHtml(p.title)}</h3></div>
      <div class="flex-row gap-sm mb-md">${UI.statusBadge(p.status)}
        <span class="text-faint" style="font-size:12.5px;">Tạo bởi ${creator?.name || p.createdBy} · ${UI.formatDate(p.createdAt)}</span></div>
      <div class="card" style="background:var(--color-bg); margin-bottom:16px;">
        <div style="font-size:13.5px; line-height:1.6;">${UI.escapeHtml(p.description)}</div>
        ${p.attachments?.length ? `<div class="mt-md">${p.attachments.map((a) =>
          a.url
            ? `<a href="${a.url}" target="_blank" class="attachment-chip">📎 ${UI.escapeHtml(a.name)}</a>`
            : UI.attachmentChip(a)
        ).join('')}</div>` : ''}
      </div>
      <div class="section-head mt-md"><h3 style="font-size:14px;">Lịch sử xử lý</h3></div>
      <div class="timeline">${(p.history || []).map((h) => `
        <div class="timeline-step ${h.step.includes('rejected') ? 'rejected' : 'done'}">
          <div class="timeline-dot">${h.step.includes('rejected') ? '✕' : '✓'}</div>
          <div class="timeline-title">${historyLabel(h.step)}</div>
          <div class="timeline-meta">${users.find((u) => u.id === h.by)?.name || h.by} · ${UI.formatDateTime(h.at)}</div>
          ${h.note ? `<div class="timeline-note">${UI.escapeHtml(h.note)}</div>` : ''}
        </div>`).join('')}
      </div>
    `;
    UI.openModal('Chi tiết đề xuất nhân sự', body, `<button class="btn btn-secondary" id="closeHRDetail">Đóng</button>`);
    document.getElementById('closeHRDetail').addEventListener('click', UI.closeModal);
  }

  function historyLabel(step) {
    const map = {
      created: 'Tạo đề xuất', level1_approved: 'Duyệt cấp 1', level1_rejected: 'Từ chối cấp 1',
      level2_approved: 'Duyệt cấp 2 — Phê duyệt', level2_rejected: 'Từ chối cấp 2',
    };
    return map[step] || step;
  }

  return { render };
})();
