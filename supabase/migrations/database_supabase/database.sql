
CREATE TABLE public.admins (
  user_id uuid UNIQUE,
  admin_id text NOT NULL UNIQUE,
  full_name text NOT NULL,
  email text NOT NULL,
  school_id uuid,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT admins_pkey PRIMARY KEY (id),
  CONSTRAINT admins_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id),
  CONSTRAINT admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.analytics (
  student_id uuid,
  exam_id uuid,
  category_id uuid,
  average_score numeric,
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  total_attempts integer DEFAULT 0,
  highest_score numeric,
  lowest_score numeric,
  last_attempt_at timestamp with time zone,
  program_id uuid,
  total_time_spent_minutes integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT analytics_pkey PRIMARY KEY (id),
  CONSTRAINT analytics_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.exam_categories(id),
  CONSTRAINT analytics_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES public.exams(id),
  CONSTRAINT analytics_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.programs(id),
  CONSTRAINT analytics_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id)
);
CREATE TABLE public.answers (
  submission_id uuid,
  question_id uuid,
  answer_text text,
  is_correct boolean,
  points_earned numeric,
  graded_by uuid,
  feedback text,
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT answers_pkey PRIMARY KEY (id),
  CONSTRAINT answers_graded_by_fkey FOREIGN KEY (graded_by) REFERENCES public.profiles(id),
  CONSTRAINT answers_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(id),
  CONSTRAINT answers_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.submissions(id)
);
CREATE TABLE public.approval_events (
  entity_type text NOT NULL CHECK (entity_type = ANY (ARRAY['exam'::text, 'question'::text, 'question_bank'::text])),
  entity_id uuid NOT NULL,
  from_status USER-DEFINED,
  to_status USER-DEFINED NOT NULL,
  actor_id uuid NOT NULL,
  notes text,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT approval_events_pkey PRIMARY KEY (id),
  CONSTRAINT approval_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.exam_approvals (
  exam_id uuid NOT NULL,
  submitted_by uuid NOT NULL,
  reviewer_id uuid,
  review_note text,
  reviewed_at timestamp with time zone,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])),
  submitted_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT exam_approvals_pkey PRIMARY KEY (id),
  CONSTRAINT exam_approvals_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES public.exams(id),
  CONSTRAINT exam_approvals_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES public.profiles(id),
  CONSTRAINT exam_approvals_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.exam_assignments (
  exam_id uuid,
  student_id uuid,
  program_id uuid,
  assigned_by uuid,
  deadline timestamp with time zone,
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  assigned_at timestamp with time zone DEFAULT now(),
  is_active boolean DEFAULT true,
  CONSTRAINT exam_assignments_pkey PRIMARY KEY (id),
  CONSTRAINT exam_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.profiles(id),
  CONSTRAINT exam_assignments_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES public.exams(id),
  CONSTRAINT exam_assignments_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.programs(id),
  CONSTRAINT exam_assignments_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id)
);
CREATE TABLE public.exam_categories (
  name text NOT NULL,
  description text,
  icon text,
  program_id uuid,
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT exam_categories_pkey PRIMARY KEY (id),
  CONSTRAINT exam_categories_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.programs(id)
);
CREATE TABLE public.exam_tos_areas (
  exam_id uuid NOT NULL,
  area_title text NOT NULL CHECK (length(btrim(area_title)) > 0),
  weight_percent numeric NOT NULL CHECK (weight_percent >= 0::numeric AND weight_percent <= 100::numeric),
  expected_items integer NOT NULL CHECK (expected_items >= 0),
  min_percent numeric NOT NULL CHECK (min_percent >= 0::numeric AND min_percent <= 100::numeric),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  is_temporary boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT exam_tos_areas_pkey PRIMARY KEY (id),
  CONSTRAINT exam_tos_areas_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES public.exams(id)
);
CREATE TABLE public.exams (
  title text NOT NULL,
  description text,
  category_id uuid,
  duration_minutes integer NOT NULL,
  passing_score numeric NOT NULL,
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  total_points integer NOT NULL,
  created_by uuid,
  program_id uuid,
  allowed_programs ARRAY,
  allowed_year_levels ARRAY,
  program text,
  submitted_by uuid,
  submitted_at timestamp with time zone,
  approved_by uuid,
  approved_at timestamp with time zone,
  review_notes text,
  rejected_at timestamp with time zone,
  published_at timestamp with time zone,
  is_published boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  exam_type text NOT NULL DEFAULT 'mock'::text CHECK (exam_type = ANY (ARRAY['mock'::text, 'practice'::text])),
  grading_mode text DEFAULT 'auto'::text,
  approval_status USER-DEFINED NOT NULL DEFAULT 'draft'::approval_status,
  CONSTRAINT exams_pkey PRIMARY KEY (id),
  CONSTRAINT exams_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.profiles(id),
  CONSTRAINT exams_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.exam_categories(id),
  CONSTRAINT exams_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id),
  CONSTRAINT exams_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.programs(id),
  CONSTRAINT exams_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.faculty (
  user_id uuid UNIQUE,
  faculty_id text NOT NULL UNIQUE,
  full_name text NOT NULL,
  email text NOT NULL,
  created_by uuid,
  role_type text CHECK (role_type = ANY (ARRAY['professional'::text, 'major'::text, 'minor'::text])),
  program_id uuid,
  school_id uuid,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  is_program_head boolean NOT NULL DEFAULT false,
  role_types ARRAY DEFAULT '{}'::text[],
  CONSTRAINT faculty_pkey PRIMARY KEY (id),
  CONSTRAINT faculty_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id),
  CONSTRAINT faculty_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.programs(id),
  CONSTRAINT faculty_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id),
  CONSTRAINT faculty_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.faculty_programs (
  faculty_id uuid NOT NULL,
  program_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  is_program_head boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT faculty_programs_pkey PRIMARY KEY (id),
  CONSTRAINT faculty_programs_faculty_id_fkey FOREIGN KEY (faculty_id) REFERENCES public.faculty(id),
  CONSTRAINT faculty_programs_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.programs(id)
);
CREATE TABLE public.favorites (
  user_id uuid NOT NULL,
  material_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT favorites_pkey PRIMARY KEY (id),
  CONSTRAINT favorites_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.study_materials(id),
  CONSTRAINT favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.notifications (
  user_id uuid NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  type USER-DEFINED NOT NULL DEFAULT 'general'::notif_type,
  is_read boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.practice_completions (
  student_id uuid NOT NULL,
  exam_id uuid NOT NULL,
  completed_at timestamp with time zone DEFAULT now(),
  CONSTRAINT practice_completions_pkey PRIMARY KEY (student_id, exam_id),
  CONSTRAINT practice_completions_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES public.exams(id),
  CONSTRAINT practice_completions_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.practice_exams (
  title text NOT NULL,
  description text,
  category_id uuid,
  content text,
  file_url text,
  created_by uuid,
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  is_published boolean DEFAULT false,
  view_count integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT practice_exams_pkey PRIMARY KEY (id),
  CONSTRAINT reviewers_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.exam_categories(id),
  CONSTRAINT reviewers_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.profiles (
  id uuid NOT NULL,
  email text NOT NULL UNIQUE,
  full_name text,
  role text NOT NULL CHECK (role = ANY (ARRAY['student'::text, 'admin'::text, 'faculty'::text])),
  avatar_url text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
CREATE TABLE public.programs (
  school_id uuid,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  full_name text NOT NULL,
  degree_type text NOT NULL,
  major text,
  description text,
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  years integer DEFAULT 4,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT programs_pkey PRIMARY KEY (id),
  CONSTRAINT programs_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id)
);
CREATE TABLE public.schools (
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  full_name text NOT NULL,
  description text,
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT schools_pkey PRIMARY KEY (id)
);
CREATE TABLE public.students (
  id uuid NOT NULL,
  student_id text NOT NULL UNIQUE,
  school text,
  year_level integer NOT NULL,
  target_exam text,
  program_id uuid NOT NULL,
  school_id uuid,
  user_id uuid UNIQUE,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT students_pkey PRIMARY KEY (id),
  CONSTRAINT students_id_fkey FOREIGN KEY (id) REFERENCES public.profiles(id),
  CONSTRAINT students_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.programs(id),
  CONSTRAINT students_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id),
  CONSTRAINT students_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.study_materials (
  title text NOT NULL,
  description text,
  type text NOT NULL CHECK (type = ANY (ARRAY['document'::text, 'video'::text, 'notes'::text])),
  file_url text,
  notes_content text,
  program_id uuid,
  category text,
  created_by uuid,
  external_url text,
  meeting_url text,
  link_type text CHECK (link_type IS NULL OR (link_type = ANY (ARRAY['video'::text, 'meeting'::text, 'drive'::text, 'other'::text]))),
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  is_published boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT study_materials_pkey PRIMARY KEY (id),
  CONSTRAINT study_materials_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id),
  CONSTRAINT study_materials_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.programs(id)
);
CREATE TABLE public.question_banks (
  title text NOT NULL,
  description text,
  program_id uuid,
  exam_id uuid,
  submitted_by uuid,
  submitted_at timestamp with time zone,
  approved_by uuid,
  approved_at timestamp with time zone,
  rejected_at timestamp with time zone,
  published_at timestamp with time zone,
  review_notes text,
  last_modified_by uuid,
  last_modified_at timestamp with time zone,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  approval_status USER-DEFINED NOT NULL DEFAULT 'draft'::approval_status,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT question_banks_pkey PRIMARY KEY (id),
  CONSTRAINT question_banks_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.profiles(id),
  CONSTRAINT question_banks_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES public.exams(id),
  CONSTRAINT question_banks_last_modified_by_fkey FOREIGN KEY (last_modified_by) REFERENCES public.profiles(id),
  CONSTRAINT question_banks_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.programs(id),
  CONSTRAINT question_banks_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.questions (
  exam_id uuid,
  question_text text NOT NULL,
  question_type USER-DEFINED NOT NULL,
  options jsonb,
  correct_answer text,
  explanation text,
  order_number integer,
  created_by uuid,
  scenario text,
  submitted_by uuid,
  submitted_at timestamp with time zone,
  approved_by uuid,
  approved_at timestamp with time zone,
  review_notes text,
  question_bank_id uuid,
  section_title text,
  section_number integer,
  last_modified_by uuid,
  last_modified_at timestamp with time zone,
  image_url text,
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  points integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone DEFAULT now(),
  approval_status USER-DEFINED NOT NULL DEFAULT 'draft'::approval_status,
  CONSTRAINT questions_pkey PRIMARY KEY (id),
  CONSTRAINT questions_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.profiles(id),
  CONSTRAINT questions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id),
  CONSTRAINT questions_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES public.exams(id),
  CONSTRAINT questions_last_modified_by_fkey FOREIGN KEY (last_modified_by) REFERENCES public.profiles(id),
  CONSTRAINT questions_question_bank_id_fkey FOREIGN KEY (question_bank_id) REFERENCES public.question_banks(id),
  CONSTRAINT questions_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.submissions (
  exam_id uuid,
  student_id uuid,
  submitted_at timestamp with time zone,
  time_spent_seconds integer,
  score numeric,
  percentage numeric,
  passed boolean,
  released_at timestamp with time zone,
  program_id uuid,
  year_level integer,
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  started_at timestamp with time zone DEFAULT now(),
  status text DEFAULT 'in_progress'::text CHECK (status = ANY (ARRAY['in_progress'::text, 'submitted'::text, 'graded'::text, 'reviewed'::text, 'released'::text])),
  created_at timestamp with time zone DEFAULT now(),
  attempt_no smallint NOT NULL DEFAULT 1 CHECK (attempt_no >= 1),
  CONSTRAINT submissions_pkey PRIMARY KEY (id),
  CONSTRAINT submissions_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES public.exams(id),
  CONSTRAINT submissions_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.programs(id),
  CONSTRAINT submissions_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id)
);
CREATE TABLE public.storage_files (
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_type text NOT NULL,
  file_size integer,
  uploaded_by uuid,
  purpose text CHECK (purpose = ANY (ARRAY['exam_questions'::text, 'reviewer'::text, 'profile_image'::text, 'other'::text])),
  file_hash text,
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT storage_files_pkey PRIMARY KEY (id),
  CONSTRAINT storage_files_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.support_tickets (
  user_id uuid NOT NULL,
  subject text NOT NULL,
  description text NOT NULL,
  resolved_at timestamp with time zone,
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  category text NOT NULL DEFAULT 'other'::text,
  priority text NOT NULL DEFAULT 'normal'::text CHECK (priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text])),
  status text NOT NULL DEFAULT 'open'::text CHECK (status = ANY (ARRAY['open'::text, 'in_progress'::text, 'resolved'::text, 'closed'::text])),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT support_tickets_pkey PRIMARY KEY (id),
  CONSTRAINT support_tickets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.users (
  id uuid NOT NULL,
  role text NOT NULL CHECK (role = ANY (ARRAY['student'::text, 'faculty'::text, 'admin'::text])),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
CREATE TABLE public.signup_otps (
  email text NOT NULL,
  code text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  consumed_at timestamp with time zone,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT signup_otps_pkey PRIMARY KEY (id)
);