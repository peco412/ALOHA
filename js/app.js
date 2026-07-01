/**
 * app.js
 * Điều khiển chính của dashboard: khởi tạo session, dựng sidebar theo vai trò,
 * điều hướng (router) giữa các module. Đây là "nhạc trưởng" — không chứa
 * logic nghiệp vụ, chỉ gọi sang các module trong js/modules/*.
 */

const App = (() => {
  let activeModule = null;
  let activeCenterFilter = null; // dùng cho Admin/Exec khi xem theo từng trung tâm

  const MODULE_RENDERERS = {
    [MODULES.NOTIFICATIONS]: (root) => NotificationsModule.render(root),
    [MODULES.PROFILE]:       (root) => ProfileModule.render(root),
    [MODULES.TEACHER]:       (root) => TeacherModule.render(root),
    [MODULES.CENTER]:        (root) => CenterModule.render(root),
    [MODULES.MARKETING]:     (root) => MarketingModule.render(root),
    [MODULES.ACCOUNTING]:    (root) => AccountingModule.render(root),
    [MODULES.HR]:            (root) => HRModule.render(root),
    [MODULES.OPERATIONS]:    (root) => OperationsModule.render(root),
    [MODULES.FORMS]:         (root) => FormsModule.render(root),
    [MODULES.ATTENDANCE]:    (root) => AttendanceModule.render(root),
    [MODULES.WORKSCHEDULE]:  (root) => WorkScheduleModule.render(root),
    [MODULES.MEETINGS]:      (root) => MeetingsModule.render(root),
  };

  async function init() {
    await seedIfNeeded();

    // Session lưu trong sessionStorage (auth.js tự phục hồi khi load lại trang)
    if (!Auth.isLoggedIn()) {
      window.location.href = 'index.html';
      return;
    }

    const user = Auth.getCurrentUser();

    document.getElementById('appShell').style.display = 'flex';
    renderSidebar(user);
    renderUserBadge(user);
    setupCenterSwitcher(user);

    document.getElementById('logoutBtn').addEventListener('click', () => {
      Auth.logout();
      window.location.href = 'index.html';
    });

    // Mở module đầu tiên hợp lệ theo vai trò, hoặc theo hash trên URL
    const allowedModules = getModulesForRole(user.role);
    const hashModule = window.location.hash.replace('#', '');
    const startModule = allowedModules.includes(hashModule) ? hashModule : allowedModules[0];
    navigateTo(startModule);

    // Kiểm tra sinh nhật hôm nay sau khi app đã load xong
    setTimeout(() => Birthday.checkAndShow(), 2000);
  }

  function renderSidebar(user) {
    const nav = document.getElementById('sidebarNav');
    const allowedModules = getModulesForRole(user.role);
    nav.innerHTML = allowedModules.map((modKey) => {
      const meta = MODULE_META[modKey];
      return `<div class="nav-item" data-module="${modKey}" id="nav-${modKey}">
        <span class="icon">${meta.icon}</span>
        <span>${meta.label}</span>
        <span class="nav-badge" id="badge-${modKey}" style="display:none;"></span>
      </div>`;
    }).join('');

    nav.querySelectorAll('.nav-item').forEach((el) => {
      el.addEventListener('click', () => navigateTo(el.dataset.module));
    });

    refreshBadges(allowedModules);
  }

  // Hiển thị số lượng "việc cần xử lý" trên sidebar — giúp người dùng biết module nào đang chờ họ
  async function refreshBadges(allowedModules) {
    const user = Auth.getCurrentUser();
    if (!user) return;

    if (allowedModules.includes(MODULES.OPERATIONS)) {
      const proposals = await DB.getTable('proposals:');
      const count = proposals.filter((p) => p.status === 'pending_level2').length;
      setBadge(MODULES.OPERATIONS, count);
    }
    if (allowedModules.includes(MODULES.CENTER) && isDeptOrCenterManager(user.role)) {
      const proposals = await DB.getTable('proposals:');
      const count = proposals.filter((p) => p.status === 'pending_level1' && p.module === 'center' && (user.role === ROLES.ADMIN || p.center === user.center)).length;
      setBadge(MODULES.CENTER, count);
    }
    if (allowedModules.includes(MODULES.HR)) {
      const forms = await DB.getTable('hr_forms:');
      const proposals = await DB.getTable('proposals:');
      const count = forms.filter((f) => f.status === 'pending').length + proposals.filter((p) => p.module === 'hr' && p.status === 'pending_level1').length;
      setBadge(MODULES.HR, isDeptOrCenterManager(user.role) ? count : 0);
    }
    if (allowedModules.includes(MODULES.ACCOUNTING)) {
      const forms = await DB.getTable('acc_forms:');
      setBadge(MODULES.ACCOUNTING, isDeptOrCenterManager(user.role) ? forms.filter((f) => f.status === 'pending').length : 0);
    }
    if (allowedModules.includes(MODULES.MARKETING)) {
      const reqs = await DB.getTable('mkt_requests:');
      setBadge(MODULES.MARKETING, isDeptOrCenterManager(user.role) ? reqs.filter((r) => r.status === 'pending').length : 0);
    }
  }

  function setBadge(modKey, count) {
    const el = document.getElementById(`badge-${modKey}`);
    if (!el) return;
    if (count > 0) { el.textContent = count; el.style.display = 'inline-block'; }
    else { el.style.display = 'none'; }
  }

  function renderUserBadge(user) {
    document.getElementById('userAvatar').textContent = UI.userInitials(user.name);
    document.getElementById('userName').textContent = user.name;
    document.getElementById('userRole').textContent = ROLE_LABELS[user.role];
  }

  async function setupCenterSwitcher(user) {
    const wrap = document.getElementById('centerSwitcherWrap');
    const select = document.getElementById('centerSwitcher');
    // Chỉ Admin/Exec mới cần chọn xem theo trung tâm nào; Quản lý trung tâm bị khóa vào trung tâm của họ
    if (user.role === ROLES.ADMIN || user.role === ROLES.EXEC) {
      const centers = (await DB.get('meta:centers')) || [];
      select.innerHTML = `<option value="">Tất cả trung tâm</option>` +
        centers.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
      select.addEventListener('change', () => {
        activeCenterFilter = select.value || null;
        if (activeModule === MODULES.CENTER) navigateTo(MODULES.CENTER);
      });
      wrap.style.display = 'block';
    } else {
      wrap.style.display = 'none';
      activeCenterFilter = user.center || null;
    }
  }

  function getCenterFilter() {
    const user = Auth.getCurrentUser();
    if (user.role === ROLES.CENTER_MANAGER) return user.center;
    return activeCenterFilter;
  }

  function navigateTo(modKey) {
    activeModule = modKey;
    window.location.hash = modKey;

    document.querySelectorAll('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.module === modKey));
    document.getElementById('pageTitle').textContent = MODULE_META[modKey].label;
    document.getElementById('breadcrumb').textContent = `ALOHA ERP / ${MODULE_META[modKey].label}`;

    const content = document.getElementById('content');
    content.innerHTML = '<div class="empty-state"><div class="glyph">⏳</div><div class="msg">Đang tải...</div></div>';

    const renderer = MODULE_RENDERERS[modKey];
    if (renderer) renderer(content);

    // Cập nhật lại badge sau mỗi lần điều hướng (vì có thể vừa duyệt/xử lý xong)
    refreshBadges(getModulesForRole(Auth.getCurrentUser().role));
  }

  function refreshCurrent() {
    if (activeModule) navigateTo(activeModule);
  }

  return { init, navigateTo, refreshCurrent, getCenterFilter };
})();

document.addEventListener('DOMContentLoaded', App.init);
