-- ============================================================
-- ALOHA ERP — Giai đoạn 1: Mở rộng Schema cho tính năng mới
-- Chạy file này SAU khi đã chạy SUPABASE_SETUP_FINAL.sql
-- ============================================================

-- ─── 1. CHỮ KÝ SỐ (ảnh chữ ký cá nhân) ──────────────────────
-- Mỗi user lưu 1 ảnh chữ ký cá nhân để hệ thống tự chèn vào file khi duyệt
alter table public.users
  add column if not exists signature_url text;

-- Mộc/con dấu công ty (chỉ BGD/admin quản lý, dùng chung)
create table if not exists public.company_seals (
  id text primary key,
  name text not null,              -- VD: "Mộc tròn công ty", "Mộc Ban Giám đốc"
  seal_url text not null,
  is_active boolean default true,
  created_by text references public.users(id),
  created_at timestamptz default now()
);

-- ─── 2. HỆ THỐNG BIỂU MẪU ĐỘNG (form templates) ─────────────
-- Cho phép thêm loại biểu mẫu mới sau này mà không cần sửa code/database
create table if not exists public.form_templates (
  id text primary key,
  code text unique not null,         -- VD: 'facility_request', 'event_plan', 'invoice_payment'
  name text not null,                -- Tên hiển thị: "Yêu cầu cơ sở vật chất"
  description text,
  icon text default '📋',
  module text not null,              -- center | hr | marketing | accounting | facility
  fields jsonb default '[]',         -- Cấu trúc field động: [{key,label,type,required}]
  approval_flow jsonb default '[]',  -- Luồng duyệt: [{step:'dept_review',role:'...'},{step:'bgd_approve'}]
  requires_signature boolean default true,
  requires_seal boolean default false, -- true = cần đóng mộc BGD (vd: yêu cầu CSVC, sự kiện)
  is_active boolean default true,
  created_by text references public.users(id),
  created_at timestamptz default now()
);

-- Bảng chứa mọi yêu cầu/biểu mẫu được tạo từ form_templates (dùng chung, mở rộng được)
create table if not exists public.form_submissions (
  id text primary key,
  template_code text references public.form_templates(code),
  title text not null,
  data jsonb default '{}',           -- Dữ liệu form theo cấu trúc fields của template
  center text,                       -- Trung tâm liên quan (nếu có) — để ban hành thông báo đúng nơi
  requested_by text references public.users(id),
  status text default 'pending_review', -- pending_review | pending_bgd | approved | rejected | needs_revision
  current_file_url text,             -- File PDF hiện tại (gốc hoặc đã có chữ ký)
  original_file_url text,            -- File PDF gốc chưa ký (giữ lại để đối chiếu)
  signatures jsonb default '[]',     -- [{by, role, signedAt, note}]
  history jsonb default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ─── 3. HÓA ĐƠN THANH TOÁN DOANH NGHIỆP (gắn với form_submissions) ──
create table if not exists public.vendor_invoices (
  id text primary key,
  submission_id text references public.form_submissions(id), -- liên kết tới yêu cầu CSVC/sự kiện nếu có
  vendor_name text not null,         -- Tên đơn vị/nhà cung cấp
  vendor_tax_code text,
  invoice_number text,
  invoice_date date,
  amount bigint not null default 0,
  description text,
  invoice_file_url text,             -- Ảnh/PDF hóa đơn gốc
  status text default 'pending',     -- pending | paid | rejected
  paid_at timestamptz,
  requested_by text references public.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ─── 4. ĐIỂM DANH LỚP HỌC ───────────────────────────────────
create table if not exists public.attendance_sessions (
  id text primary key,
  class_id text references public.classes(id) not null,
  session_date date not null,
  teacher_id text references public.users(id),  -- giáo viên thực dạy buổi đó (có thể là người dạy thay)
  topic text,                        -- nội dung bài học buổi đó
  note text,
  created_by text references public.users(id),
  created_at timestamptz default now()
);

create table if not exists public.attendance_records (
  id text primary key,
  session_id text references public.attendance_sessions(id) not null,
  student_id text references public.students(id) not null,
  status text default 'present',     -- present | absent | late | excused
  note text
);

-- ─── 5. LỊCH LÀM VIỆC NHÂN SỰ (khác phân lịch tuần dạy học) ──
create table if not exists public.work_schedules (
  id text primary key,
  user_id text references public.users(id) not null,
  center text,                       -- trung tâm áp dụng ca làm đó
  work_date date not null,
  shift_start time,
  shift_end time,
  shift_type text default 'normal',  -- normal | overtime | day_off
  note text,
  created_by text references public.users(id),
  created_at timestamptz default now()
);

-- ─── 6. LỊCH HỌP ────────────────────────────────────────────
create table if not exists public.meetings (
  id text primary key,
  title text not null,
  description text,
  meeting_date date not null,
  start_time time not null,
  end_time time,
  location text,                     -- VD: "Online" hoặc địa điểm trực tiếp
  meet_link text,                    -- Link Google Meet tự sinh hoặc dán tay
  organizer_id text references public.users(id),
  invitees jsonb default '[]',       -- [{userId, email, status:'pending'|'accepted'|'declined'}]
  status text default 'scheduled',   -- scheduled | cancelled | completed
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ─── 7. THÔNG TIN SINH NHẬT (dùng cột có sẵn) ────────────────
-- users.hire_date đã có; cần thêm ngày sinh riêng (khác ngày vào làm)
alter table public.users
  add column if not exists date_of_birth date;

alter table public.users
  add column if not exists hometown text;          -- Quê quán

alter table public.users
  add column if not exists cv_url text;             -- File CV

alter table public.users
  add column if not exists certificates jsonb default '[]'; -- [{name, url, uploadedAt}]

-- ─── RLS cho các bảng mới (tạm tắt, đồng bộ với các bảng khác) ──
alter table public.company_seals disable row level security;
alter table public.form_templates disable row level security;
alter table public.form_submissions disable row level security;
alter table public.vendor_invoices disable row level security;
alter table public.attendance_sessions disable row level security;
alter table public.attendance_records disable row level security;
alter table public.work_schedules disable row level security;
alter table public.meetings disable row level security;

-- ─── Seed: Khai báo 3 biểu mẫu mặc định vào form_templates ───
insert into public.form_templates (id, code, name, description, icon, module, requires_signature, requires_seal, approval_flow) values
  ('tpl_facility', 'facility_request', 'Yêu cầu cơ sở vật chất',
   'Đề xuất mua sắm/sửa chữa cơ sở vật chất tại trung tâm hoặc văn phòng',
   '🛠️', 'facility', true, true,
   '[{"step":"dept_review","label":"Trưởng phòng CSVC tiếp nhận"},{"step":"bgd_approve","label":"Ban Giám đốc phê duyệt"}]'::jsonb),

  ('tpl_invoice', 'invoice_payment', 'Yêu cầu thanh toán hóa đơn (doanh nghiệp)',
   'Thanh toán cho đơn vị/nhà cung cấp bên ngoài, lưu vào hồ sơ thanh toán Kế toán',
   '🧾', 'accounting', true, true,
   '[{"step":"acc_review","label":"Kế toán tiếp nhận"},{"step":"bgd_approve","label":"Ban Giám đốc phê duyệt"}]'::jsonb),

  ('tpl_event', 'event_plan', 'Trình kế hoạch tổ chức sự kiện',
   'Kế hoạch tổ chức sự kiện tại trung tâm, trình Marketing rồi Ban Giám đốc duyệt',
   '🎉', 'marketing', true, true,
   '[{"step":"mkt_review","label":"Trưởng phòng Marketing tiếp nhận"},{"step":"bgd_approve","label":"Ban Giám đốc phê duyệt"}]'::jsonb)
on conflict (id) do nothing;
