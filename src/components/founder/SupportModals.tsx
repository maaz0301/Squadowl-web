'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Modal, ModalFooter, Tabs, Textarea, useAlert } from '@/components/ui';
import { useCreateInboundSupportTicketMutation, useSendSupportEmailMutation } from '@/features/founderQueries';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const EMPTY = { email: '', subject: '', body: '' };

const MODES = [
  { key: 'inbound', label: 'Log received email' },
  { key: 'outbound', label: 'Send new email' },
];

/** A new ticket: either an email that arrived at support@, or one the founder starts. */
export function NewSupportTicketModal({
  visible,
  onClose,
  initialEmail,
}: {
  visible: boolean;
  onClose: () => void;
  initialEmail?: string;
}) {
  const router = useRouter();
  const { alert, toast } = useAlert();
  const createInbound = useCreateInboundSupportTicketMutation();
  const sendEmail = useSendSupportEmailMutation();
  const [mode, setMode] = useState('inbound');
  const [form, setForm] = useState({ ...EMPTY, email: initialEmail ?? '' });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof EMPTY, string>>>({});

  const set = (key: keyof typeof EMPTY, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const close = () => {
    setForm({ ...EMPTY, email: initialEmail ?? '' });
    setErrors({});
    onClose();
  };

  const submit = async () => {
    const next = {
      email: EMAIL_RE.test(form.email.trim()) ? undefined : 'Enter a valid email',
      subject: form.subject.trim() ? undefined : 'Required',
      body: form.body.trim() ? undefined : 'Required',
    };
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;

    try {
      const ticketId =
        mode === 'inbound'
          ? await createInbound.mutateAsync(form)
          : await sendEmail.mutateAsync({ email: form.email, subject: form.subject, body: form.body });
      toast(mode === 'inbound' ? 'Ticket logged.' : `Email sent to ${form.email.trim()}.`, 'success');
      close();
      router.push(`/founder/support/${ticketId}`);
    } catch (e) {
      await alert(mode === 'inbound' ? 'Could Not Log' : 'Could Not Send', e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  return (
    <Modal
      visible={visible}
      title="New Ticket"
      onClose={close}
      hideDefaultFooter
      footer={
        <ModalFooter>
          <Button label="Cancel" variant="ghost" onClick={close} />
          <Button
            label={mode === 'inbound' ? 'Log Ticket' : 'Send Email'}
            loading={createInbound.isPending || sendEmail.isPending}
            onClick={submit}
          />
        </ModalFooter>
      }
    >
      <Tabs tabs={MODES} activeKey={mode} onChange={setMode} className="mb-4" />
      <div className="flex flex-col gap-4">
        <p className="text-sm">
          {mode === 'inbound'
            ? 'Paste in an email a customer sent to support@tryouthq.ca so it can be tracked and answered here.'
            : 'Sent from support@tryouthq.ca. Their reply comes back to that mailbox — log it on the ticket when it does.'}
        </p>
        <Input
          label={mode === 'inbound' ? 'From' : 'To'}
          type="email"
          autoComplete="off"
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
          error={errors.email}
        />
        <Input
          label="Subject"
          value={form.subject}
          onChange={(e) => set('subject', e.target.value)}
          error={errors.subject}
          maxLength={200}
        />
        <Textarea
          label="Message"
          value={form.body}
          onChange={(e) => set('body', e.target.value)}
          error={errors.body}
          rows={8}
          maxLength={20000}
        />
      </div>
    </Modal>
  );
}
