-- Lets a reviewer remove a submission from the feedback portal.
--
-- 20260904130000_feedback_submissions.sql deliberately shipped with no update
-- or delete policy at all: "neither the author nor a reviewer should be able
-- to quietly rewrite it." That still holds for authors — this does not add
-- any UPDATE policy, and it does not let a submitter delete their own row.
-- What changes is narrower: the reviewer portal now has a Remove button for
-- cleaning up test submissions, spam, or duplicates, so reviewers (and only
-- reviewers, per is_feedback_reviewer()) may delete a submission outright.

drop policy if exists feedback_submissions_delete_reviewer on public.feedback_submissions;
create policy feedback_submissions_delete_reviewer on public.feedback_submissions
  for delete using (public.is_feedback_reviewer());

-- The existing feedback_attachments_delete policy only lets the uploader
-- clear their own folder, so a reviewer removing someone else's submission
-- couldn't clean up its attachment objects. This extends deletion to a
-- reviewer for any key in the bucket; storage policies are permissive and
-- OR together, so the owner-only policy above is unaffected.
drop policy if exists feedback_attachments_delete_reviewer on storage.objects;
create policy feedback_attachments_delete_reviewer on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'feedback-attachments'
    and public.is_feedback_reviewer()
  );
