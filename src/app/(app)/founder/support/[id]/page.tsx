'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, ErrorState, LoadingState, PageHeader, Textarea, useAlert } from '@/components/ui';
import { FounderNotAvailable, FounderSection } from '@/components/founder/FounderUi';
import { formatDate } from '@/components/founder/labels';
import type { SupportTicketDetail } from '@/data/founder/types';
import {
  useAddInboundSupportMessageMutation,
  useDeleteSupportTicketMutation,
  useIsFounderQuery,
  useSendSupportEmailMutation,
  useSetSupportTicketStatusMutation,
  useSupportTicketQuery,
} from '@/features/founderQueries';

export default function FounderSupportTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const founderQuery = useIsFounderQuery();
  const query = useSupportTicketQuery(id, founderQuery.data === true);

  if (founderQuery.isLoading || (founderQuery.data === true && query.isLoading)) {
    return <LoadingState message="Loading ticket..." />;
  }
  if (founderQuery.data !== true) return <FounderNotAvailable />;
  if (query.isError || !query.data) {
    return (
      <>
        <PageHeader title="Ticket" showBack backHref="/founder/support" />
        <ErrorState
          message={query.error instanceof Error ? query.error.message : 'Could not load this ticket.'}
          onRetry={() => query.refetch()}
        />
      </>
    );
  }
  return <Ticket ticket={query.data} />;
}

function Ticket({ ticket }: { ticket: SupportTicketDetail }) {
  const colors = useThemeColors();
  const router = useRouter();
  const { alert, confirm, toast } = useAlert();
  const send = useSendSupportEmailMutation();
  const logInbound = useAddInboundSupportMessageMutation();
  const setStatus = useSetSupportTicketStatusMutation();
  const deleteTicket = useDeleteSupportTicketMutation();
  const [body, setBody] = useState('');
  const open = ticket.status === 'open';

  const reply = async () => {
    if (!body.trim()) return;
    try {
      await send.mutateAsync({ ticketId: ticket.id, body });
      setBody('');
      toast(`Reply sent to ${ticket.email}.`, 'success');
    } catch (e) {
      await alert('Could Not Send', e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  const logReply = async () => {
    if (!body.trim()) return;
    try {
      await logInbound.mutateAsync({ ticketId: ticket.id, body });
      setBody('');
      toast('Customer reply logged.', 'success');
    } catch (e) {
      await alert('Could Not Log', e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  const toggleStatus = async () => {
    try {
      await setStatus.mutateAsync({ ticketId: ticket.id, status: open ? 'resolved' : 'open' });
      toast(open ? 'Ticket resolved.' : 'Ticket reopened.', 'success');
    } catch (e) {
      await alert('Could Not Update', e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  const handleDelete = async () => {
    const messageCount = ticket.messages.length;
    const ok = await confirm({
      title: 'Delete Ticket',
      message: `Delete this ticket and its ${messageCount} message${messageCount === 1 ? '' : 's'}? This can't be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
      requireText: 'DELETE',
    });
    if (!ok) return;
    try {
      await deleteTicket.mutateAsync(ticket.id);
      toast('Ticket deleted.', 'success');
      router.push('/founder/support');
    } catch (e) {
      await alert('Could Not Delete', e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  const busy = send.isPending || logInbound.isPending;

  return (
    <>
      <PageHeader
        title={ticket.subject}
        subtitle={ticket.email}
        showBack
        backHref="/founder/support"
        right={
          <div className="flex gap-2">
            <Button
              label={open ? 'Mark Resolved' : 'Reopen'}
              size="sm"
              variant={open ? 'primary' : 'secondary'}
              loading={setStatus.isPending}
              onClick={toggleStatus}
            />
            <Button
              label="Delete"
              size="sm"
              variant="danger"
              loading={deleteTicket.isPending}
              onClick={handleDelete}
            />
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge label={open ? 'Open' : 'Resolved'} variant={open ? 'warning' : 'success'} />
        {ticket.userId ? <Badge label="Registered user" variant="info" /> : <Badge label="Not a registered user" />}
        <span className="text-xs" style={{ color: colors.inkFaint }}>
          Opened {formatDate(ticket.createdAt, true)}
        </span>
      </div>

      <FounderSection title="Conversation">
        {ticket.messages.map((m) => {
          const outbound = m.direction === 'outbound';
          return (
            <Card
              key={m.id}
              className={outbound ? 'flex flex-col gap-1.5 sm:ml-10' : 'flex flex-col gap-1.5 sm:mr-10'}
              style={outbound ? { borderColor: colors.primary } : undefined}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold break-all" style={{ color: colors.ink }}>
                  {outbound ? `Support (${m.authorEmail ?? 'founder'})` : m.authorEmail ?? ticket.email}
                </p>
                <span className="text-xs" style={{ color: colors.inkFaint }}>
                  {formatDate(m.createdAt, true)}
                </span>
              </div>
              <p className="text-sm break-words whitespace-pre-line" style={{ color: colors.inkMuted }}>
                {m.body}
              </p>
              {m.deliveryError ? (
                <p className="text-xs break-words" style={{ color: colors.danger }}>
                  Not delivered: {m.deliveryError}
                </p>
              ) : null}
            </Card>
          );
        })}
      </FounderSection>

      <FounderSection title="Respond">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          maxLength={20000}
          placeholder="Write a reply, or paste in what the customer sent back…"
        />
        <div className="flex flex-wrap gap-2">
          <Button label="Send Reply" disabled={!body.trim() || busy} loading={send.isPending} onClick={reply} />
          <Button
            label="Log Customer Reply"
            variant="secondary"
            disabled={!body.trim() || busy}
            loading={logInbound.isPending}
            onClick={logReply}
          />
        </div>
        <p className="text-xs" style={{ color: colors.inkFaint }}>
          Replies go out from support@tryouthq.ca; the customer&apos;s answer comes back to that mailbox.
        </p>
      </FounderSection>
    </>
  );
}
