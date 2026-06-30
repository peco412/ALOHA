/**
 * data/permissions.js — Supabase Edition
 * Ma trận phân quyền theo yêu cầu mới:
 *
 * Toàn quyền: admin, exec (TGD/PGD), dept_head (Trưởng phòng Nhân sự)
 * Trưởng phòng ban / Quản lý TT: KHÔNG xem/duyệt của nhau, chỉ xem tiến độ đề xuất mình tạo
 * Giáo viên / staff: tạo yêu cầu tại phòng ban bất kỳ, theo dõi tiến độ;
 *                    tại phòng ban của mình: nhận phân công + nộp kết quả
 * Trưởng phòng: phân công công việc (kể cả bản thân để đảm bảo tiến độ)
 * Quản lý TT: module phân lịch tuần
 */

const ROLES = {
  ADMIN:          'admin',
  EXEC:           'exec',           // TGD, PGD — Ban Điều hành
  DEPT_HEAD:      'dept_head',      // Trưởng phòng (Nhân sự, Kế toán, Marketing)
  CENTER_MANAGER: 'center_manager', // Quản lý trung tâm
  TEACHER:        'teacher',
  STAFF:          'staff',          // Nhân viên kế toán, marketing, nhân sự, tư vấn
};

const ROLE_LABELS = {
  [ROLES.ADMIN]:          'Quản trị hệ thống',
  [ROLES.EXEC]:           'Ban Điều hành (TGD/PGD)',
  [ROLES.DEPT_HEAD]:      'Trưởng phòng ban',
  [ROLES.CENTER_MANAGER]: 'Quản lý trung tâm',
  [ROLES.TEACHER]:        'Giáo viên',
  [ROLES.STAFF]:          'Nhân viên',
};

const MODULES = {
  NOTIFICATIONS: 'notifications',
  PROFILE:       'profile',
  TEACHER:       'teacher',
  CENTER:        'center',
  MARKETING:     'marketing',
  ACCOUNTING:    'accounting',
  HR:            'hr',
  OPERATIONS:    'operations',
};

const MODULE_META = {
  [MODULES.NOTIFICATIONS]: { label: 'Thông báo',            icon: '🔔' },
  [MODULES.PROFILE]:       { label: 'Hồ sơ cá nhân',        icon: '👤' },
  [MODULES.TEACHER]:       { label: 'Giáo viên',             icon: '📚' },
  [MODULES.CENTER]:        { label: 'Quản lý Trung tâm',     icon: '🏢' },
  [MODULES.MARKETING]:     { label: 'Marketing',             icon: '📣' },
  [MODULES.ACCOUNTING]:    { label: 'Kế toán',               icon: '💰' },
  [MODULES.HR]:            { label: 'Nhân sự',               icon: '🧑‍💼' },
  [MODULES.OPERATIONS]:    { label: 'Trung tâm Điều hành',   icon: '🛡️' },
};

/**
 * Module nào hiển thị cho vai trò nào.
 * Tất cả vai trò đều thấy module của phòng ban khác để tạo yêu cầu + theo dõi.
 * (Việc lọc dữ liệu — ai xem được gì trong mỗi module — xử lý trong từng module.)
 */
const ROLE_MODULES = {
  [ROLES.ADMIN]: Object.values(MODULES),

  [ROLES.EXEC]: [
    MODULES.NOTIFICATIONS, MODULES.PROFILE,
    MODULES.CENTER, MODULES.MARKETING, MODULES.ACCOUNTING, MODULES.HR,
    MODULES.OPERATIONS,
  ],

  // Trưởng phòng Nhân sự thấy cả Center để nhập nhân viên mới
  [ROLES.DEPT_HEAD]: [
    MODULES.NOTIFICATIONS, MODULES.PROFILE,
    MODULES.CENTER, MODULES.MARKETING, MODULES.ACCOUNTING, MODULES.HR,
  ],

  // Quản lý trung tâm thấy Center (phân lịch, lớp, học viên) + các phòng ban để gửi yêu cầu
  [ROLES.CENTER_MANAGER]: [
    MODULES.NOTIFICATIONS, MODULES.PROFILE,
    MODULES.CENTER, MODULES.MARKETING, MODULES.ACCOUNTING, MODULES.HR,
  ],

  // Giáo viên & staff đều thấy tất cả module để tạo yêu cầu + theo dõi
  [ROLES.TEACHER]: [
    MODULES.NOTIFICATIONS, MODULES.PROFILE, MODULES.TEACHER,
    MODULES.CENTER, MODULES.MARKETING, MODULES.ACCOUNTING, MODULES.HR,
  ],

  [ROLES.STAFF]: [
    MODULES.NOTIFICATIONS, MODULES.PROFILE,
    MODULES.CENTER, MODULES.MARKETING, MODULES.ACCOUNTING, MODULES.HR,
  ],
};

/** Ai được duyệt cấp 1 (trưởng phòng / quản lý trung tâm của module đó) */
const CAN_APPROVE_LEVEL1 = [ROLES.DEPT_HEAD, ROLES.CENTER_MANAGER, ROLES.ADMIN];

/** Ai được duyệt cấp 2 (Ban Điều hành) */
const CAN_APPROVE_LEVEL2 = [ROLES.EXEC, ROLES.ADMIN];

function getModulesForRole(role) {
  return ROLE_MODULES[role] || [];
}

function canApproveLevel1(role) {
  return CAN_APPROVE_LEVEL1.includes(role);
}

function canApproveLevel2(role) {
  return CAN_APPROVE_LEVEL2.includes(role);
}

function isDeptOrCenterManager(role) {
  return [ROLES.DEPT_HEAD, ROLES.CENTER_MANAGER, ROLES.ADMIN, ROLES.EXEC].includes(role);
}

/**
 * Kiểm tra user có quyền duyệt tại module/phòng ban cụ thể không.
 * Trưởng phòng chỉ duyệt trong phòng ban của mình.
 * Quản lý TT chỉ duyệt trong TT của mình.
 */
function canManageInModule(user, moduleKey) {
  if (user.role === ROLES.ADMIN || user.role === ROLES.EXEC) return true;
  if (user.role === ROLES.DEPT_HEAD) {
    const deptModuleMap = {
      'Nhân sự':    MODULES.HR,
      'Kế toán':    MODULES.ACCOUNTING,
      'Marketing':  MODULES.MARKETING,
    };
    return deptModuleMap[user.dept] === moduleKey;
  }
  if (user.role === ROLES.CENTER_MANAGER) {
    return moduleKey === MODULES.CENTER;
  }
  return false;
}
