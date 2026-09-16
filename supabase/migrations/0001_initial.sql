create extension if not exists pgcrypto;

create table if not exists elections (
  id uuid primary key default gen_random_uuid(),
  church_name text not null,
  election_date date not null,
  elder_seats integer not null check (elder_seats >= 0),
  deacon_seats integer not null check (deacon_seats >= 0),
  present_members integer check (present_members > 0),
  status text not null default 'draft' check (status in ('draft', 'open', 'finished')),
  current_office text check (current_office in ('elder', 'deacon')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (elder_seats > 0 or deacon_seats > 0)
);

create unique index if not exists elections_one_open
  on elections ((true)) where status = 'open';

create table if not exists candidates (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references elections(id) on delete cascade,
  office text not null check (office in ('elder', 'deacon')),
  name text not null,
  display_order integer not null,
  elected boolean not null default false,
  elected_round integer,
  created_at timestamptz not null default now(),
  unique (election_id, office, name)
);

create table if not exists credential_batches (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references elections(id) on delete cascade,
  sequence_number integer not null,
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now(),
  unique (election_id, sequence_number)
);

create table if not exists voting_codes (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references elections(id) on delete cascade,
  batch_id uuid not null references credential_batches(id) on delete cascade,
  code varchar(12) not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  invalidated_at timestamptz
);

create index if not exists voting_codes_election on voting_codes(election_id);

create table if not exists scrutinies (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references elections(id) on delete cascade,
  office text not null check (office in ('elder', 'deacon')),
  round_number integer not null check (round_number between 1 and 3),
  seats_open integer not null check (seats_open > 0),
  max_marks integer not null check (max_marks > 0),
  majority_required integer not null check (majority_required > 0),
  status text not null default 'open' check (status in ('open', 'closed', 'published')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  published_at timestamptz,
  unique (election_id, office, round_number)
);

create unique index if not exists scrutinies_one_open
  on scrutinies (election_id) where status = 'open';

create table if not exists scrutiny_candidates (
  scrutiny_id uuid not null references scrutinies(id) on delete cascade,
  candidate_id uuid not null references candidates(id) on delete cascade,
  position integer not null,
  primary key (scrutiny_id, candidate_id)
);

create table if not exists ballots (
  id uuid primary key default gen_random_uuid(),
  scrutiny_id uuid not null references scrutinies(id) on delete cascade,
  code_id uuid references voting_codes(id) on delete restrict,
  source text not null check (source in ('digital', 'paper')),
  blank_count integer not null check (blank_count >= 0),
  submitted_at timestamptz not null default now()
);

create unique index if not exists ballots_one_per_code
  on ballots (scrutiny_id, code_id) where code_id is not null;

create index if not exists ballots_scrutiny on ballots(scrutiny_id);

create table if not exists ballot_entries (
  ballot_id uuid not null references ballots(id) on delete cascade,
  candidate_id uuid not null references candidates(id) on delete restrict,
  primary key (ballot_id, candidate_id)
);

create table if not exists scrutiny_results (
  scrutiny_id uuid not null references scrutinies(id) on delete cascade,
  candidate_id uuid not null references candidates(id) on delete restrict,
  votes integer not null check (votes >= 0),
  elected boolean not null default false,
  primary key (scrutiny_id, candidate_id)
);

create table if not exists audit_events (
  id bigserial primary key,
  election_id uuid references elections(id) on delete cascade,
  action text not null,
  actor_id text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table elections enable row level security;
alter table candidates enable row level security;
alter table credential_batches enable row level security;
alter table voting_codes enable row level security;
alter table scrutinies enable row level security;
alter table scrutiny_candidates enable row level security;
alter table ballots enable row level security;
alter table ballot_entries enable row level security;
alter table scrutiny_results enable row level security;
alter table audit_events enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
