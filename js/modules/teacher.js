/**
 * modules/teacher.js
 * Dành cho vai trò Giáo viên:
 * - Lịch giảng dạy (ngày / tuần / tháng) — suy ra từ trường `schedule` của lớp
 * - Danh sách lớp phụ trách, thông tin lớp, danh sách học viên
 * - Ghi chú tình hình lớp học (lưu vào field notes của lớp)
 * Điểm danh để ở giai đoạn mở rộng (đánh dấu rõ trong UI) theo đúng đề xuất gốc.
 */

const TeacherModule = (() => {
  let activeTab = 'schedule';
  let scheduleView = 'week';

  async function render(root) {
    const user = Auth.getCurrentUser();
    const classes = (await DB.getTable('classes:')).filter((c) => c.teacherId === user.id);

    root.innerHTML = `
      <div class="tabs">
        <div class="tab ${activeTab === 'schedule' ? 'active' : ''}" data-tab="schedule">Lịch giảng dạy</div>
        <div class="tab ${activeTab === 'classes' ? 'active' : ''}" data-tab="classes">Lớp phụ trách (${classes.length})</div>
      </div>
      <div id="teacherBody"></div>
    `;

    root.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => { activeTab = t.dataset.tab; render(root); }));

    if (activeTab === 'schedule') renderSchedule(root, classes);
    else renderClasses(root, classes);
  }

  function renderSchedule(root, classes) {
    const wrap = root.querySelector('#teacherBody');
    wrap.innerHTML = `
      <div class="card">
        <div class="flex-between mb-md">
          <div class="card-title" style="margin-bottom:0;">Lịch giảng dạy</div>
          <div class="tabs" style="border-bottom:none; margin-bottom:0;">
            ${['day', 'week', 'month'].map((v) => `<div class="tab ${scheduleView === v ? 'active' : ''}" data-view="${v}" style="padding:6px 12px;">${v === 'day' ? 'Theo ngày' : v === 'week' ? 'Theo tuần' : 'Theo tháng'}</div>`).join('')}
          </div>
        </div>
        ${classes.length === 0 ? UI.emptyState('📅', 'Bạn chưa được phân công lớp nào.') : `
          <div class="table-wrap">
            <table>
              <thead><tr><th>Lớp</th><th>Lịch học</th><th>Sĩ số</th><th>Trạng thái</th></tr></thead>
              <tbody>
                ${classes.map((c) => `<tr>
                  <td><strong>${UI.escapeHtml(c.name)}</strong></td>
                  <td>${UI.escapeHtml(c.schedule)}</td>
                  <td>${c.size} học viên</td>
                  <td>${UI.statusBadge(c.status)}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <div class="text-faint mt-md" style="font-size:12px;">Hiển thị theo dạng "${scheduleView === 'day' ? 'ngày' : scheduleView === 'week' ? 'tuần' : 'tháng'}" — lịch chi tiết theo từng buổi sẽ có khi kết nối với hệ thống lịch học chính thức.</div>
        `}
      </div>
    `;
    wrap.querySelectorAll('[data-view]').forEach((el) => el.addEventListener('click', () => { scheduleView = el.dataset.view; renderSchedule(root, classes); }));
  }

  function renderClasses(root, classes) {
    const wrap = root.querySelector('#teacherBody');
    if (classes.length === 0) {
      wrap.innerHTML = UI.emptyState('📚', 'Bạn chưa phụ trách lớp nào.');
      return;
    }
    wrap.innerHTML = `<div class="content-grid cols-2">${classes.map((c) => classCard(c)).join('')}</div>`;
    wrap.querySelectorAll('[data-detail]').forEach((btn) => btn.addEventListener('click', () => openClassDetail(btn.dataset.detail)));
  }

  function classCard(c) {
    return `<div class="card">
      <div class="flex-between mb-sm">
        <h3 style="font-size:15px;">${UI.escapeHtml(c.name)}</h3>
        ${UI.statusBadge(c.status)}
      </div>
      <div class="text-muted" style="font-size:13px;">🕘 ${UI.escapeHtml(c.schedule)}</div>
      <div class="text-muted" style="font-size:13px;">👥 Sĩ số: ${c.size}</div>
      <button class="btn btn-secondary btn-sm mt-md" data-detail="${c.id}">Xem học viên &amp; ghi chú</button>
    </div>`;
  }

  async function openClassDetail(classId) {
    const c = await DB.get(`classes:${classId}`);
    const students = (await DB.getTable('students:')).filter((s) => s.classId === classId);

    const body = `
      <div class="mb-md">
        <div class="text-faint" style="font-size:12.5px;">Lớp</div>
        <h3>${UI.escapeHtml(c.name)}</h3>
      </div>
      <div class="section-head"><h3 style="font-size:14px;">Danh sách học viên (${students.length})</h3></div>
      ${students.length ? `
        <table>
          <thead><tr><th>Họ tên</th><th>Khóa học</th><th>Trạng thái</th></tr></thead>
          <tbody>${students.map((s) => `<tr><td>${UI.escapeHtml(s.name)}</td><td>${UI.escapeHtml(s.course)}</td><td>${UI.statusBadge(s.status)}</td></tr>`).join('')}</tbody>
        </table>
      ` : UI.emptyState('🧑‍🎓', 'Lớp chưa có học viên.')}

      <div class="field mt-md">
        <label>Ghi chú tình hình lớp học</label>
        <textarea id="classNote" placeholder="VD: Lớp tiếp thu tốt, cần bổ sung tài liệu luyện nói...">${UI.escapeHtml(c.notes || '')}</textarea>
      </div>
      <div class="text-faint" style="font-size:12px;">📋 Điểm danh: chức năng đang ở giai đoạn mở rộng, sẽ bổ sung trong phiên bản sau.</div>
    `;
    const footer = `<button class="btn btn-secondary" id="cancelNote">Đóng</button><button class="btn btn-primary" id="saveNote">Lưu ghi chú</button>`;
    UI.openModal('Thông tin lớp học', body, footer);

    document.getElementById('cancelNote').addEventListener('click', UI.closeModal);
    document.getElementById('saveNote').addEventListener('click', async () => {
      c.notes = document.getElementById('classNote').value.trim();
      await DB.set(`classes:${c.id}`, c);
      UI.toast('Đã lưu ghi chú lớp học.', 'success');
      UI.closeModal();
    });
  }

  return { render };
})();
