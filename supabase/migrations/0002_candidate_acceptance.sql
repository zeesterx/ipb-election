alter table candidates
  add column if not exists declined boolean not null default false;

alter table candidates
  add column if not exists declined_round integer;

alter table scrutiny_results
  add column if not exists accepted boolean;
