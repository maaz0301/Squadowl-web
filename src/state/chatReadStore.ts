import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { zustandStorage } from '@/lib/storage';

interface ChatReadState {
  /** Season id -> the timestamp of the newest chat message this device has shown. */
  lastReadAt: Record<string, number>;
  markChatRead: (seasonId: string, at: number) => void;
}

/**
 * How much of each team chat this user has already seen, so the Chat tab can
 * badge what arrived since.
 *
 * Kept on the device rather than in the database: it is one number per season
 * with no reason to be readable by anyone else, and a read receipt that lags or
 * fails to write is worth far less than the badge is. The cost is that reading
 * the chat on a phone doesn't clear the badge on a laptop.
 */
export const useChatReadStore = create<ChatReadState>()(
  persist(
    (set) => ({
      lastReadAt: {},
      markChatRead: (seasonId, at) =>
        set((s) =>
          // Only ever moves forward: scrolling back through history, or a
          // second tab showing an older load, must not un-read newer messages.
          (s.lastReadAt[seasonId] ?? 0) >= at ? s : { lastReadAt: { ...s.lastReadAt, [seasonId]: at } },
        ),
    }),
    { name: 'aas-chat-read', storage: zustandStorage },
  ),
);
