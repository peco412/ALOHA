/**
 * modules/attendance.js — Điểm danh lớp học
 * Dành cho giáo viên và quản lý trung tâm.
 * - Giáo viên: điểm danh buổi học của mình, xem lịch sử
 * - Quản lý trung tâm: xem toàn bộ buổi học trong trung tâm, thêm/sửa
 * - Thống kê: tổng buổi / vắng / đi trễ theo từng học viên
 */

const AttendanceModule = (() => {
  let activeTab = 'checkin';

  async function render(root) {
    const user = Auth.getCurrentUser();
    const isCM = user.role === ROLES.CENTER_MANAGER || user.role === ROLES.ADMIN || user.role === ROLES.EXEC;
    const isTeacher = user.role === ROLES.TEACHER;

    if (!isCM && !isTeacher) {
      root.innerHTML = UI.emptyState('📵', 'Tính năng này dành cho giáo viên và quản lý trung tâm.');
      return;
    }

    root.innerHTML = `
      <div class="tabs">
        ${tab('checkin', '✅ Điểm danh hôm nay')}
        ${tab('history', '📅 Lịch sử buổi học')}
        ${tab('report',  '📊 Báo cáo chuyên cần')}
      </div>
      <div id="attBody"></div>
    `;
    root.querySelectorAll('.tab').forEach((t) =>
      t.addEventListener('click', () => { activeTab = t.dataset.tab; render(root); }));

    const body = root.querySelector('#attBody');
    if (activeTab === 'checkin') await renderCheckin(body, user, isCM);
    else if (activeTab === 'history') await renderHistory(body, user, isCM);
    else await renderReport(body, user, isCM);
  }

  function tab(k, l) { return `<div class="tab ${activeTab===k?'active':''}" data-tab="${k}">${l}</div>`; }

  // ─── ĐIỂM DANH HÔM NAY ────────────────────────────────────────────────────

  async function renderCheckin(root, user, isCM) {
    const today = new Date().toISOString().slice(0, 10);
    const [allClasses, allStudents, allSessions] = await Promise.all([
      DB.getTable('classes:'), DB.getTable('students:'), DB.getTable('attendance_sessions:'),
    ]);

    const myClasses = isCM
      ? allClasses.filter((c) => c.center === (user.center || c.center) && c.status === 'active')
      : allClasses.filter((c) => c.teacherId === user.id && c.status === 'active');

    if (myClasses.length === 0) {
      root.innerHTML = UI.emptyState('🏫', 'Không có lớp hoạt động nào.');
      return;
    }

    root.innerHTML = `
      <div class="text-faint mb-md" style="font-size:12.5px;">📅 Hôm nay: <strong>${today}</strong></div>
      <div class="content-grid cols-2" id="classCards"></div>
    `;

    const grid = root.querySelector('#classCards');
    myClasses.forEach((cls) => {
      const todaySession = allSessions.find((s) => s.classId === cls.id && s.sessionDate === today);
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="flex-between mb-sm">
          <strong>${UI.escapeHtml(cls.name)}</strong>
          ${todaySession
            ? `<span class="badge badge-completed">Đã điểm danh</span>`
            : `<span class="badge badge-pending">Chưa điểm danh</span>`}
        </div>
        <div class="text-faint" style="font-size:12.5px;">${UI.escapeHtml(cls.schedule || '')}</div>
        <div class="text-faint" style="font-size:12px;margin-top:4px;">Sĩ số: ${cls.size} học viên</div>
        <button class="btn ${todaySession ? 'btn-secondary' : 'btn-primary'} mt-md" style="width:100%;" data-cls="${cls.id}" data-session="${todaySession?.id || ''}">
          ${todaySession ? '✏️ Xem/Sửa điểm danh' : '✅ Bắt đầu điểm danh'}
        </button>
      `;
      grid.appendChild(card);
      card.querySelector('button').addEventListener('click', (e) => {
        openCheckinModal(cls, allStudents.filter((s) => s.classId === cls.id), today, e.target.dataset.session, user);
      });
    });
  }

  async function openCheckinModal(cls, students, date, existingSessionId, user) {
    let existing = null;
    let existingRecords = [];

    if (existingSessionId) {
      existing = await DB.get(`attendance_sessions:${existingSessionId}`);
      const allRecords = await DB.getTable('attendance_records:');
      existingRecords = allRecords.filter((r) => r.sessionId === existingSessionId);
    }

    const body = `
      <div class="mb-md">
        <strong>${UI.escapeHtml(cls.name)}</strong>
        <div class="text-faint" style="font-size:12.5px;">📅 ${date}</div>
      </div>
      <div class="field">
        <label>Nội dung bài học / chủ đề buổi học</label>
        <input type="text" id="sessionTopic" value="${existing?.topic || ''}" placeholder="VD: Unit 5 - Family members" />
      </div>
      <div class="field">
        <label>Ghi chú buổi học</label>
        <input type="text" id="sessionNote" value="${existing?.note || ''}" placeholder="VD: Nhiều em làm bài tốt" />
      </div>
      <div class="section-head mt-md"><h3 style="font-size:13.5px;">Điểm danh học viên (${students.length})</h3></div>
      ${students.length === 0 ? '<div class="text-faint">Chưa có học viên nào trong lớp này.</div>' : `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Học viên</th><th style="width:180px;">Trạng thái</th><th>Ghi chú</th></tr></thead>
            <tbody>
              ${students.map((s) => {
                const rec = existingRecords.find((r) => r.studentId === s.id);
                const status = rec?.status || 'present';
                return `<tr>
                  <td><strong>${UI.escapeHtml(s.name)}</strong></td>
                  <td>
                    <select class="attendance-status" data-student="${s.id}" style="padding:4px 8px;border:1px solid var(--color-border);border-radius:4px;width:100%;">
                      <option value="present"  ${status==='present' ?'selected':''}>✅ Có mặt</option>
                      <option value="absent"   ${status==='absent'  ?'selected':''}>❌ Vắng mặt</option>
                      <option value="late"     ${status==='late'    ?'selected':''}>⏰ Đi trễ</option>
                      <option value="excused"  ${status==='excused' ?'selected':''}>📋 Có phép</option>
                    </select>
                  </td>
                  <td><input type="text" class="att-note" data-student="${s.id}" value="${rec?.note || ''}" placeholder="Ghi chú..." style="width:100%;padding:4px;border:1px solid var(--color-border);border-radius:4px;" /></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      `}
    `;

    const footer = `
      <button class="btn btn-secondary" id="cancelAtt">Hủy</button>
      <button class="btn btn-primary" id="saveAtt">Lưu điểm danh</button>
    `;
    UI.openModal('Điểm danh lớp học', body, footer);
    document.getElementById('cancelAtt').addEventListener('click', UI.closeModal);
    document.getElementById('saveAtt').addEventListener('click', async () => {
      const topic = document.getElementById('sessionTopic').value.trim();
      const note  = document.getElementById('sessionNote').value.trim();
      const sessionId = existingSessionId || DB.genId('ATT-S');

      const ok = await DB.set(`attendance_sessions:${sessionId}`, {
        id: sessionId, classId: cls.id, sessionDate: date,
        teacherId: user.id, topic, note,
        createdBy: user.id,
        createdAt: existing?.createdAt || new Date().toISOString(),
      });
      if (!ok) { UI.toast('Lỗi lưu buổi học. Kiểm tra Console.', 'error'); return; }

      // Lưu từng bản ghi điểm danh
      const statusEls = document.querySelectorAll('.attendance-status');
      const savePs = Array.from(statusEls).map((sel) => {
        const studentId = sel.dataset.student;
        const noteEl = document.querySelector(`.att-note[data-student="${studentId}"]`);
        const recId = existingRecords.find((r) => r.studentId === studentId)?.id || DB.genId('ATT-R');
        return DB.set(`attendance_records:${recId}`, {
          id: recId, sessionId, studentId, status: sel.value, note: noteEl?.value.trim() || '',
        });
      });
      await Promise.all(savePs);

      UI.closeModal();
      UI.toast('Đã lưu điểm danh.', 'success');
      App.refreshCurrent();
    });
  }

  // ─── LỊCH SỬ BUỔI HỌC ────────────────────────────────────────────────────

  async function renderHistory(root, user, isCM) {
    const [allSessions, allClasses, allUsers] = await Promise.all([
      DB.getTable('attendance_sessions:'), DB.getTable('classes:'), DB.getTable('users:'),
    ]);
    const mySessions = isCM
      ? allSessions.filter((s) => allClasses.find((c) => c.id === s.classId && (isCM ? (c.center === user.center || !user.center) : c.teacherId === user.id)))
      : allSessions.filter((s) => s.teacherId === user.id);
    mySessions.sort((a, b) => new Date(b.sessionDate) - new Date(a.sessionDate));

    root.innerHTML = mySessions.length === 0 ? UI.emptyState('📅', 'Chưa có buổi học nào được ghi nhận.') : `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Ngày</th><th>Lớp</th><th>Chủ đề</th><th>Giáo viên</th><th>Ghi chú</th></tr></thead>
          <tbody>
            ${mySessions.slice(0, 50).map((s) => {
              const cls = allClasses.find((c) => c.id === s.classId);
              const teacher = allUsers.find((u) => u.id === s.teacherId);
              return `<tr>
                <td>${UI.formatDate(s.sessionDate)}</td>
                <td>${cls?.name || s.classId}</td>
                <td>${UI.escapeHtml(s.topic || '—')}</td>
                <td>${teacher?.name || '—'}</td>
                <td>${UI.escapeHtml(s.note || '—')}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // ─── BÁO CÁO CHUYÊN CẦN ──────────────────────────────────────────────────

  async function renderReport(root, user, isCM) {
    const [allSessions, allRecords, allStudents, allClasses] = await Promise.all([
      DB.getTable('attendance_sessions:'), DB.getTable('attendance_records:'),
      DB.getTable('students:'), DB.getTable('classes:'),
    ]);

    const myClasses = isCM
      ? allClasses.filter((c) => c.status === 'active' && (!user.center || c.center === user.center))
      : allClasses.filter((c) => c.teacherId === user.id && c.status === 'active');

    root.innerHTML = myClasses.length === 0 ? UI.emptyState('📊', 'Không có lớp để báo cáo.') : myClasses.map((cls) => {
      const sessions = allSessions.filter((s) => s.classId === cls.id);
      const students = allStudents.filter((s) => s.classId === cls.id);
      const totalSessions = sessions.length;

      return `
        <div class="card mb-md">
          <div class="card-title">${UI.escapeHtml(cls.name)} — ${totalSessions} buổi đã ghi nhận</div>
          ${students.length === 0 ? '<div class="text-faint">Chưa có học viên.</div>' : `
            <div class="table-wrap">
              <table>
                <thead><tr><th>Học viên</th><th>Có mặt</th><th>Vắng</th><th>Đi trễ</th><th>Có phép</th><th>Tỉ lệ</th></tr></thead>
                <tbody>
                  ${students.map((s) => {
                    const recs = allRecords.filter((r) => sessions.some((se) => se.id === r.sessionId) && r.studentId === s.id);
                    const present = recs.filter((r) => r.status === 'present').length;
                    const absent  = recs.filter((r) => r.status === 'absent').length;
                    const late    = recs.filter((r) => r.status === 'late').length;
                    const excused = recs.filter((r) => r.status === 'excused').length;
                    const rate    = totalSessions > 0 ? Math.round(((present + late) / totalSessions) * 100) : 0;
                    return `<tr>
                      <td>${UI.escapeHtml(s.name)}</td>
                      <td style="color:#16a34a;">${present}</td>
                      <td style="color:#dc2626;">${absent}</td>
                      <td style="color:#d97706;">${late}</td>
                      <td>${excused}</td>
                      <td><strong style="color:${rate>=80?'#16a34a':rate>=60?'#d97706':'#dc2626'}">${rate}%</strong></td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
      `;
    }).join('');
  }

  return { render };
})();
