-- Function to consume credits safely
drop function if exists consume_credits(int);

create or replace function consume_credits(p_amount int)
returns int
language plpgsql
security definer
as $$
declare
  current_credits int;
  new_credits int;
begin
  -- Get current credits and lock the row
  select credits into current_credits
  from profiles
  where id = auth.uid()
  for update;

  if current_credits >= p_amount then
    new_credits := current_credits - p_amount;
    
    update profiles
    set credits = new_credits,
        updated_at = now()
    where id = auth.uid();
    
    return new_credits;
  else
    return null; 
  end if;
end;
$$;

-- Function to add credits (Admin only)
drop function if exists admin_add_credits(uuid, int);

create or replace function admin_add_credits(p_target_user uuid, p_amount int)
returns void
language plpgsql
security definer
as $$
begin
  update profiles
  set credits = credits + p_amount,
      updated_at = now()
  where id = p_target_user;
end;
$$;
