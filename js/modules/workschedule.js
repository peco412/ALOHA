/**
 * modules/workschedule.js — Lịch làm việc nhân sự
 * - Quản lý trung tâm: xếp lịch làm việc cho nhân viên/giáo viên tại trung tâm mình
 * - Trưởng phòng nhân sự / Admin: xem & xếp lịch toàn hệ thống
 * - Nhân viên/giáo viên: xem lịch làm việc của mình
 */

const WorkScheduleModule = (() => {
  async function render(root) {
    const user = Auth.getCurrentUser();
    const canManage = [ROLES.ADMIN, ROLES.EXEC, ROLES.CENTER_MANAGER,
      ROLES.DEPT_HEAD].includes(user.role);

    const today = new Date();
    const mon = new Date(today);
    mon.setDate(today.getDate() - (today.getDay() === 0 ? 6 : today.getDay() - 1));
    mon.setHours(0, 0, 0, 0);
    const weekStart = mon.toISOString().slice(0, 10);

    const [allSchedules, allUsers, centers] = await Promise.all([
      DB.getTable('work_schedules:'), DB.getTable('users:'), DB.get('meta:centers'),
    ]);

    const myCenter = user.center || null;
    const staffList = canManage
      ? allUsers.filter((u) => !myCenter || u.center === myCenter || u.role === ROLES.TEACHER)
      : [allUsers.find((u) => u.id === user.id)].filter(Boolean);

    const weekSchedules = allSchedules.filter((s) => {
      const d = new Date(s.workDate);
      const end = new Date(mon); end.setDate(mon.getDate() + 7);
      return d >= mon && d < end;
    });

    const days = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
    function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
    function fmtShort(d) { return `${d.getDate()}/${d.getMonth()+1}`; }

    root.innerHTML = `
      <div class="flex-between mb-md">
        <div>
          <div class="card-title" style="margin:0;">Lịch làm việc tuần</div>
          <div class="text-faint" style="font-size:12px;">Từ ${fmtShort(mon)} — ${fmtShort(addDays(mon,6))}</div>
        </div>
        ${canManage ? `<button class="btn btn-primary" id="btnAddShift">+ Thêm ca làm</button>` : ''}
      </div>
      <div class="table-wrap">
        <table style="min-width:900px;">
          <thead>
            <tr>
              <th style="min-width:150px;">Nhân sự</th>
              ${days.map((d, i) => `<th>${d}<br/><span style="font-weight:400;font-size:11px;">${fmtShort(addDays(mon,i))}</span></th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${staffList.map((u) => {
              if (!u) return '';
              return `<tr>
                <td>
                  <strong style="font-size:13px;">${UI.escapeHtml(u.name)}</strong><br/>
                  <span class="text-faint" style="font-size:11px;">${UI.escapeHtml(u.position || '')}</span>
                </td>
                ${[0,1,2,3,4,5,6].map((i) => {
                  const date = addDays(mon, i).toISOString().slice(0, 10);
                  const shift = weekSchedules.find((s) => s.userId === u.id && s.workDate === date);
                  if (!shift) {
                    return canManage
                      ? `<td style="background:#fafafa;cursor:pointer;" class="addShiftCell" data-user="${u.id}" data-date="${date}">
                          <span class="text-faint" style="font-size:11px;">+ Thêm</span>
                        </td>`
                      : `<td style="background:#fafafa;color:#ddd;">—</td>`;
                  }
                  const bg = shift.shiftType === 'day_off' ? '#fef2f2' : shift.shiftType === 'overtime' ? '#fef9c3' : '#f0fdf4';
                  return `<td style="background:${bg};">
                    <div style="font-size:11px;font-weight:600;">${shift.shiftStart || ''} – ${shift.shiftEnd || ''}</div>
                    <div style="font-size:10px;color:#6b7280;">${shiftLabel(shift.shiftType)}</div>
                    ${canManage ? `<button class="btn btn-secondary btn-sm editShift" data-id="${shift.id}" style="font-size:10px;margin-top:2px;">Sửa</button>` : ''}
                  </td>`;
                }).join('')}
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    if (canManage) {
      root.querySelector('#btnAddShift')?.addEventListener('click', () =>
        openShiftModal(null, null, null, staffList, user));
      root.querySelectorAll('.addShiftCell').forEach((td) =>
        td.addEventListener('click', () =>
          openShiftModal(null, td.dataset.user, td.dataset.date, staffList, user)));
      root.querySelectorAll('.editShift').forEach((btn) =>
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const shift = await DB.get(`work_schedules:${btn.dataset.id}`);
          openShiftModal(shift, null, null, staffList, user);
        }));
    }
  }

  function shiftLabel(type) {
    return { normal: 'Ca thường', overtime: 'Tăng ca', day_off: 'Nghỉ phép' }[type] || type;
  }

  async function openShiftModal(existing, prefUser, prefDate, staffList, curUser) {
    const body = `
      <div class="field"><label>Nhân sự <span style="color:red">*</span></label>
        <select id="shiftUser">
          <option value="">— Chọn nhân sự —</option>
          ${staffList.map((u) => u ? `<option value="${u.id}" ${(existing?.userId || prefUser) === u.id ? 'selected' : ''}>${u.name}</option>` : '').join('')}
        </select>
      </div>
      <div class="field"><label>Ngày <span style="color:red">*</span></label>
        <input type="date" id="shiftDate" value="${existing?.workDate || prefDate || ''}" />
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="field"><label>Giờ bắt đầu</label>
          <input type="time" id="shiftStart" value="${existing?.shiftStart || '08:00'}" />
        </div>
        <div class="field"><label>Giờ kết thúc</label>
          <input type="time" id="shiftEnd" value="${existing?.shiftEnd || '17:00'}" />
        </div>
      </div>
      <div class="field"><label>Loại ca</label>
        <select id="shiftType">
          <option value="normal"   ${(existing?.shiftType||'normal')==='normal'   ?'selected':''}>Ca thường</option>
          <option value="overtime" ${existing?.shiftType==='overtime'?'selected':''}>Tăng ca</option>
          <option value="day_off"  ${existing?.shiftType==='day_off' ?'selected':''}>Nghỉ phép</option>
        </select>
      </div>
      <div class="field"><label>Ghi chú</label>
        <input type="text" id="shiftNote" value="${existing?.note || ''}" placeholder="Ghi chú thêm..." />
      </div>
    `;
    const footer = `
      ${existing ? `<button class="btn btn-danger" id="deleteShift">Xóa</button>` : ''}
      <button class="btn btn-secondary" id="cancelShift">Hủy</button>
      <button class="btn btn-primary" id="saveShift">Lưu lịch</button>
    `;
    UI.openModal(existing ? 'Sửa ca làm việc' : 'Thêm ca làm việc', body, footer);
    document.getElementById('cancelShift').addEventListener('click', UI.closeModal);
    document.getElementById('saveShift').addEventListener('click', async () => {
      const userId = document.getElementById('shiftUser').value;
      const date   = document.getElementById('shiftDate').value;
      if (!userId || !date) { UI.toast('Vui lòng chọn nhân sự và ngày.', 'error'); return; }
      const id = existing?.id || DB.genId('WS');
      const ok = await DB.set(`work_schedules:${id}`, {
        id, userId, center: curUser.center || null,
        workDate: date,
        shiftStart: document.getElementById('shiftStart').value,
        shiftEnd:   document.getElementById('shiftEnd').value,
        shiftType:  document.getElementById('shiftType').value,
        note:       document.getElementById('shiftNote').value.trim(),
        createdBy:  curUser.id,
        createdAt:  existing?.createdAt || new Date().toISOString(),
      });
      if (!ok) { UI.toast('Lỗi lưu lịch. Kiểm tra Console.', 'error'); return; }
      UI.closeModal(); UI.toast('Đã lưu lịch làm việc.', 'success'); App.refreshCurrent();
    });
    if (existing) {
      document.getElementById('deleteShift').addEventListener('click', async () => {
        await DB.remove(`work_schedules:${existing.id}`);
        UI.closeModal(); UI.toast('Đã xóa ca làm.', 'success'); App.refreshCurrent();
      });
    }
  }

  return { render };
})();
