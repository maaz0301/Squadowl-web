-- Founder console: delete a support ticket.
--
-- Nothing in 20260916140000_founder_support_content.sql could remove a
-- ticket at all — status could only move between 'open' and 'resolved'. This
-- adds the one missing write, same shape as its siblings: a
-- SECURITY DEFINER function gated on is_founder(), audited, callable directly
-- from the client (no edge function needed — nothing here touches SendGrid).
--
-- support_messages.ticket_id already cascades on delete, so removing the
-- ticket row takes its whole conversation with it in one statement.
--
-- Timestamped ahead of 20260917130000_founder_billing.sql so this doesn't
-- need that migration to have run first — but the constraint below still
-- has to restate EVERY action value in use, billing's included: adding a
-- CHECK constraint fails outright if any existing row would violate it, and
-- founder-billing's edge function (not just its SQL migration) writes
-- 'refund_payment' / 'change_subscription' / 'cancel_subscription' /
-- 'resume_subscription' straight to this table already. Whichever of this
-- file or 20260917130000 runs second just re-asserts the same full list.

-- ---------------------------------------------------------------------------
-- Audit actions
-- ---------------------------------------------------------------------------

alter table public.founder_audit_log
  drop constraint if exists founder_audit_log_action_check;

alter table public.founder_audit_log
  add constraint founder_audit_log_action_check
  check (action in (
    'suspend', 'reactivate', 'create_org', 'update_access',
    'impersonate_start', 'impersonate_end',
    'update_user_role', 'reset_password', 'resend_verification', 'ban_user', 'unban_user', 'delete_user',
    'create_announcement', 'end_announcement', 'broadcast_email',
    'create_discount_code', 'update_discount_code',
    'refund_payment', 'change_subscription', 'cancel_subscription', 'resume_subscription',
    'delete_support_ticket'
  ));

-- ---------------------------------------------------------------------------
-- Delete
-- ---------------------------------------------------------------------------

create or replace function public.founder_delete_support_ticket(p_ticket_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email   text;
  v_subject text;
begin
  if not public.is_founder() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select email, subject into v_email, v_subject
    from public.support_tickets
   where id = p_ticket_id;
  if not found then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;

  delete from public.support_tickets where id = p_ticket_id;

  perform public.founder_write_audit(
    'delete_support_ticket', null, v_subject, null,
    jsonb_build_object('ticket_id', p_ticket_id, 'email', v_email));
end;
$$;

grant execute on function public.founder_delete_support_ticket(uuid) to authenticated;
