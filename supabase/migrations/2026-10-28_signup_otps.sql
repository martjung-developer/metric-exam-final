create table public.signup_otps (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  consumed_at timestamptz null,
  created_at timestamptz default now()
);

create index signup_otps_email_created_at_idx
  on public.signup_otps (email, created_at desc);

alter table public.signup_otps enable row level security;
