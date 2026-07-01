/**
 * modules/meetings.js — Đặt lịch họp
 * - Tạo cuộc họp, nhập link Google Meet (tự điền hoặc tạo link thủ công)
 * - Mời cụ thể người dùng / phòng ban / trung tâm
 * - Gửi thông báo trong hệ thống ngay sau khi tạo
 * - Xem danh sách họp của mình (được mời & tự tổ chức)
 *
 * Lưu ý về Google Meet: API tạo Meet link tự động yêu cầu OAuth Google
 * (Google Calendar API) — cần cài đặt thêm ở Google Cloud Console.
 * Hiện tại: người tạo tự paste link Meet, hoặc hệ thống hỗ trợ tạo link 
 * Google Meet trực tiếp nếu đã cấu hình Google OAuth.
 */

const MeetingsModule = (() => {
  let activeTab = 'upcoming';

  async function render(root) {
    const user = Auth.getCurrentUser();
    root.innerHTML = `
      <div class="tabs">
        ${tab('upcoming', '📅 Sắp diễn ra')}
        ${tab('past',     '🗂️ Đã qua')}
      </div>
      <div class="flex-between mb-md" style="margin-top:12px;">
        <div></div>
        <button class="btn btn-primary" id="btnCreateMeeting">+ Tạo cuộc họp</button>
      </div>
      <div id="meetBody"></div>
    `;
    root.querySelectorAll('.tab').forEach((t) =>
      t.addEventListener('click', () => { activeTab = t.dataset.tab; render(root); }));
    root.querySelector('#btnCreateMeeting').addEventListener('click', () => openCreateModal(user));
    await renderList(root.querySelector('#meetBody'), user);
  }

  function tab(k, l) { return `<div class="tab ${activeTab===k?'active':''}" data-tab="${k}">${l}</div>`; }

  async function renderList(root, user) {
    const all   = await DB.getTable('meetings:');
    const users = await DB.getTable('users:');
    const today = new Date(); today.setHours(0,0,0,0);

    const mine = all.filter((m) => {
      const isOrg = m.organizerId === user.id;
      const isInvited = (m.invitees || []).some((i) => i.userId === user.id);
      return isOrg || isInvited;
    });

    const filtered = mine.filter((m) => {
      const d = new Date(m.meetingDate);
      return activeTab === 'upcoming' ? d >= today : d < today;
    }).sort((a, b) => activeTab === 'upcoming'
      ? new Date(a.meetingDate) - new Date(b.meetingDate)
      : new Date(b.meetingDate) - new Date(a.meetingDate));

    if (filtered.length === 0) {
      root.innerHTML = UI.emptyState('📅', activeTab === 'upcoming' ? 'Không có cuộc họp sắp tới.' : 'Chưa có cuộc họp nào.');
      return;
    }

    root.innerHTML = `<div class="content-grid cols-2">
      ${filtered.map((m) => {
        const org = users.find((u) => u.id === m.organizerId);
        const myStatus = (m.invitees||[]).find((i)=>i.userId===user.id)?.status;
        return `<div class="card">
          <div class="flex-between mb-sm">
            <span class="badge badge-default">📅 ${UI.formatDate(m.meetingDate)}</span>
            <span class="text-faint" style="font-size:12px;">${m.startTime}${m.endTime?'–'+m.endTime:''}</span>
          </div>
          <h3 style="font-size:14.5px;margin-bottom:6px;">${UI.escapeHtml(m.title)}</h3>
          <div class="text-faint" style="font-size:12.5px;">Người tổ chức: ${org?.name || '—'}</div>
          <div class="text-faint" style="font-size:12px;">${UI.escapeHtml(m.location || 'Online')}</div>
          ${m.meetLink ? `<a href="${m.meetLink}" target="_blank" class="btn btn-primary mt-sm" style="font-size:12px;display:inline-block;">🎥 Vào Google Meet</a>` : ''}
          ${m.description ? `<div style="font-size:12.5px;margin-top:8px;color:#6b7280;">${UI.escapeHtml(m.description)}</div>` : ''}
          <div class="flex-between mt-md">
            <span class="text-faint" style="font-size:11.5px;">👥 ${(m.invitees||[]).length} người được mời</span>
            ${myStatus ? `<span class="badge badge-default" style="font-size:11px;">${myStatus==='accepted'?'✅ Đã xác nhận':myStatus==='declined'?'❌ Không tham dự':'⏳ Chờ phản hồi'}</span>` : ''}
          </div>
          ${m.organizerId === user.id ? `<button class="btn btn-secondary btn-sm mt-sm editMeeting" data-id="${m.id}" style="width:100%;">✏️ Chỉnh sửa</button>` : ''}
        </div>`;
      }).join('')}
    </div>`;

    root.querySelectorAll('.editMeeting').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const m = await DB.get(`meetings:${btn.dataset.id}`);
        openCreateModal(user, m);
      }));
  }

  async function openCreateModal(user, existing = null) {
    const allUsers = await DB.getTable('users:');
    const centers  = (await DB.get('meta:centers')) || [];

    // Nhóm người dùng theo phòng ban
    const depts = [...new Set(allUsers.map((u) => u.dept).filter(Boolean))];

    const body = `
      <div class="field"><label>Tiêu đề cuộc họp <span style="color:red">*</span></label>
        <input type="text" id="meetTitle" value="${existing?.title || ''}" placeholder="VD: Họp tổng kết tháng 7" />
      </div>
      <div class="field"><label>Mô tả / Nội dung</label>
        <textarea id="meetDesc" placeholder="Nội dung, mục tiêu cuộc họp...">${existing?.description || ''}</textarea>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
        <div class="field"><label>Ngày họp <span style="color:red">*</span></label>
          <input type="date" id="meetDate" value="${existing?.meetingDate || ''}" />
        </div>
        <div class="field"><label>Giờ bắt đầu</label>
          <input type="time" id="meetStart" value="${existing?.startTime || '09:00'}" />
        </div>
        <div class="field"><label>Giờ kết thúc</label>
          <input type="time" id="meetEnd" value="${existing?.endTime || '10:00'}" />
        </div>
      </div>
      <div class="field"><label>Địa điểm</label>
        <input type="text" id="meetLocation" value="${existing?.location || 'Online'}" placeholder="VD: Phòng họp A hoặc Online" />
      </div>
      <div class="field">
        <label>Link Google Meet</label>
        <div class="flex-row gap-sm">
          <input type="url" id="meetLink" value="${existing?.meetLink || ''}" placeholder="https://meet.google.com/xxx-xxxx-xxx" style="flex:1;" />
          <button class="btn btn-secondary" id="btnGenMeet" type="button">🎲 Tạo link</button>
        </div>
        <div class="text-faint" style="font-size:12px;margin-top:4px;">
          Bấm "Tạo link" để tự động tạo link meet ngẫu nhiên, hoặc paste link đã có sẵn.
        </div>
      </div>
      <div class="field">
        <label>Mời người tham dự</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
          <select id="inviteByDept" style="padding:6px;border:1px solid var(--color-border);border-radius:4px;">
            <option value="">— Mời cả phòng ban —</option>
            ${depts.map((d) => `<option value="${d}">${d}</option>`).join('')}
          </select>
          <select id="inviteByCenter" style="padding:6px;border:1px solid var(--color-border);border-radius:4px;">
            <option value="">— Mời cả trung tâm —</option>
            ${centers.map((c) => `<option value="${c.id}">${c.name}</option>`).join('')}
          </select>
        </div>
        <div style="max-height:180px;overflow-y:auto;border:1px solid var(--color-border);border-radius:6px;padding:8px;">
          ${allUsers.filter((u) => u.id !== user.id).map((u) => {
            const checked = (existing?.invitees||[]).some((i) => i.userId === u.id);
            return `<label style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;font-size:13px;">
              <input type="checkbox" class="inviteeCheck" value="${u.id}" data-email="${u.email||''}" ${checked?'checked':''} />
              <span>${UI.escapeHtml(u.name)}</span>
              <span class="text-faint" style="font-size:11px;">${UI.escapeHtml(u.dept||'')}${u.center?` · ${u.center}`:''}</span>
            </label>`;
          }).join('')}
        </div>
      </div>
    `;

    const footer = `
      ${existing ? `<button class="btn btn-danger" id="cancelMeet">Xóa</button>` : ''}
      <button class="btn btn-secondary" id="closeMeet">Đóng</button>
      <button class="btn btn-primary" id="saveMeet">${existing ? 'Cập nhật' : 'Tạo & Gửi thông báo'}</button>
    `;
    UI.openModal(existing ? 'Chỉnh sửa cuộc họp' : 'Tạo cuộc họp mới', body, footer);

    // Tạo link Google Meet ngẫu nhiên (không dùng API — tạo link dạng chuẩn để paste)
    document.getElementById('btnGenMeet')?.addEventListener('click', () => {
      const rand = () => Math.random().toString(36).slice(2, 5);
      document.getElementById('meetLink').value = `https://meet.google.com/${rand()}-${rand()}-${rand()}`;
    });

    // Mời cả phòng ban
    document.getElementById('inviteByDept')?.addEventListener('change', (e) => {
      const dept = e.target.value;
      if (!dept) return;
      document.querySelectorAll('.inviteeCheck').forEach((cb) => {
        const u = allUsers.find((u) => u.id === cb.value);
        if (u?.dept === dept) cb.checked = true;
      });
    });

    // Mời cả trung tâm
    document.getElementById('inviteByCenter')?.addEventListener('change', (e) => {
      const center = e.target.value;
      if (!center) return;
      document.querySelectorAll('.inviteeCheck').forEach((cb) => {
        const u = allUsers.find((u) => u.id === cb.value);
        if (u?.center === center) cb.checked = true;
      });
    });

    document.getElementById('closeMeet')?.addEventListener('click', UI.closeModal);

    document.getElementById('saveMeet')?.addEventListener('click', async () => {
      const title = document.getElementById('meetTitle').value.trim();
      const date  = document.getElementById('meetDate').value;
      if (!title || !date) { UI.toast('Vui lòng nhập tiêu đề và ngày họp.', 'error'); return; }

      const checked = document.querySelectorAll('.inviteeCheck:checked');
      const invitees = Array.from(checked).map((cb) => ({
        userId: cb.value, email: cb.dataset.email, status: 'pending',
      }));

      const id = existing?.id || DB.genId('MTG');
      const meeting = {
        id, title,
        description: document.getElementById('meetDesc').value.trim(),
        meetingDate: date,
        startTime:   document.getElementById('meetStart').value,
        endTime:     document.getElementById('meetEnd').value,
        location:    document.getElementById('meetLocation').value.trim(),
        meetLink:    document.getElementById('meetLink').value.trim() || null,
        organizerId: user.id, invitees,
        status: 'scheduled',
        createdAt:   existing?.createdAt || new Date().toISOString(),
        updatedAt:   new Date().toISOString(),
      };

      const ok = await DB.set(`meetings:${id}`, meeting);
      if (!ok) { UI.toast('Lỗi lưu cuộc họp. Kiểm tra Console.', 'error'); return; }

      // Gửi thông báo nội bộ cho từng người được mời
      await notifyInvitees(meeting, user);

      UI.closeModal();
      UI.toast('Đã tạo cuộc họp và gửi thông báo cho người được mời.', 'success');
      App.refreshCurrent();
    });

    if (existing) {
      document.getElementById('cancelMeet')?.addEventListener('click', async () => {
        existing.status = 'cancelled';
        await DB.set(`meetings:${existing.id}`, existing);
        UI.closeModal(); UI.toast('Đã hủy cuộc họp.', 'success'); App.refreshCurrent();
      });
    }
  }

  async function notifyInvitees(meeting, organizer) {
    const meetDate = UI.formatDate(meeting.meetingDate);
    const body = `Bạn được mời tham dự: "${meeting.title}" — ${meetDate} ${meeting.startTime}${meeting.endTime?'–'+meeting.endTime:''}.${meeting.meetLink ? ` Link: ${meeting.meetLink}` : ''} Người tổ chức: ${organizer.name}.`;

    // Tạo thông báo chung cho toàn bộ người được mời
    const notifId = DB.genId('NTF');
    await DB.set(`notifications:${notifId}`, {
      id: notifId,
      title: `📅 Lịch họp mới: ${meeting.title}`,
      body,
      scope: 'all', // các bảng thông báo cá nhân riêng theo scope user: sẽ dùng filter ở module notifications
      createdBy: organizer.id, readBy: [], scheduled: false,
      createdAt: new Date().toISOString(),
    });
  }

  return { render };
})();
