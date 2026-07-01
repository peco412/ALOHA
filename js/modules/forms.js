/**
 * modules/forms.js — Hệ thống biểu mẫu động
 * Xử lý: Yêu cầu CSVC | Thanh toán hóa đơn DN | Kế hoạch sự kiện
 * + Khung mở rộng để thêm biểu mẫu mới sau này (không cần sửa code)
 *
 * Luồng duyệt chung:
 *  pending_review → trưởng phòng tiếp nhận → pending_bgd
 *  pending_bgd → BGD phê duyệt (kèm mộc) → approved
 *  Duyệt xong → ban hành thông báo tới đúng trung tâm / cá nhân
 *
 * Chữ ký số: mỗi cấp duyệt có thể thêm ảnh chữ ký cá nhân;
 *            riêng BGD thêm thêm mộc công ty (ghi đè lên PDF và lưu bản mới).
 */

const FormsModule = (() => {
  let activeTab = 'mine';
  let activeTemplate = null; // code của biểu mẫu đang xem

  // ─── Render tổng ──────────────────────────────────────────────────────────

  async function render(root) {
    const user = Auth.getCurrentUser();
    const templates = await DB.getTable('form_templates:');
    const activeTemplates = templates.filter((t) => t.isActive);

    const isBGD = user.role === ROLES.EXEC || user.role === ROLES.ADMIN;
    const isDeptHead = user.role === ROLES.DEPT_HEAD;
    const canReview = isBGD || isDeptHead;

    root.innerHTML = `
      <div class="tabs">
        ${tab('mine',    '📋 Của tôi')}
        ${tab('all',     '📁 Tất cả')}
        ${canReview ? tab('pending', '⏳ Chờ duyệt') : ''}
        ${isBGD ? tab('approved', '✅ Đã duyệt') : ''}
      </div>
      <div id="formsBody"></div>
    `;
    root.querySelectorAll('.tab').forEach((t) =>
      t.addEventListener('click', () => { activeTab = t.dataset.tab; render(root); }));

    const body = root.querySelector('#formsBody');

    // Nút tạo biểu mẫu mới — chọn loại
    const createBar = document.createElement('div');
    createBar.className = 'flex-between mb-md';
    createBar.innerHTML = `
      <div></div>
      <div class="flex-row gap-sm">
        ${activeTemplates.map((t) => `
          <button class="btn btn-secondary btnCreateForm" data-code="${t.code}" title="${t.description || ''}">
            ${t.icon || '📋'} ${t.name}
          </button>`).join('')}
      </div>
    `;
    body.appendChild(createBar);
    body.querySelectorAll('.btnCreateForm').forEach((btn) =>
      btn.addEventListener('click', () => openCreateModal(btn.dataset.code, user)));

    // Nội dung theo tab
    const listWrap = document.createElement('div');
    body.appendChild(listWrap);

    await renderList(listWrap, user, isBGD, isDeptHead, activeTemplates);
  }

  function tab(key, label) {
    return `<div class="tab ${activeTab === key ? 'active' : ''}" data-tab="${key}">${label}</div>`;
  }

  // ─── Danh sách biểu mẫu ──────────────────────────────────────────────────

  async function renderList(root, user, isBGD, isDeptHead, templates) {
    const all  = await DB.getTable('form_submissions:');
    const users = await DB.getTable('users:');

    let items;
    if (activeTab === 'mine') {
      items = all.filter((f) => f.requestedBy === user.id);
    } else if (activeTab === 'pending') {
      items = all.filter((f) => {
        if (isBGD) return f.status === 'pending_bgd';
        if (isDeptHead) return f.status === 'pending_review' && canHandleTemplate(user, f.templateCode, templates);
        return false;
      });
    } else if (activeTab === 'approved') {
      items = all.filter((f) => f.status === 'approved');
    } else {
      items = isBGD ? all : all.filter((f) => f.requestedBy === user.id);
    }

    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (items.length === 0) {
      root.innerHTML = UI.emptyState('📋', 'Không có biểu mẫu nào.');
      return;
    }

    root.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Mã</th><th>Loại biểu mẫu</th><th>Tiêu đề</th><th>Người tạo</th>
            <th>Ngày tạo</th><th>Trạng thái</th><th></th>
          </tr></thead>
          <tbody>
            ${items.map((f) => {
              const tpl = templates.find((t) => t.code === f.templateCode);
              const creator = users.find((u) => u.id === f.requestedBy);
              return `<tr class="clickable" data-id="${f.id}">
                <td class="mono" style="font-size:11px;">${f.id}</td>
                <td>${tpl ? `${tpl.icon} ${tpl.name}` : f.templateCode}</td>
                <td><strong>${UI.escapeHtml(f.title)}</strong></td>
                <td>${creator?.name || '—'}</td>
                <td>${UI.formatDate(f.createdAt)}</td>
                <td>${formStatusBadge(f.status)}</td>
                <td><button class="btn btn-secondary btn-sm">Xem</button></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
    root.querySelectorAll('tr.clickable').forEach((tr) =>
      tr.addEventListener('click', () => openDetailModal(tr.dataset.id, user, isBGD, isDeptHead, templates)));
  }

  function canHandleTemplate(user, templateCode, templates) {
    const tpl = templates.find((t) => t.code === templateCode);
    if (!tpl) return false;
    const flow = tpl.approvalFlow || [];
    const step1 = flow[0];
    if (!step1) return false;
    if (step1.role && user.role === step1.role) return true;
    // Trưởng phòng marketing: nhận event_plan
    if (templateCode === 'event_plan' && user.dept === 'Marketing' && user.role === ROLES.DEPT_HEAD) return true;
    // Trưởng phòng kế toán: nhận invoice_payment
    if (templateCode === 'invoice_payment' && user.dept === 'Kế toán' && user.role === ROLES.DEPT_HEAD) return true;
    // Bất kỳ dept_head nào: nhận facility_request
    if (templateCode === 'facility_request' && user.role === ROLES.DEPT_HEAD) return true;
    return false;
  }

  function formStatusBadge(status) {
    const map = {
      pending_review: { label: 'Chờ tiếp nhận',   cls: 'badge-pending' },
      pending_bgd:    { label: 'Chờ BGD duyệt',    cls: 'badge-in-progress' },
      approved:       { label: 'Đã phê duyệt',     cls: 'badge-completed' },
      rejected:       { label: 'Bị từ chối',        cls: 'badge-rejected' },
      needs_revision: { label: 'Cần chỉnh sửa',    cls: 'badge-default' },
    };
    const s = map[status] || { label: status, cls: 'badge-default' };
    return `<span class="badge ${s.cls}">${s.label}</span>`;
  }

  // ─── Tạo biểu mẫu mới ────────────────────────────────────────────────────

  async function openCreateModal(code, user) {
    const tpl = await DB.get(`form_templates:${code}`);
    if (!tpl) { UI.toast('Không tìm thấy mẫu biểu mẫu.', 'error'); return; }
    const centers = (await DB.get('meta:centers')) || [];

    const dynamicFields = (tpl.fields || []).map((f) => {
      if (f.type === 'text' || !f.type) {
        return `<div class="field"><label>${f.label}${f.required ? ' <span style="color:red">*</span>' : ''}</label>
          <input type="text" id="field_${f.key}" placeholder="${f.placeholder || ''}" /></div>`;
      } else if (f.type === 'textarea') {
        return `<div class="field"><label>${f.label}${f.required ? ' <span style="color:red">*</span>' : ''}</label>
          <textarea id="field_${f.key}" placeholder="${f.placeholder || ''}"></textarea></div>`;
      } else if (f.type === 'number') {
        return `<div class="field"><label>${f.label}${f.required ? ' <span style="color:red">*</span>' : ''}</label>
          <input type="number" id="field_${f.key}" /></div>`;
      } else if (f.type === 'date') {
        return `<div class="field"><label>${f.label}</label><input type="date" id="field_${f.key}" /></div>`;
      }
      return '';
    }).join('');

    // Field đặc biệt cho invoice_payment: thông tin hóa đơn doanh nghiệp
    const invoiceFields = code === 'invoice_payment' ? `
      <div class="card mb-md" style="background:#f0fdf4;border:1px solid #86efac;">
        <div class="card-title" style="font-size:13px;">📄 Thông tin hóa đơn doanh nghiệp</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div class="field"><label>Tên đơn vị/nhà cung cấp <span style="color:red">*</span></label>
            <input type="text" id="inv_vendor_name" placeholder="Công ty TNHH..." /></div>
          <div class="field"><label>Mã số thuế</label>
            <input type="text" id="inv_vendor_tax_code" /></div>
          <div class="field"><label>Số hóa đơn</label>
            <input type="text" id="inv_invoice_number" /></div>
          <div class="field"><label>Ngày hóa đơn</label>
            <input type="date" id="inv_invoice_date" /></div>
          <div class="field" style="grid-column:1/-1;"><label>Số tiền thanh toán (VNĐ) <span style="color:red">*</span></label>
            <input type="number" id="inv_amount" placeholder="VD: 15000000" /></div>
          <div class="field" style="grid-column:1/-1;"><label>Nội dung thanh toán</label>
            <textarea id="inv_description" placeholder="Thanh toán tiền mua thiết bị âm thanh..."></textarea></div>
          <div class="field" style="grid-column:1/-1;"><label>Upload hóa đơn (PDF/ảnh, tùy chọn)</label>
            <input type="file" id="inv_invoice_file" accept=".pdf,.jpg,.jpeg,.png" />
            <div class="text-faint" style="font-size:12px;margin-top:4px;">Có thể bổ sung sau khi có hóa đơn thật</div>
          </div>
        </div>
      </div>` : '';

    const body = `
      <div class="field">
        <label>Tiêu đề <span style="color:red">*</span></label>
        <input type="text" id="formTitle" placeholder="VD: Mua máy chiếu phòng học Trà Vinh" />
      </div>
      <div class="field">
        <label>Trung tâm liên quan</label>
        <select id="formCenter">
          <option value="">— Văn phòng / Chung —</option>
          ${centers.map((c) => `<option value="${c.id}" ${user.center === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
        </select>
      </div>
      ${dynamicFields}
      ${invoiceFields}
      <div class="field">
        <label>Mô tả / Lý do chi tiết <span style="color:red">*</span></label>
        <textarea id="formDescription" placeholder="Nêu rõ lý do, mục đích sử dụng, ưu tiên..."></textarea>
      </div>
      <div class="field">
        <label>Upload file đề xuất (PDF — tùy chọn, có thể bổ sung sau)</label>
        <input type="file" id="formFile" accept=".pdf" />
        <div class="text-faint" style="font-size:12px;margin-top:4px;">
          Nếu upload PDF, hệ thống sẽ chèn chữ ký của từng cấp duyệt vào đúng file này.
        </div>
      </div>
    `;
    const footer = `
      <button class="btn btn-secondary" id="cancelForm">Hủy</button>
      <button class="btn btn-primary" id="submitForm">Gửi biểu mẫu</button>
    `;
    UI.openModal(`${tpl.icon} Tạo: ${tpl.name}`, body, footer);
    document.getElementById('cancelForm').addEventListener('click', UI.closeModal);
    document.getElementById('submitForm').addEventListener('click', () => submitForm(tpl, user, centers));
  }

  async function submitForm(tpl, user, centers) {
    const title = document.getElementById('formTitle').value.trim();
    const description = document.getElementById('formDescription').value.trim();
    if (!title || !description) { UI.toast('Vui lòng nhập tiêu đề và mô tả.', 'error'); return; }

    // Thu thập dynamic fields
    const data = { description };
    (tpl.fields || []).forEach((f) => {
      const el = document.getElementById(`field_${f.key}`);
      if (el) data[f.key] = el.value;
    });

    // Upload file PDF gốc nếu có
    let originalFileUrl = null;
    let currentFileUrl = null;
    const file = document.getElementById('formFile')?.files[0];
    if (file) {
      try {
        const up = await DB.uploadFile(file, `forms/${tpl.code}`);
        originalFileUrl = up.url;
        currentFileUrl = up.url;
      } catch (e) { UI.toast('Lỗi upload file: ' + e.message, 'error'); return; }
    }

    const id = DB.genId('FRM');
    const submission = {
      id, title, data,
      templateCode: tpl.code,
      center: document.getElementById('formCenter').value || user.center || null,
      requestedBy: user.id,
      status: 'pending_review',
      originalFileUrl, currentFileUrl,
      signatures: [],
      history: [{ step: 'created', by: user.id, at: new Date().toISOString(), note: 'Tạo biểu mẫu' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const ok = await DB.set(`form_submissions:${id}`, submission);
    if (!ok) { UI.toast('Lỗi gửi biểu mẫu. Kiểm tra Console (F12).', 'error'); return; }

    // Nếu là invoice_payment: tạo thêm vendor_invoice đi kèm
    if (tpl.code === 'invoice_payment') {
      const vendorName = document.getElementById('inv_vendor_name')?.value.trim();
      if (vendorName) {
        let invoiceFileUrl = null;
        const invFile = document.getElementById('inv_invoice_file')?.files[0];
        if (invFile) {
          try {
            const up = await DB.uploadFile(invFile, 'invoices');
            invoiceFileUrl = up.url;
          } catch {}
        }
        const invId = DB.genId('INV');
        await DB.set(`vendor_invoices:${invId}`, {
          id: invId,
          submissionId: id,
          vendorName,
          vendorTaxCode: document.getElementById('inv_vendor_tax_code')?.value.trim(),
          invoiceNumber: document.getElementById('inv_invoice_number')?.value.trim(),
          invoiceDate:   document.getElementById('inv_invoice_date')?.value || null,
          amount:        Number(document.getElementById('inv_amount')?.value) || 0,
          description:   document.getElementById('inv_description')?.value.trim(),
          invoiceFileUrl,
          status: 'pending',
          requestedBy: user.id,
          createdAt: new Date().toISOString(),
        });
      }
    }

    UI.closeModal();
    UI.toast('Đã gửi biểu mẫu, chờ tiếp nhận.', 'success');
    App.refreshCurrent();
  }

  // ─── Xem chi tiết & duyệt ────────────────────────────────────────────────

  async function openDetailModal(id, user, isBGD, isDeptHead, templates) {
    const f = await DB.get(`form_submissions:${id}`);
    if (!f) return;
    const tpl = templates.find((t) => t.code === f.templateCode);
    const users = await DB.getTable('users:');
    const creator = users.find((u) => u.id === f.requestedBy);
    const centers = (await DB.get('meta:centers')) || [];
    const centerName = f.center ? (centers.find((c) => c.id === f.center)?.name || f.center) : '—';

    const canSign = f.currentFileUrl && (isBGD || (isDeptHead && f.status === 'pending_review'));
    const canApproveStep1 = isDeptHead && f.status === 'pending_review' && canHandleTemplate(user, f.templateCode, templates);
    const canApproveBGD = isBGD && f.status === 'pending_bgd';
    const canRevise = f.status === 'needs_revision' && f.requestedBy === user.id;
    const needsSeal = tpl?.requiresSeal && isBGD;

    // Thông tin hóa đơn đi kèm nếu có
    let invoiceHtml = '';
    if (f.templateCode === 'invoice_payment') {
      const allInvoices = await DB.getTable('vendor_invoices:');
      const invoice = allInvoices.find((inv) => inv.submissionId === f.id);
      if (invoice) {
        invoiceHtml = `
          <div class="card mb-md" style="background:#f0fdf4;border:1px solid #86efac;">
            <div class="card-title" style="font-size:13px;">📄 Hóa đơn doanh nghiệp</div>
            <table style="width:100%;">
              <tr><td class="text-faint" style="width:160px;">Đơn vị</td><td><strong>${UI.escapeHtml(invoice.vendorName)}</strong></td></tr>
              ${invoice.vendorTaxCode ? `<tr><td class="text-faint">MST</td><td>${UI.escapeHtml(invoice.vendorTaxCode)}</td></tr>` : ''}
              ${invoice.invoiceNumber ? `<tr><td class="text-faint">Số hóa đơn</td><td>${UI.escapeHtml(invoice.invoiceNumber)}</td></tr>` : ''}
              ${invoice.invoiceDate ? `<tr><td class="text-faint">Ngày HĐ</td><td>${UI.formatDate(invoice.invoiceDate)}</td></tr>` : ''}
              <tr><td class="text-faint">Số tiền</td><td><strong style="color:var(--color-primary);">${UI.formatMoney(invoice.amount)}</strong></td></tr>
              ${invoice.description ? `<tr><td class="text-faint">Nội dung</td><td>${UI.escapeHtml(invoice.description)}</td></tr>` : ''}
              ${invoice.invoiceFileUrl ? `<tr><td class="text-faint">Hóa đơn</td><td><a href="${invoice.invoiceFileUrl}" target="_blank" class="attachment-chip">📎 Xem hóa đơn</a></td></tr>` : ''}
              <tr><td class="text-faint">Trạng thái</td><td>${UI.statusBadge(invoice.status)}</td></tr>
            </table>
          </div>`;
      }
    }

    const body = `
      <div class="mb-md">
        <div class="text-faint mono" style="font-size:11px;">${f.id}</div>
        <h3 style="margin-top:4px;">${UI.escapeHtml(f.title)}</h3>
      </div>
      <div class="flex-row gap-sm mb-md">
        ${formStatusBadge(f.status)}
        <span class="text-faint" style="font-size:12.5px;">
          ${tpl ? `${tpl.icon} ${tpl.name}` : ''} · ${creator?.name || '—'} · ${UI.formatDate(f.createdAt)}
        </span>
        ${f.center ? `<span class="badge badge-default">🏢 ${centerName}</span>` : ''}
      </div>

      <div class="card" style="background:var(--color-bg);margin-bottom:14px;">
        <div style="font-size:13.5px;line-height:1.7;">${UI.escapeHtml(f.data?.description || '')}</div>
        ${Object.entries(f.data || {}).filter(([k]) => k !== 'description').map(([k, v]) =>
          v ? `<div style="margin-top:6px;font-size:13px;"><span class="text-faint">${k}:</span> ${UI.escapeHtml(String(v))}</div>` : ''
        ).join('')}
      </div>

      ${invoiceHtml}

      <!-- File PDF hiện tại -->
      <div class="card mb-md" style="background:var(--color-bg);">
        <div class="card-title" style="font-size:13px;">📎 File biểu mẫu</div>
        ${f.currentFileUrl
          ? `<a href="${f.currentFileUrl}" target="_blank" class="attachment-chip">📄 Xem file hiện tại (${f.signatures?.length ? `đã ký ${f.signatures.length} cấp` : 'chưa có chữ ký'})</a>`
          : '<span class="text-faint" style="font-size:12.5px;">Chưa có file PDF đính kèm</span>'}
        ${f.originalFileUrl && f.originalFileUrl !== f.currentFileUrl
          ? `<a href="${f.originalFileUrl}" target="_blank" class="attachment-chip" style="margin-left:8px;opacity:0.7;">📄 File gốc ban đầu</a>` : ''}
        ${canRevise ? `
          <div class="field mt-md">
            <label>Cập nhật file mới (thay thế bản bị yêu cầu chỉnh sửa)</label>
            <input type="file" id="reviseFile" accept=".pdf" />
          </div>` : ''}
      </div>

      <!-- Chữ ký của các cấp đã ký -->
      ${f.signatures?.length ? `
        <div class="card mb-md" style="background:var(--color-bg);">
          <div class="card-title" style="font-size:13px;">✍️ Chữ ký đã có</div>
          ${f.signatures.map((s) => {
            const signer = users.find((u) => u.id === s.by);
            return `<div style="font-size:12.5px;margin-bottom:4px;">
              ✓ <strong>${signer?.name || s.by}</strong> (${ROLE_LABELS[s.role] || s.role}) · ${UI.formatDateTime(s.signedAt)}
              ${s.note ? ` — ${UI.escapeHtml(s.note)}` : ''}
            </div>`;
          }).join('')}
        </div>` : ''}

      <!-- Ô thêm chữ ký (nếu đủ quyền) -->
      ${canSign ? `
        <div class="card mb-md" style="border:1px dashed var(--color-primary);">
          <div class="card-title" style="font-size:13px;">✍️ Thêm chữ ký của bạn</div>
          ${await buildSignatureInput(user, needsSeal)}
        </div>` : ''}

      <!-- Ghi chú duyệt -->
      ${(canApproveStep1 || canApproveBGD) ? `
        <div class="field">
          <label>Ghi chú (tùy chọn)</label>
          <textarea id="approveNote" placeholder="Ghi chú quyết định..."></textarea>
        </div>` : ''}

      <!-- Lịch sử -->
      <div class="section-head mt-md"><h3 style="font-size:14px;">Lịch sử xử lý</h3></div>
      <div class="timeline">
        ${(f.history || []).map((h) => `
          <div class="timeline-step ${h.step.includes('reject') || h.step.includes('revision') ? 'rejected' : 'done'}">
            <div class="timeline-dot">${h.step.includes('reject') ? '✕' : h.step.includes('revision') ? '↩' : '✓'}</div>
            <div class="timeline-title">${histLabel(h.step)}</div>
            <div class="timeline-meta">${users.find((u) => u.id === h.by)?.name || h.by} · ${UI.formatDateTime(h.at)}</div>
            ${h.note ? `<div class="timeline-note">${UI.escapeHtml(h.note)}</div>` : ''}
          </div>`).join('')}
      </div>
    `;

    // Footer theo quyền
    const footer = buildFooter(canApproveStep1, canApproveBGD, canRevise, canSign);
    UI.openModal(`${tpl?.icon || '📋'} ${tpl?.name || 'Chi tiết biểu mẫu'}`, body, footer);
    bindDetailEvents(f, user, tpl, isBGD, canApproveStep1, canApproveBGD, canRevise, canSign, needsSeal);
  }

  async function buildSignatureInput(user, needsSeal) {
    const seals = needsSeal ? await DB.getTable('company_seals:') : [];
    const activeSeal = seals.find((s) => s.isActive);
    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div class="field">
          <label>Ảnh chữ ký của bạn</label>
          ${user.signatureUrl
            ? `<img src="${user.signatureUrl}" style="height:48px;object-fit:contain;border:1px solid var(--color-border);border-radius:6px;padding:4px;" />`
            : '<span class="text-faint" style="font-size:12px;">Chưa có — upload trong "Hồ sơ cá nhân"</span>'}
          <div class="text-faint" style="font-size:11px;margin-top:2px;">Dùng ảnh PNG nền trong suốt để đẹp hơn</div>
        </div>
        ${needsSeal ? `
          <div class="field">
            <label>Mộc công ty (BGD)</label>
            ${activeSeal
              ? `<img src="${activeSeal.sealUrl}" style="height:48px;object-fit:contain;border:1px solid var(--color-border);border-radius:6px;padding:4px;" />`
              : '<span class="text-faint" style="font-size:12px;">Chưa có mộc — vào cài đặt để upload</span>'}
          </div>` : ''}
      </div>
      <div class="field">
        <label>Ghi chú kèm chữ ký (tùy chọn)</label>
        <input type="text" id="signNote" placeholder="VD: Đã xem xét và đồng ý" />
      </div>
    `;
  }

  function buildFooter(canApproveStep1, canApproveBGD, canRevise, canSign) {
    const buttons = [`<button class="btn btn-secondary" id="closeDetail">Đóng</button>`];
    if (canSign) buttons.push(`<button class="btn btn-secondary" id="btnSign">✍️ Ký vào file</button>`);
    if (canApproveStep1) {
      buttons.push(`<button class="btn btn-danger" id="btnReject1">Từ chối</button>`);
      buttons.push(`<button class="btn btn-primary" id="btnApprove1">Tiếp nhận → gửi BGD</button>`);
    }
    if (canApproveBGD) {
      buttons.push(`<button class="btn btn-danger" id="btnRejectBGD">Từ chối</button>`);
      buttons.push(`<button class="btn btn-secondary" id="btnRevise">Yêu cầu chỉnh sửa</button>`);
      buttons.push(`<button class="btn btn-primary" id="btnApproveBGD">✅ Phê duyệt & Ban hành</button>`);
    }
    if (canRevise) buttons.push(`<button class="btn btn-primary" id="btnSubmitRevise">Gửi lại file đã sửa</button>`);
    return buttons.join('');
  }

  function bindDetailEvents(f, user, tpl, isBGD, canApproveStep1, canApproveBGD, canRevise, canSign, needsSeal) {
    document.getElementById('closeDetail')?.addEventListener('click', UI.closeModal);

    // Ký vào file
    if (canSign) {
      document.getElementById('btnSign')?.addEventListener('click', async () => {
        if (!f.currentFileUrl) { UI.toast('Chưa có file PDF để ký.', 'error'); return; }
        if (!user.signatureUrl) { UI.toast('Bạn chưa upload ảnh chữ ký. Vào "Hồ sơ cá nhân" để thêm.', 'error'); return; }

        const btn = document.getElementById('btnSign');
        btn.disabled = true; btn.textContent = 'Đang xử lý...';

        try {
          // Chèn chữ ký vào PDF
          let signedUrl = await PdfSign.signAndUpload(
            f.currentFileUrl, user.signatureUrl, `signed/${f.templateCode}`,
            { x: undefined, y: undefined } // vị trí mặc định (góc dưới phải)
          );

          // Nếu là BGD và có mộc → chèn mộc tiếp theo
          if (needsSeal) {
            const seals = await DB.getTable('company_seals:');
            const seal = seals.find((s) => s.isActive);
            if (seal) {
              signedUrl = await PdfSign.signAndUpload(
                signedUrl, seal.sealUrl, `signed/${f.templateCode}`,
                { x: 60, y: 80, width: 80, height: 80 } // góc dưới trái cho mộc
              );
            }
          }

          const note = document.getElementById('signNote')?.value.trim();
          f.currentFileUrl = signedUrl;
          f.signatures = [...(f.signatures || []), {
            by: user.id, role: user.role, signedAt: new Date().toISOString(), note,
          }];
          f.history.push({ step: 'signed', by: user.id, at: new Date().toISOString(), note: note || 'Đã ký chữ ký số' });

          const ok = await DB.set(`form_submissions:${f.id}`, f);
          if (!ok) { UI.toast('Lỗi lưu chữ ký. Kiểm tra Console.', 'error'); return; }
          UI.closeModal();
          UI.toast('Đã ký vào file thành công. File được cập nhật.', 'success');
          App.refreshCurrent();
        } catch (e) {
          UI.toast('Lỗi xử lý chữ ký: ' + e.message, 'error');
          btn.disabled = false; btn.textContent = '✍️ Ký vào file';
        }
      });
    }

    // Duyệt cấp 1 (trưởng phòng)
    if (canApproveStep1) {
      document.getElementById('btnApprove1')?.addEventListener('click', async () => {
        const note = document.getElementById('approveNote')?.value.trim();
        f.status = 'pending_bgd';
        f.history.push({ step: 'step1_approved', by: user.id, at: new Date().toISOString(), note });
        const ok = await DB.set(`form_submissions:${f.id}`, f);
        if (!ok) { UI.toast('Lỗi cập nhật. Kiểm tra Console.', 'error'); return; }
        UI.closeModal();
        UI.toast('Đã tiếp nhận, chuyển lên Ban Giám đốc.', 'success');
        App.refreshCurrent();
      });
      document.getElementById('btnReject1')?.addEventListener('click', async () => {
        const note = document.getElementById('approveNote')?.value.trim();
        f.status = 'rejected';
        f.history.push({ step: 'step1_rejected', by: user.id, at: new Date().toISOString(), note });
        const ok = await DB.set(`form_submissions:${f.id}`, f);
        if (!ok) { UI.toast('Lỗi cập nhật.', 'error'); return; }
        UI.closeModal();
        UI.toast('Đã từ chối biểu mẫu.', 'error');
        App.refreshCurrent();
      });
    }

    // Duyệt cấp BGD
    if (canApproveBGD) {
      document.getElementById('btnApproveBGD')?.addEventListener('click', async () => {
        const note = document.getElementById('approveNote')?.value.trim();
        f.status = 'approved';
        f.history.push({ step: 'bgd_approved', by: user.id, at: new Date().toISOString(), note: note || 'BGD phê duyệt' });
        const ok = await DB.set(`form_submissions:${f.id}`, f);
        if (!ok) { UI.toast('Lỗi cập nhật.', 'error'); return; }

        // Nếu là invoice_payment → cập nhật trạng thái vendor_invoice thành paid
        if (f.templateCode === 'invoice_payment') {
          const allInvoices = await DB.getTable('vendor_invoices:');
          const inv = allInvoices.find((i) => i.submissionId === f.id);
          if (inv) {
            inv.status = 'paid'; inv.paidAt = new Date().toISOString();
            await DB.set(`vendor_invoices:${inv.id}`, inv);
          }
        }

        // Ban hành thông báo đến đúng trung tâm hoặc người tạo
        await broadcastApproval(f, user, note);

        UI.closeModal();
        UI.toast('Đã phê duyệt và ban hành thông báo.', 'success');
        App.refreshCurrent();
      });

      document.getElementById('btnRejectBGD')?.addEventListener('click', async () => {
        const note = document.getElementById('approveNote')?.value.trim();
        f.status = 'rejected';
        f.history.push({ step: 'bgd_rejected', by: user.id, at: new Date().toISOString(), note });
        const ok = await DB.set(`form_submissions:${f.id}`, f);
        if (!ok) { UI.toast('Lỗi cập nhật.', 'error'); return; }
        UI.closeModal();
        UI.toast('Đã từ chối.', 'error');
        App.refreshCurrent();
      });

      document.getElementById('btnRevise')?.addEventListener('click', async () => {
        const note = document.getElementById('approveNote')?.value.trim();
        f.status = 'needs_revision';
        f.history.push({ step: 'revision_requested', by: user.id, at: new Date().toISOString(), note: note || 'BGD yêu cầu chỉnh sửa' });
        const ok = await DB.set(`form_submissions:${f.id}`, f);
        if (!ok) { UI.toast('Lỗi cập nhật.', 'error'); return; }
        UI.closeModal();
        UI.toast('Đã yêu cầu người tạo chỉnh sửa lại.', 'success');
        App.refreshCurrent();
      });
    }

    // Người tạo gửi lại file sau khi chỉnh sửa
    if (canRevise) {
      document.getElementById('btnSubmitRevise')?.addEventListener('click', async () => {
        const file = document.getElementById('reviseFile')?.files[0];
        if (!file) { UI.toast('Vui lòng chọn file PDF mới.', 'error'); return; }
        try {
          const up = await DB.uploadFile(file, `forms/${f.templateCode}`);
          f.currentFileUrl = up.url;
          f.originalFileUrl = up.url;
          f.signatures = []; // reset chữ ký vì file mới
          f.status = 'pending_review';
          f.history.push({ step: 'revised', by: user.id, at: new Date().toISOString(), note: 'Đã cập nhật file theo yêu cầu chỉnh sửa' });
          const ok = await DB.set(`form_submissions:${f.id}`, f);
          if (!ok) { UI.toast('Lỗi lưu file.', 'error'); return; }
          UI.closeModal();
          UI.toast('Đã gửi lại file chỉnh sửa, chờ tiếp nhận lại.', 'success');
          App.refreshCurrent();
        } catch (e) { UI.toast('Lỗi upload: ' + e.message, 'error'); }
      });
    }
  }

  // ─── Ban hành thông báo sau khi BGD duyệt ────────────────────────────────

  async function broadcastApproval(f, approver, note) {
    const id = DB.genId('NTF');
    const scope = f.center ? `center:${f.center}` : `user:${f.requestedBy}`;
    const labelMap = {
      facility_request: 'Yêu cầu cơ sở vật chất',
      invoice_payment:  'Yêu cầu thanh toán hóa đơn',
      event_plan:       'Kế hoạch tổ chức sự kiện',
    };
    const label = labelMap[f.templateCode] || 'Biểu mẫu';
    await DB.set(`notifications:${id}`, {
      id,
      title: `✅ ${label} đã được phê duyệt`,
      body: `"${f.title}" đã được Ban Giám đốc phê duyệt.${note ? ` Ghi chú: ${note}` : ''} Xem file tại module Biểu mẫu.`,
      scope,
      createdBy: approver.id,
      readBy: [],
      scheduled: false,
      createdAt: new Date().toISOString(),
    });
  }

  function histLabel(step) {
    const m = {
      created:           'Tạo biểu mẫu',
      signed:            'Ký chữ ký số',
      step1_approved:    'Trưởng phòng tiếp nhận → gửi BGD',
      step1_rejected:    'Trưởng phòng từ chối',
      bgd_approved:      'Ban Giám đốc phê duyệt',
      bgd_rejected:      'Ban Giám đốc từ chối',
      revision_requested:'BGD yêu cầu chỉnh sửa',
      revised:           'Người tạo cập nhật lại file',
    };
    return m[step] || step;
  }

  return { render };
})();
