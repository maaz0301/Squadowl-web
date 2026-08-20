'use client';

import { TeamChat } from '@/components/TeamChat';
import { useSeasonId } from '@/features/useSeasonId';

export default function SeasonChatPage() {
  const id = useSeasonId();
  return <TeamChat seasonId={id} />;
}
