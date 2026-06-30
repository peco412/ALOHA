/**
 * modules/center.js — Supabase Edition + Tính năng mới
 * Quản lý Trung tâm:
 * Tabs: Tổng quan | Phân lịch tuần | Giáo viên | Lớp học | Học viên | Đề xuất kế hoạch
 *
 * Mới:
 * - Thêm học viên mới (với upload file)
 * - Tạo lớp mới (đầy đủ thông tin)
 * - Phân lịch tuần: quản lý trung tâm xếp giáo viên dạy từng ca, thêm người dạy thay
 *
 * Phân quyền:
 * - center_manager: chỉ thấy trung tâm của mình, không thấy TT khác
 * - admin/exec: thấy tất cả (lọc theo bộ chọn trung tâm)
 * - Trưởng phòng ban: chỉ xem tiến độ đề xuất mình tạo (không duyệt)
 */

const CenterModule = (() => {
  let activeTab = 'overview';

  async function render(root) {
    const user = Auth.getCurrentUser();
    const centerFilter = App.getCenterFilter();
    const centers = (await DB.get('meta:centers')) || [];
    const isCenterManager = user.role === ROLES.CENTER_MANAGER;
    const myCenter = isCenterManager ? user.center : centerFilter;

    root.innerHTML = `
      <div class="tabs">
        ${tab('overview',  'Tổng quan')}
        ${tab('schedule',  '📅 Phân lịch tuần')}
        ${tab('teachers',  'Giáo viên')}
        ${tab('classes',   'Lớp học')}
        ${tab('students',  'Học viên')}
        ${tab('proposals', 'Đề xuất kế hoạch')}
      </div>
      <div id="centerBody"></div>
    `;
    root.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => { activeTab = t.dataset.tab; render(root); }));

    const body = root.querySelector('#centerBody');
    if (activeTab === 'overview')  await renderOverview(body, myCenter, centers);
    else if (activeTab === 'schedule')  await renderWeeklySchedule(body, myCenter, centers, user);
    else if (activeTab === 'teachers')  await renderTeachers(body, myCenter);
    else if (activeTab === 'classes')   await renderClasses(body, myCenter, user);
    else if (activeTab === 'students')  await renderStudents(body, myCenter, user);
    else if (activeTab === 'proposals') await renderProposals(body, myCenter, user, centers);
  }

  function tab(key, label) {
    return `<div class="tab ${activeTab === key ? 'active' : ''}" data-tab="${key}">${label}</div>`;
  }

  function centerName(centers, id) {
    return centers.find((c) => c.id === id)?.name || id || '—';
  }

  function filterByCenter(items, cf) {
    return cf ? items.filter((i) => i.center === cf) : items;
  }

  // ─── TỔNG QUAN ────────────────────────────────────────────────────────────

  async function renderOverview(root, cf, centers) {
    const [allClasses, allStudents, allTeachers] = await Promise.all([
      DB.getTable('classes:'), DB.getTable('students:'), DB.getTable('users:'),
    ]);
    const classes  = filterByCenter(allClasses, cf);
    const students = filterByCenter(allStudents, cf);
    const teachers = allTeachers.filter((u) => u.role === ROLES.TEACHER && (!cf || u.center === cf));
    const newStudents   = students.filter((s) => s.status === 'lead').length;
    const activeClasses = classes.filter((c) => c.status === 'active').length;

    root.innerHTML = `
      ${!cf ? `<div class="card mb-md" style="background:var(--color-primary-light);border:none;"><strong>Đang xem:</strong> Tổng hợp toàn hệ thống. Chọn trung tâm ở góc trên phải để xem riêng.</div>` : ''}
      <div class="content-grid cols-4 mb-md">
        <div class="card stat-card"><div class="stat-value">${students.length}</div><div class="stat-label">Tổng học viên</div></div>
        <div class="card stat-card"><div class="stat-value">${newStudents}</div><div class="stat-label">Học viên mới</div></div>
        <div class="card stat-card"><div class="stat-value">${activeClasses}</div><div class="stat-label">Lớp đang hoạt động</div></div>
        <div class="card stat-card"><div class="stat-value">${teachers.length}</div><div class="stat-label">Giáo viên</div></div>
      </div>
      <div class="content-grid cols-2">
        <div class="card">
          <div class="card-title">Tuyển sinh theo trung tâm</div>
          <table>
            <thead><tr><th>Trung tâm</th><th>Học viên</th><th>Lớp hoạt động</th></tr></thead>
            <tbody>
              ${centers.map((c) => {
                const cs = allStudents.filter((s) => s.center === c.id);
                const cc = allClasses.filter((cl) => cl.center === c.id && cl.status === 'active');
                return `<tr><td>${c.name}</td><td>${cs.length}</td><td>${cc.length}</td></tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        <div class="card">
          <div class="card-title">Trạng thái lớp học${cf ? ' — ' + centerName(centers, cf) : ''}</div>
          ${classes.length === 0 ? UI.emptyState('🏫', 'Chưa có lớp học.') : `
            <table>
              <thead><tr><th>Lớp</th><th>Giáo viên</th><th>Sĩ số</th><th>Trạng thái</th></tr></thead>
              <tbody>${classes.map((c) => `<tr>
                <td>${UI.escapeHtml(c.name)}</td>
                <td>${allTeachers.find((t) => t.id === c.teacherId)?.name || '—'}</td>
                <td>${c.size}</td>
                <td>${UI.statusBadge(c.status)}</td>
              </tr>`).join('')}</tbody>
            </table>
          `}
        </div>
      </div>
    `;
  }

  // ─── PHÂN LỊCH TUẦN ───────────────────────────────────────────────────────

  async function renderWeeklySchedule(root, cf, centers, user) {
    const canEdit = user.role === ROLES.CENTER_MANAGER || user.role === ROLES.ADMIN;
    if (!cf && !canEdit) {
      root.innerHTML = UI.emptyState('📅', 'Vui lòng chọn 1 trung tâm để xem phân lịch.');
      return;
    }

    // Lấy tuần hiện tại (Thứ 2)
    const today = new Date();
    const mon = new Date(today);
    mon.setDate(today.getDate() - (today.getDay() === 0 ? 6 : today.getDay() - 1));
    mon.setHours(0, 0, 0, 0);
    const weekKey = mon.toISOString().slice(0, 10); // YYYY-MM-DD

    const [allClasses, allTeachers, scheduleRows] = await Promise.all([
      DB.getTable('classes:'),
      DB.getTable('users:'),
      DB.getTable('schedule:'),
    ]);

    const myCenter = cf || (user.role === ROLES.CENTER_MANAGER ? user.center : null);
    const classes  = allClasses.filter((c) => c.center === myCenter && c.status === 'active');
    const teachers = allTeachers.filter((t) => t.role === ROLES.TEACHER && t.center === myCenter);
    const weekSchedule = scheduleRows.filter((r) => r.center === myCenter && r.weekStart === weekKey);

    const days = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];

    // Tạo map: classId → schedule entries tuần này
    function getSlot(classId, day) {
      return weekSchedule.find((s) => s.classId === classId && s.dayOfWeek === day);
    }

    root.innerHTML = `
      <div class="flex-between mb-md">
        <div>
          <div class="card-title" style="margin:0;">Phân lịch tuần — ${myCenter ? centerName(centers, myCenter) : 'Tất cả'}</div>
          <div class="text-faint" style="font-size:12px;">Tuần từ ${formatDateShort(mon)} · Chỉnh sửa để thêm người dạy thay khi giáo viên vắng</div>
        </div>
        ${canEdit ? `<button class="btn btn-primary" id="btnAddSchedule">+ Thêm lịch</button>` : ''}
      </div>
      ${classes.length === 0
        ? UI.emptyState('📅', 'Không có lớp hoạt động để phân lịch.')
        : `<div class="table-wrap">
        <table style="min-width:900px;">
          <thead>
            <tr>
              <th style="min-width:160px;">Lớp</th>
              ${days.map((d, i) => `<th>${d}<br/><span style="font-weight:400;font-size:11px;">${formatDateShort(addDays(mon, i))}</span></th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${classes.map((cls) => {
              const teacher = allTeachers.find((t) => t.id === cls.teacherId);
              return `<tr>
                <td>
                  <strong style="font-size:13px;">${UI.escapeHtml(cls.name)}</strong><br/>
                  <span class="text-faint" style="font-size:11px;">GV: ${teacher?.name || '—'}</span>
                </td>
                ${[1,2,3,4,5,6,7].map((day) => {
                  const slot = getSlot(cls.id, day);
                  if (!slot) {
                    // Kiểm tra lịch học thường của lớp có dạy ngày này không
                    const scheduled = (cls.schedule || '').includes(days[day - 1]);
                    if (!scheduled) return `<td style="background:#fafafa; color:#ddd;">—</td>`;
                    return `<td class="schedule-slot" style="background:#f0fdf4;">
                      <div style="font-size:11px; color:#16a34a;">✓ ${teacher?.name || '—'}</div>
                      ${canEdit ? `<button class="btn btn-secondary btn-sm" style="font-size:10px;margin-top:4px;" data-slot-class="${cls.id}" data-slot-day="${day}">Thêm thay</button>` : ''}
                    </td>`;
                  }
                  const sub = allTeachers.find((t) => t.id === slot.substituteId);
                  return `<td class="schedule-slot" style="${sub ? 'background:#fef9c3;' : ''}">
                    <div style="font-size:11px;">${slot.timeSlot || ''}</div>
                    ${sub ? `<div style="font-size:11px; color:#b45309; font-weight:600;">🔄 ${sub.name}</div><div style="font-size:10px;color:#92400e;">(dạy thay)</div>` : `<div style="font-size:11px; color:#16a34a;">✓ ${teacher?.name || '—'}</div>`}
                    ${slot.note ? `<div style="font-size:10px;color:#6b7280;margin-top:2px;">${UI.escapeHtml(slot.note)}</div>` : ''}
                    ${canEdit ? `<button class="btn btn-secondary btn-sm" style="font-size:10px;margin-top:4px;" data-slot-id="${slot.id}" data-slot-class="${cls.id}" data-slot-day="${day}">Sửa</button>` : ''}
                  </td>`;
                }).join('')}
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`}
      ${weekSchedule.filter((s) => s.substituteId).length > 0 ? `
        <div class="card mt-md" style="background:#fef9c3;border:1px solid #fbbf24;">
          <div class="card-title" style="color:#92400e;">⚠️ Giáo viên dạy thay tuần này</div>
          ${weekSchedule.filter((s) => s.substituteId).map((s) => {
            const cls = classes.find((c) => c.id === s.classId);
            const sub = allTeachers.find((t) => t.id === s.substituteId);
            return `<div style="font-size:13px; margin-bottom:4px;">📌 ${days[s.dayOfWeek - 1]}: <strong>${cls?.name || s.classId}</strong> — dạy thay bởi <strong>${sub?.name || s.substituteId}</strong> ${s.note ? `(${s.note})` : ''}</div>`;
          }).join('')}
        </div>` : ''}
    `;

    if (canEdit) {
      root.querySelector('#btnAddSchedule')?.addEventListener('click', () => openScheduleModal(null, null, null, classes, teachers, weekKey, myCenter));
      root.querySelectorAll('[data-slot-class]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const slotId = btn.dataset.slotId;
          const classId = btn.dataset.slotClass;
          const day = parseInt(btn.dataset.slotDay);
          const existing = weekSchedule.find((s) => s.id === slotId) || null;
          openScheduleModal(existing, classId, day, classes, teachers, weekKey, myCenter);
        });
      });
    }
  }

  function addDays(date, n) { const d = new Date(date); d.setDate(d.getDate() + n); return d; }
  function formatDateShort(d) { return `${d.getDate()}/${d.getMonth() + 1}`; }

  async function openScheduleModal(existing, prefClassId, prefDay, classes, teachers, weekStart, center) {
    const days = [
      { value: 1, label: 'Thứ 2' }, { value: 2, label: 'Thứ 3' }, { value: 3, label: 'Thứ 4' },
      { value: 4, label: 'Thứ 5' }, { value: 5, label: 'Thứ 6' }, { value: 6, label: 'Thứ 7' }, { value: 7, label: 'Chủ nhật' },
    ];
    const body = `
      <div class="field">
        <label>Lớp học <span style="color:red">*</span></label>
        <select id="slotClass">
          <option value="">— Chọn lớp —</option>
          ${classes.map((c) => `<option value="${c.id}" ${(existing?.classId || prefClassId) === c.id ? 'selected' : ''}>${UI.escapeHtml(c.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Ngày trong tuần <span style="color:red">*</span></label>
        <select id="slotDay">
          ${days.map((d) => `<option value="${d.value}" ${(existing?.dayOfWeek || prefDay) === d.value ? 'selected' : ''}>${d.label}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Ca học</label>
        <input type="text" id="slotTime" value="${existing?.timeSlot || ''}" placeholder="VD: 17:30-19:00" />
      </div>
      <div class="field">
        <label>Giáo viên dạy thay (để trống nếu giáo viên chính dạy)</label>
        <select id="slotSub">
          <option value="">— Không cần dạy thay —</option>
          ${teachers.map((t) => `<option value="${t.id}" ${existing?.substituteId === t.id ? 'selected' : ''}>${t.name}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Ghi chú (lý do vắng / thông tin thêm)</label>
        <textarea id="slotNote" placeholder="VD: GV chính bệnh, GV thay dạy nội dung Unit 5">${existing?.note || ''}</textarea>
      </div>
    `;
    const footer = `
      ${existing ? `<button class="btn btn-danger" id="deleteSlot" data-id="${existing.id}">Xóa</button>` : ''}
      <button class="btn btn-secondary" id="cancelSlot">Hủy</button>
      <button class="btn btn-primary" id="saveSlot">Lưu lịch</button>
    `;
    UI.openModal(existing ? 'Chỉnh sửa lịch' : 'Thêm lịch tuần', body, footer);

    const user = Auth.getCurrentUser();
    document.getElementById('cancelSlot').addEventListener('click', UI.closeModal);
    document.getElementById('saveSlot').addEventListener('click', async () => {
      const classId  = document.getElementById('slotClass').value;
      const day      = parseInt(document.getElementById('slotDay').value);
      const timeSlot = document.getElementById('slotTime').value.trim();
      const subId    = document.getElementById('slotSub').value || null;
      const note     = document.getElementById('slotNote').value.trim();
      if (!classId) { UI.toast('Vui lòng chọn lớp.', 'error'); return; }

      const id = existing?.id || DB.genId('SCH');
      const ok = await DB.set(`schedule:${id}`, {
        id, center, weekStart, classId, dayOfWeek: day,
        timeSlot, substituteId: subId, note,
        createdBy: user.id, createdAt: existing?.createdAt || new Date().toISOString(),
      });
      if (!ok) { UI.toast('Lỗi lưu lịch. Kiểm tra Console (F12) để xem chi tiết.', 'error'); return; }
      UI.closeModal();
      UI.toast('Đã lưu lịch.', 'success');
      App.refreshCurrent();
    });

    if (existing) {
      document.getElementById('deleteSlot').addEventListener('click', async () => {
        await DB.remove(`schedule:${existing.id}`);
        UI.closeModal();
        UI.toast('Đã xóa lịch.', 'success');
        App.refreshCurrent();
      });
    }
  }

  // ─── GIÁO VIÊN ────────────────────────────────────────────────────────────

  async function renderTeachers(root, cf) {
    const [users, classes] = await Promise.all([DB.getTable('users:'), DB.getTable('classes:')]);
    const teachers = users.filter((u) => u.role === ROLES.TEACHER && (!cf || u.center === cf));
    if (teachers.length === 0) { root.innerHTML = UI.emptyState('🧑‍🏫', 'Chưa có giáo viên nào.'); return; }

    root.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Họ tên</th><th>Liên hệ</th><th>Lớp phụ trách</th><th>Giờ dạy/tuần (ước tính)</th></tr></thead>
          <tbody>
            ${teachers.map((t) => {
              const myClasses = classes.filter((c) => c.teacherId === t.id);
              return `<tr>
                <td><strong>${UI.escapeHtml(t.name)}</strong></td>
                <td>${UI.escapeHtml(t.phone || '')} <span class="text-faint">${UI.escapeHtml(t.email || '')}</span></td>
                <td>${myClasses.map((c) => UI.escapeHtml(c.name)).join(', ') || '—'}</td>
                <td>${myClasses.length * 3} buổi/tuần</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // ─── LỚP HỌC ──────────────────────────────────────────────────────────────

  async function renderClasses(root, cf, user) {
    const [classes, teachers] = await Promise.all([DB.getTable('classes:'), DB.getTable('users:')]);
    const filtered = filterByCenter(classes, cf);
    const canCreate = user.role === ROLES.CENTER_MANAGER || user.role === ROLES.ADMIN;

    root.innerHTML = `
      <div class="flex-between mb-md">
        <div></div>
        ${canCreate ? `<button class="btn btn-primary" id="btnNewClass">+ Tạo lớp mới</button>` : ''}
      </div>
      ${filtered.length === 0 ? UI.emptyState('🏫', 'Chưa có lớp học nào.') : `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Tên lớp</th><th>Trình độ</th><th>Giáo viên</th><th>Sĩ số</th><th>Lịch học</th><th>Khai giảng</th><th>Trạng thái</th><th></th></tr></thead>
            <tbody>
              ${filtered.map((c) => `<tr>
                <td><strong>${UI.escapeHtml(c.name)}</strong></td>
                <td>${UI.escapeHtml(c.level || '—')}</td>
                <td>${teachers.find((t) => t.id === c.teacherId)?.name || '—'}</td>
                <td>${c.size}</td>
                <td>${UI.escapeHtml(c.schedule || '—')}</td>
                <td>${c.startDate ? UI.formatDate(c.startDate) : '—'}</td>
                <td>${UI.statusBadge(c.status)}</td>
                ${canCreate ? `<td><button class="btn btn-secondary btn-sm btnEditClass" data-id="${c.id}">Sửa</button></td>` : '<td></td>'}
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      `}
    `;

    if (canCreate) {
      const allTeachers = teachers.filter((t) => t.role === ROLES.TEACHER && (!cf || t.center === cf));
      root.querySelector('#btnNewClass')?.addEventListener('click', () => openClassModal(null, cf, allTeachers));
      root.querySelectorAll('.btnEditClass').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const cls = await DB.get(`classes:${btn.dataset.id}`);
          openClassModal(cls, cf, allTeachers);
        });
      });
    }
  }

  async function openClassModal(existing, cf, teachers) {
    const centers = (await DB.get('meta:centers')) || [];
    const body = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="field" style="grid-column:1/-1;">
          <label>Tên lớp <span style="color:red">*</span></label>
          <input type="text" id="className" value="${existing?.name || ''}" placeholder="VD: Aloha Junior A1" />
        </div>
        <div class="field">
          <label>Trình độ / Khóa học</label>
          <input type="text" id="classLevel" value="${existing?.level || ''}" placeholder="VD: Junior, Starter, Pre..." />
        </div>
        <div class="field">
          <label>Trung tâm <span style="color:red">*</span></label>
          <select id="classCenter">
            <option value="">— Chọn trung tâm —</option>
            ${centers.map((c) => `<option value="${c.id}" ${(existing?.center || cf) === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Giáo viên phụ trách</label>
          <select id="classTeacher">
            <option value="">— Chưa phân công —</option>
            ${teachers.map((t) => `<option value="${t.id}" ${existing?.teacherId === t.id ? 'selected' : ''}>${t.name}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Lịch học</label>
          <input type="text" id="classSchedule" value="${existing?.schedule || ''}" placeholder="VD: Thứ 2-4-6, 18:00-19:30" />
        </div>
        <div class="field">
          <label>Sĩ số hiện tại</label>
          <input type="number" id="classSize" value="${existing?.size || 0}" min="0" />
        </div>
        <div class="field">
          <label>Ngày khai giảng</label>
          <input type="date" id="classStartDate" value="${existing?.startDate || ''}" />
        </div>
        <div class="field">
          <label>Ngày kết thúc (ước tính)</label>
          <input type="date" id="classEndDate" value="${existing?.endDate || ''}" />
        </div>
        <div class="field">
          <label>Trạng thái</label>
          <select id="classStatus">
            <option value="planning" ${(existing?.status || 'planning') === 'planning' ? 'selected' : ''}>Đang lên kế hoạch</option>
            <option value="active" ${existing?.status === 'active' ? 'selected' : ''}>Đang hoạt động</option>
            <option value="closed" ${existing?.status === 'closed' ? 'selected' : ''}>Đã kết thúc</option>
          </select>
        </div>
        <div class="field" style="grid-column:1/-1;">
          <label>Ghi chú</label>
          <textarea id="classNote" placeholder="Thông tin thêm về lớp học...">${existing?.note || ''}</textarea>
        </div>
      </div>
    `;
    const footer = `<button class="btn btn-secondary" id="cancelClass">Hủy</button>
                    <button class="btn btn-primary" id="saveClass">Lưu lớp học</button>`;
    UI.openModal(existing ? 'Chỉnh sửa lớp học' : 'Tạo lớp mới', body, footer);
    const user = Auth.getCurrentUser();
    document.getElementById('cancelClass').addEventListener('click', UI.closeModal);
    document.getElementById('saveClass').addEventListener('click', async () => {
      const name   = document.getElementById('className').value.trim();
      const center = document.getElementById('classCenter').value;
      if (!name || !center) { UI.toast('Vui lòng nhập tên lớp và chọn trung tâm.', 'error'); return; }
      const id = existing?.id || DB.genId('cls');
      const ok = await DB.set(`classes:${id}`, {
        id, name, center,
        teacherId:  document.getElementById('classTeacher').value || null,
        level:      document.getElementById('classLevel').value.trim(),
        schedule:   document.getElementById('classSchedule').value.trim(),
        size:       parseInt(document.getElementById('classSize').value) || 0,
        startDate:  document.getElementById('classStartDate').value || null,
        endDate:    document.getElementById('classEndDate').value || null,
        status:     document.getElementById('classStatus').value,
        note:       document.getElementById('classNote').value.trim(),
        createdBy:  existing?.createdBy || user.id,
        createdAt:  existing?.createdAt || new Date().toISOString(),
        updatedAt:  new Date().toISOString(),
      });
      if (!ok) { UI.toast('Lỗi lưu lớp học. Kiểm tra Console (F12) để xem chi tiết.', 'error'); return; }
      UI.closeModal();
      UI.toast(existing ? 'Đã cập nhật lớp học.' : 'Đã tạo lớp mới thành công.', 'success');
      App.refreshCurrent();
    });
  }

  // ─── HỌC VIÊN ─────────────────────────────────────────────────────────────

  async function renderStudents(root, cf, user) {
    const [students, classes] = await Promise.all([DB.getTable('students:'), DB.getTable('classes:')]);
    const filtered = filterByCenter(students, cf);
    const canCreate = user.role === ROLES.CENTER_MANAGER || user.role === ROLES.ADMIN;

    root.innerHTML = `
      <div class="flex-between mb-md">
        <input type="text" id="studentSearch" placeholder="🔍 Tìm học viên..." style="padding:8px 12px;border:1px solid var(--color-border);border-radius:6px;width:260px;" />
        ${canCreate ? `<button class="btn btn-primary" id="btnNewStudent">+ Nhập học viên mới</button>` : ''}
      </div>
      ${filtered.length === 0 ? UI.emptyState('🧑‍🎓', 'Chưa có học viên.') : `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Họ tên</th><th>Khóa học</th><th>Lớp</th><th>Ngày sinh</th><th>Phụ huynh</th><th>Liên hệ</th><th>Trạng thái</th><th></th></tr></thead>
            <tbody id="studentBody">
              ${filtered.map((s) => `<tr>
                <td><strong>${UI.escapeHtml(s.name)}</strong></td>
                <td>${UI.escapeHtml(s.course || '—')}</td>
                <td>${s.classId ? UI.escapeHtml(classes.find((c) => c.id === s.classId)?.name || '—') : '<span class="text-faint">Chưa xếp lớp</span>'}</td>
                <td>${s.dob ? UI.formatDate(s.dob) : '—'}</td>
                <td>${UI.escapeHtml(s.parentName || '—')}</td>
                <td>${UI.escapeHtml(s.phone || '—')}</td>
                <td>${UI.statusBadge(s.status)}</td>
                ${canCreate ? `<td><button class="btn btn-secondary btn-sm btnEditStudent" data-id="${s.id}">Sửa</button></td>` : '<td></td>'}
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      `}
    `;

    root.querySelector('#studentSearch')?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      root.querySelectorAll('#studentBody tr').forEach((tr) => {
        tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    });

    if (canCreate) {
      const myCenterClasses = classes.filter((c) => c.center === (cf || user.center));
      root.querySelector('#btnNewStudent')?.addEventListener('click', () => openStudentModal(null, cf || user.center, myCenterClasses));
      root.querySelectorAll('.btnEditStudent').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const stu = await DB.get(`students:${btn.dataset.id}`);
          openStudentModal(stu, cf || user.center, myCenterClasses);
        });
      });
    }
  }

  async function openStudentModal(existing, center, classes) {
    const body = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="field" style="grid-column:1/-1;">
          <label>Họ và tên học viên <span style="color:red">*</span></label>
          <input type="text" id="stuName" value="${existing?.name || ''}" placeholder="Nguyễn Văn A" />
        </div>
        <div class="field">
          <label>Ngày sinh</label>
          <input type="date" id="stuDob" value="${existing?.dob || ''}" />
        </div>
        <div class="field">
          <label>Khóa học / Trình độ</label>
          <input type="text" id="stuCourse" value="${existing?.course || ''}" placeholder="VD: Junior A1, Starter B2..." />
        </div>
        <div class="field" style="grid-column:1/-1;">
          <label>Lớp học</label>
          <select id="stuClass">
            <option value="">— Chưa xếp lớp —</option>
            ${classes.map((c) => `<option value="${c.id}" ${existing?.classId === c.id ? 'selected' : ''}>${UI.escapeHtml(c.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Tên phụ huynh</label>
          <input type="text" id="stuParent" value="${existing?.parentName || ''}" placeholder="Nguyễn Văn Bố" />
        </div>
        <div class="field">
          <label>Số điện thoại liên hệ</label>
          <input type="tel" id="stuPhone" value="${existing?.phone || ''}" placeholder="0900000000" />
        </div>
        <div class="field">
          <label>Email</label>
          <input type="email" id="stuEmail" value="${existing?.email || ''}" placeholder="(tùy chọn)" />
        </div>
        <div class="field">
          <label>Ngày nhập học</label>
          <input type="date" id="stuEnrolledAt" value="${existing?.enrolledAt || ''}" />
        </div>
        <div class="field">
          <label>Trạng thái</label>
          <select id="stuStatus">
            <option value="lead" ${(existing?.status || 'lead') === 'lead' ? 'selected' : ''}>Tư vấn / Tiềm năng</option>
            <option value="studying" ${existing?.status === 'studying' ? 'selected' : ''}>Đang học</option>
            <option value="graduated" ${existing?.status === 'graduated' ? 'selected' : ''}>Đã tốt nghiệp</option>
            <option value="dropped" ${existing?.status === 'dropped' ? 'selected' : ''}>Đã nghỉ học</option>
          </select>
        </div>
        <div class="field" style="grid-column:1/-1;">
          <label>Địa chỉ</label>
          <input type="text" id="stuAddress" value="${existing?.address || ''}" placeholder="Số nhà, đường, xã/phường..." />
        </div>
        <div class="field" style="grid-column:1/-1;">
          <label>Hợp đồng / Tài liệu nhập học (tùy chọn)</label>
          <input type="file" id="stuFile" accept=".pdf,.doc,.docx,.jpg,.png" />
          <div class="text-faint" style="font-size:12px;margin-top:4px;">Hỗ trợ: PDF, Word, ảnh hợp đồng</div>
          ${existing?.contractUrl ? `<a href="${existing.contractUrl}" target="_blank" style="font-size:12px;color:var(--color-primary);margin-top:4px;display:block;">📎 Xem tài liệu hiện tại</a>` : ''}
        </div>
        <div class="field" style="grid-column:1/-1;">
          <label>Ghi chú</label>
          <textarea id="stuNote" placeholder="Thông tin thêm về học viên...">${existing?.note || ''}</textarea>
        </div>
      </div>
    `;
    const footer = `<button class="btn btn-secondary" id="cancelStu">Hủy</button>
                    <button class="btn btn-primary" id="saveStu">Lưu học viên</button>`;
    UI.openModal(existing ? 'Chỉnh sửa học viên' : 'Nhập học viên mới', body, footer);

    const curUser = Auth.getCurrentUser();
    document.getElementById('cancelStu').addEventListener('click', UI.closeModal);
    document.getElementById('saveStu').addEventListener('click', async () => {
      const name = document.getElementById('stuName').value.trim();
      if (!name) { UI.toast('Vui lòng nhập tên học viên.', 'error'); return; }

      let contractUrl = existing?.contractUrl || null;
      const file = document.getElementById('stuFile')?.files[0];
      if (file) {
        try {
          const uploaded = await DB.uploadFile(file, 'students');
          contractUrl = uploaded.url;
        } catch (e) {
          UI.toast('Lỗi tải file: ' + e.message, 'error'); return;
        }
      }

      const id = existing?.id || DB.genId('st');
      const ok = await DB.set(`students:${id}`, {
        id, name, center,
        dob:        document.getElementById('stuDob').value || null,
        course:     document.getElementById('stuCourse').value.trim(),
        classId:    document.getElementById('stuClass').value || null,
        parentName: document.getElementById('stuParent').value.trim(),
        phone:      document.getElementById('stuPhone').value.trim(),
        email:      document.getElementById('stuEmail').value.trim(),
        enrolledAt: document.getElementById('stuEnrolledAt').value || null,
        status:     document.getElementById('stuStatus').value,
        address:    document.getElementById('stuAddress').value.trim(),
        note:       document.getElementById('stuNote').value.trim(),
        contractUrl,
        createdBy:  existing?.createdBy || curUser.id,
        createdAt:  existing?.createdAt || new Date().toISOString(),
        updatedAt:  new Date().toISOString(),
      });
      if (!ok) { UI.toast('Lỗi lưu học viên. Kiểm tra Console (F12) để xem chi tiết.', 'error'); return; }
      UI.closeModal();
      UI.toast(existing ? 'Đã cập nhật học viên.' : 'Đã nhập học viên mới vào hệ thống.', 'success');
      App.refreshCurrent();
    });
  }

  // ─── ĐỀ XUẤT KẾ HOẠCH ─────────────────────────────────────────────────────

  async function renderProposals(root, cf, user, centers) {
    const allProposals = (await DB.getTable('proposals:')).filter((p) => p.module === 'center');

    // center_manager chỉ thấy TT mình
    // dept_head (phòng ban khác) chỉ thấy đề xuất do mình tạo
    // admin/exec thấy tất cả
    let visible;
    if (user.role === ROLES.CENTER_MANAGER) {
      visible = allProposals.filter((p) => p.center === user.center);
    } else if (user.role === ROLES.DEPT_HEAD) {
      visible = allProposals.filter((p) => p.createdBy === user.id);
    } else {
      visible = cf ? allProposals.filter((p) => p.center === cf) : allProposals;
    }
    visible.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const canCreate = user.role === ROLES.CENTER_MANAGER || user.role === ROLES.ADMIN;
    const allUsers = await DB.getTable('users:');

    root.innerHTML = `
      <div class="flex-between mb-md">
        <div class="text-faint" style="font-size:12.5px;">Quy trình: Quản lý TT tạo → Ban Điều hành duyệt (Cấp 2)</div>
        ${canCreate ? `<button class="btn btn-primary" id="btnNewProposal">+ Tạo đề xuất</button>` : ''}
      </div>
      ${visible.length === 0 ? UI.emptyState('📋', 'Chưa có đề xuất kế hoạch nào.') : `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Mã</th><th>Tiêu đề</th><th>Trung tâm</th><th>Người tạo</th><th>Ngày tạo</th><th>Trạng thái</th><th></th></tr></thead>
            <tbody>
              ${visible.map((p) => {
                const creator = allUsers.find((u) => u.id === p.createdBy);
                return `<tr class="clickable" data-id="${p.id}">
                  <td class="mono" style="font-size:12px;">${p.id}</td>
                  <td>${UI.escapeHtml(p.title)}</td>
                  <td>${UI.escapeHtml(centers.find((c) => c.id === p.center)?.name || p.center || '—')}</td>
                  <td>${creator?.name || p.createdBy}</td>
                  <td>${UI.formatDate(p.createdAt)}</td>
                  <td>${UI.statusBadge(p.status)}</td>
                  <td><button class="btn btn-secondary btn-sm">Xem</button></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      `}
    `;

    if (canCreate) root.querySelector('#btnNewProposal').addEventListener('click', () => openCreateProposalModal(user));
    root.querySelectorAll('tr.clickable').forEach((tr) => tr.addEventListener('click', () => openProposalDetail(tr.dataset.id, user)));
  }

  async function openCreateProposalModal(user) {
    const body = `
      <div class="field"><label>Tiêu đề đề xuất <span style="color:red">*</span></label>
        <input type="text" id="propTitle" placeholder="VD: Đề xuất mở thêm lớp Aloha Kids tháng 8" /></div>
      <div class="field"><label>Nội dung chi tiết <span style="color:red">*</span></label>
        <textarea id="propDesc" placeholder="Mô tả kế hoạch, lý do, số lượng học viên dự kiến, ngân sách..."></textarea></div>
      <div class="field">
        <label>Đính kèm tài liệu (tùy chọn)</label>
        <input type="file" id="propFile" accept=".pdf,.doc,.docx,.xlsx,.png,.jpg" />
        <div class="text-faint" style="font-size:12px;margin-top:4px;">Upload file thật — có thể tải lại sau</div>
      </div>
    `;
    const footer = `<button class="btn btn-secondary" id="cancelProp">Hủy</button>
                    <button class="btn btn-primary" id="submitProp">Gửi đề xuất</button>`;
    UI.openModal('Tạo đề xuất kế hoạch', body, footer);

    document.getElementById('cancelProp').addEventListener('click', UI.closeModal);
    document.getElementById('submitProp').addEventListener('click', async () => {
      const title       = document.getElementById('propTitle').value.trim();
      const description = document.getElementById('propDesc').value.trim();
      if (!title || !description) { UI.toast('Vui lòng nhập tiêu đề và nội dung.', 'error'); return; }

      let attachments = [];
      const file = document.getElementById('propFile')?.files[0];
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
        id, title, description, type: 'center_plan', module: 'center',
        center: user.center, createdBy: user.id, createdAt: new Date().toISOString(),
        attachments, status: 'pending_level1',
        history: [{ step: 'created', by: user.id, at: new Date().toISOString(), note: 'Tạo đề xuất' }],
      });
      if (!ok) { UI.toast('Lỗi gửi đề xuất. Kiểm tra Console (F12) để xem chi tiết.', 'error'); return; }
      UI.closeModal();
      UI.toast('Đã gửi đề xuất, chờ Ban Điều hành duyệt.', 'success');
      App.refreshCurrent();
    });
  }

  async function openProposalDetail(id, user) {
    const p = await DB.get(`proposals:${id}`);
    if (!p) return;
    const users  = await DB.getTable('users:');
    const creator = users.find((u) => u.id === p.createdBy);
    const canApprove1 = p.status === 'pending_level1' && canApproveLevel1(user.role) &&
      (user.role === ROLES.ADMIN || p.center === user.center);

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
        ${p.attachments?.length ? `<div class="mt-md">${p.attachments.map((a) =>
          a.url
            ? `<a href="${a.url}" target="_blank" class="attachment-chip">📎 ${UI.escapeHtml(a.name)}</a>`
            : UI.attachmentChip(a)
        ).join('')}</div>` : ''}
      </div>
      ${canApprove1 ? `<div class="field"><label>Ghi chú duyệt (tùy chọn)</label><textarea id="lvl1Note"></textarea></div>` : ''}
      <div class="section-head mt-md"><h3 style="font-size:14px;">Lịch sử xử lý</h3></div>
      <div class="timeline">${(p.history || []).map((h) => `
        <div class="timeline-step ${h.step.includes('rejected') ? 'rejected' : 'done'}">
          <div class="timeline-dot">${h.step.includes('rejected') ? '✕' : '✓'}</div>
          <div class="timeline-title">${historyLabelMap[h.step] || h.step}</div>
          <div class="timeline-meta">${users.find((u) => u.id === h.by)?.name || h.by} · ${UI.formatDateTime(h.at)}</div>
          ${h.note ? `<div class="timeline-note">${UI.escapeHtml(h.note)}</div>` : ''}
        </div>`).join('')}
      </div>
    `;

    const footer = canApprove1
      ? `<button class="btn btn-danger" id="btnRej1">Từ chối</button>
         <button class="btn btn-primary" id="btnApp1">Duyệt → gửi Ban Điều hành</button>`
      : `<button class="btn btn-secondary" id="closeDetail">Đóng</button>`;

    UI.openModal('Chi tiết đề xuất', body, footer);

    if (canApprove1) {
      document.getElementById('btnApp1').addEventListener('click', async () => {
        const note = document.getElementById('lvl1Note').value.trim();
        p.status = 'pending_level2';
        p.history.push({ step: 'level1_approved', by: user.id, at: new Date().toISOString(), note });
        const ok = await DB.set(`proposals:${p.id}`, p);
        if (!ok) { UI.toast('Lỗi duyệt đề xuất. Kiểm tra Console (F12).', 'error'); return; }
        UI.closeModal();
        UI.toast('Đã duyệt cấp 1. Đề xuất chuyển lên Ban Điều hành.', 'success');
        App.refreshCurrent();
      });
      document.getElementById('btnRej1').addEventListener('click', async () => {
        const note = document.getElementById('lvl1Note').value.trim();
        p.status = 'rejected';
        p.history.push({ step: 'level1_rejected', by: user.id, at: new Date().toISOString(), note });
        const ok = await DB.set(`proposals:${p.id}`, p);
        if (!ok) { UI.toast('Lỗi từ chối đề xuất. Kiểm tra Console (F12).', 'error'); return; }
        UI.closeModal();
        UI.toast('Đã từ chối đề xuất.', 'error');
        App.refreshCurrent();
      });
    } else {
      document.getElementById('closeDetail').addEventListener('click', UI.closeModal);
    }
  }

  const historyLabelMap = {
    created: 'Tạo đề xuất', level1_approved: 'Duyệt cấp 1', level1_rejected: 'Từ chối cấp 1',
    level2_approved: 'Ban Điều hành phê duyệt', level2_rejected: 'Ban Điều hành từ chối',
  };

  return { render };
})();
