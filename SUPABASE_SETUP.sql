-- ============================================================
-- ALOHA ERP — Supabase Setup SQL (bản đầy đủ, đã đồng bộ với code)
-- Chạy toàn bộ file này trong SQL Editor của Supabase Dashboard
-- An toàn để chạy lại nhiều lần (dùng "if not exists" / "on conflict")
-- ============================================================

-- 1. Bảng users (nhân viên / giáo viên)
create table if not exists public.users (
  id text primary key,
  username text unique not null,
  password_hash text not null,        -- bcrypt hash, KHÔNG lưu plaintext (demo dùng plaintext)
  name text not null,
  role text not null,                 -- admin | exec | dept_head | center_manager | teacher | staff
  position text,
  dept text,
  center text,                        -- null = văn phòng trung tâm / phòng ban
  phone text,
  email text,
  avatar_url text,
  hire_date date,
  contract_type text default 'fulltime',
  id_number text,
  address text,
  note text,
  employment_status text default 'active', -- active | on_leave | suspended | terminated
  termination_date date,
  termination_note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. Bảng classes (lớp học)
create table if not exists public.classes (
  id text primary key,
  name text not null,
  center text not null,
  teacher_id text references public.users(id),
  status text default 'planning',     -- planning | active | closed
  size integer default 0,
  schedule text,
  level text,
  start_date date,
  end_date date,
  note text,
  created_by text references public.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 3. Bảng students (học viên)
create table if not exists public.students (
  id text primary key,
  name text not null,
  center text not null,
  class_id text references public.classes(id),
  course text,
  status text default 'lead',         -- lead | studying | graduated | dropped
  dob date,
  parent_name text,
  phone text,
  email text,
  address text,
  note text,
  enrolled_at date,
  contract_url text,
  created_by text references public.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 4. Bảng proposals (đề xuất kế hoạch — dùng chung cho mọi phân hệ)
create table if not exists public.proposals (
  id text primary key,
  title text not null,
  description text,
  type text,                          -- center_plan | hr_plan | marketing_plan | ...
  module text not null,               -- center | hr | marketing | accounting
  center text,
  created_by text references public.users(id),
  status text default 'pending_level1',
  attachments jsonb default '[]',
  history jsonb default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 5. Bảng hr_forms (đơn nghỉ phép / công tác)
create table if not exists public.hr_forms (
  id text primary key,
  type text not null,                 -- leave | business_trip | other
  title text,
  detail text,
  requested_by text references public.users(id),
  assigned_to text references public.users(id),
  status text default 'pending',      -- pending | in_progress | approved | rejected
  note text,
  attachment_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 6. Bảng mkt_requests (yêu cầu hỗ trợ Marketing)
create table if not exists public.mkt_requests (
  id text primary key,
  title text not null,
  category text,
  requested_by text references public.users(id),
  center text,
  priority text default 'medium',
  deadline date,
  status text default 'pending',
  assigned_to text references public.users(id),
  result text,
  attachment_url text,
  result_file_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 7. Bảng acc_forms (đơn thanh toán / tạm ứng)
create table if not exists public.acc_forms (
  id text primary key,
  type text not null,                 -- payment | advance
  title text not null,
  amount bigint default 0,
  requested_by text references public.users(id),
  assigned_to text references public.users(id),
  status text default 'pending',
  note text,
  attachment_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 8. Bảng notifications (thông báo)
create table if not exists public.notifications (
  id text primary key,
  title text not null,
  body text,
  scope text default 'all',           -- all | dept:X | center:X | user:id
  read_by jsonb default '[]'::jsonb,  -- mảng user_id đã đọc (đơn giản hóa, demo)
  scheduled boolean default false,
  created_by text references public.users(id),
  scheduled_at timestamptz,
  created_at timestamptz default now()
);

-- 9. Bảng notification_reads (trạng thái đã đọc — dự phòng cho nâng cấp sau)
create table if not exists public.notification_reads (
  user_id text references public.users(id),
  notification_id text references public.notifications(id),
  read_at timestamptz default now(),
  primary key (user_id, notification_id)
);

-- 10. Bảng centers (trung tâm)
create table if not exists public.centers (
  id text primary key,
  name text not null,
  address text,
  phone text,
  manager_id text references public.users(id)
);

-- 11. Bảng weekly_schedule (phân lịch tuần cho quản lý trung tâm)
create table if not exists public.weekly_schedule (
  id text primary key,
  center text not null,
  week_start date not null,           -- Thứ 2 đầu tuần
  class_id text references public.classes(id),
  day_of_week integer not null,       -- 1=T2 ... 7=CN
  time_slot text,                     -- VD: "17:30-19:00"
  teacher_id text references public.users(id),
  substitute_id text references public.users(id),  -- giáo viên dạy thay
  note text,
  created_by text references public.users(id),
  created_at timestamptz default now()
);

-- ============================================================
-- RLS (Row Level Security)
-- Tạm tắt để dev/demo dễ test. Bật lại + viết policy theo vai trò
-- trước khi triển khai chính thức ra ngoài Internet.
-- ============================================================
alter table public.users disable row level security;
alter table public.classes disable row level security;
alter table public.students disable row level security;
alter table public.proposals disable row level security;
alter table public.hr_forms disable row level security;
alter table public.mkt_requests disable row level security;
alter table public.acc_forms disable row level security;
alter table public.notifications disable row level security;
alter table public.notification_reads disable row level security;
alter table public.centers disable row level security;
alter table public.weekly_schedule disable row level security;

-- ============================================================
-- Storage Policy cho bucket "attachments"
-- LƯU Ý: phải tạo bucket "attachments" thủ công trước trong
-- Supabase Dashboard → Storage → New bucket → Public = ON
-- ============================================================
drop policy if exists "Public read access for attachments" on storage.objects;
drop policy if exists "Public upload access for attachments" on storage.objects;
drop policy if exists "Public update access for attachments" on storage.objects;
drop policy if exists "Public delete access for attachments" on storage.objects;

create policy "Public read access for attachments"
on storage.objects for select
using ( bucket_id = 'attachments' );

create policy "Public upload access for attachments"
on storage.objects for insert
with check ( bucket_id = 'attachments' );

create policy "Public update access for attachments"
on storage.objects for update
using ( bucket_id = 'attachments' );

create policy "Public delete access for attachments"
on storage.objects for delete
using ( bucket_id = 'attachments' );

-- ============================================================
-- Seed dữ liệu mẫu
-- Mật khẩu mẫu: '$2b$10$demo' — auth.js cho phép giá trị này đi qua
-- với BẤT KỲ mật khẩu nào khi đăng nhập (chỉ dùng để demo/test nội bộ).
-- ============================================================

insert into public.centers (id, name) values
  ('mocay',    'Mỏ Cày'),
  ('travinh',  'Trà Vinh'),
  ('caungang', 'Cầu Ngang'),
  ('canglong', 'Càng Long'),
  ('duyenhai', 'Duyên Hải'),
  ('mekong',   'MEKONG')
on conflict (id) do nothing;

insert into public.users (id, username, password_hash, name, role, position, dept, center, phone, email) values
  ('u_admin',      'admin',         '$2b$10$demo', 'Nguyễn Văn Admin',    'admin',          'Quản trị hệ thống',     'IT',        null,       '0900000001','admin@aloha.edu.vn'),
  ('u_exec',       'tgd',           '$2b$10$demo', 'Trần Thị Hồng',       'exec',           'Tổng Giám đốc',         'Ban Điều hành', null,    '0900000002','tgd@aloha.edu.vn'),
  ('u_pgd',        'pgd',           '$2b$10$demo', 'Lê Thanh Nam',        'exec',           'Phó Giám đốc',          'Ban Điều hành', null,    '0900000003','pgd@aloha.edu.vn'),
  ('u_hr_head',    'hr.truong',     '$2b$10$demo', 'Lê Minh Khoa',        'dept_head',      'Trưởng phòng Nhân sự',  'Nhân sự',   null,       '0900000004','khoa.le@aloha.edu.vn'),
  ('u_acc_head',   'acc.truong',    '$2b$10$demo', 'Phạm Thị Lan',        'dept_head',      'Trưởng phòng Kế toán',  'Kế toán',   null,       '0900000005','lan.pham@aloha.edu.vn'),
  ('u_mkt_head',   'mkt.truong',    '$2b$10$demo', 'Đỗ Anh Tuấn',         'dept_head',      'Trưởng phòng Marketing','Marketing', null,       '0900000006','tuan.do@aloha.edu.vn'),
  ('u_cm_travinh', 'qltt.travinh',  '$2b$10$demo', 'Huỳnh Thị Mai',       'center_manager', 'Quản lý trung tâm',     'Vận hành',  'travinh',  '0900000007','mai.huynh@aloha.edu.vn'),
  ('u_cm_mocay',   'qltt.mocay',    '$2b$10$demo', 'Võ Thành Long',       'center_manager', 'Quản lý trung tâm',     'Vận hành',  'mocay',    '0900000008','long.vo@aloha.edu.vn'),
  ('u_teacher_1',  'gv.thuy',       '$2b$10$demo', 'Nguyễn Thị Thúy',     'teacher',        'Giáo viên',             'Giảng dạy', 'travinh',  '0900000009','thuy.nguyen@aloha.edu.vn'),
  ('u_teacher_2',  'gv.binh',       '$2b$10$demo', 'Trần Văn Bình',       'teacher',        'Giáo viên',             'Giảng dạy', 'mocay',    '0900000010','binh.tran@aloha.edu.vn'),
  ('u_staff_acc',  'nv.ketoan',     '$2b$10$demo', 'Ngô Thị Hạnh',        'staff',          'Nhân viên Kế toán',     'Kế toán',   null,       '0900000011','hanh.ngo@aloha.edu.vn'),
  ('u_staff_mkt',  'nv.marketing',  '$2b$10$demo', 'Lý Gia Bảo',          'staff',          'Nhân viên Marketing',   'Marketing', null,       '0900000012','bao.ly@aloha.edu.vn'),
  ('u_staff_hr',   'nv.nhansu',     '$2b$10$demo', 'Trần Thu Hà',         'staff',          'Nhân viên Nhân sự',     'Nhân sự',   null,       '0900000013','ha.tran@aloha.edu.vn'),
  ('u_staff_tvv',  'nv.tuvan',      '$2b$10$demo', 'Phan Minh Tuấn',      'staff',          'Nhân viên Tư vấn',      'Tư vấn',    'travinh',  '0900000014','tuan.phan@aloha.edu.vn')
on conflict (id) do nothing;

-- Cập nhật quản lý trung tâm (chạy sau khi đã insert users ở trên)
update public.centers set manager_id = 'u_cm_travinh' where id = 'travinh';
update public.centers set manager_id = 'u_cm_mocay'   where id = 'mocay';

insert into public.classes (id, name, center, teacher_id, status, size, schedule, level) values
  ('cls_001','Aloha Junior A1',   'travinh','u_teacher_1','active',  18,'Thứ 2-4-6, 18:00-19:30','Junior'),
  ('cls_002','Aloha Starter B2',  'travinh','u_teacher_1','active',  15,'Thứ 3-5-7, 17:30-19:00','Starter'),
  ('cls_003','Aloha Pre A3',      'mocay',  'u_teacher_2','active',  20,'Thứ 2-4-6, 19:30-21:00','Pre'),
  ('cls_004','Aloha Kids C1',     'mocay',  'u_teacher_2','planning', 0,'Chưa xếp lịch',         'Kids')
on conflict (id) do nothing;

insert into public.students (id, name, center, class_id, course, status, dob) values
  ('st_001','Nguyễn Gia Hân', 'travinh','cls_001','Junior A1', 'studying','2015-03-12'),
  ('st_002','Trần Minh Khôi', 'travinh','cls_001','Junior A1', 'studying','2015-07-02'),
  ('st_003','Phạm Thị Bích',  'travinh','cls_002','Starter B2','studying','2014-11-20'),
  ('st_004','Lê Hoàng Phúc',  'mocay',  'cls_003','Pre A3',    'studying','2013-01-15'),
  ('st_005','Đặng Thảo Vy',   'mocay',  null,    'Tư vấn nhập học','lead','2016-05-09')
on conflict (id) do nothing;
