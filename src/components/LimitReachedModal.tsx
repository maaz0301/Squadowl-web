'use client';

import { useRouter } from 'next/navigation';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Modal, ModalFooter } from '@/components/ui';
import { usePlatformBlockedFeaturesQuery } from '@/features/queries';

interface Props {
  visible: boolean;
  onClose: () => void;
  message: string;
}

export function LimitReachedModal({ visible, onClose, message }: Props) {
  const router = useRouter();
  const colors = useThemeColors();
  const { data: platformBlockedFeatures } = usePlatformBlockedFeaturesQuery();
  const billingBlocked = (platformBlockedFeatures ?? []).includes('billing');

  return (
    <Modal
      visible={visible}
      title="Plan Limit Reached"
      size="sm"
      onClose={onClose}
      footer={
        <ModalFooter>
          <Button label="Cancel" variant="secondary" onClick={onClose} />
          {!billingBlocked ? (
            <Button
              label="View Plans"
              onClick={() => {
                onClose();
                router.push('/upgrade');
              }}
            />
          ) : null}
        </ModalFooter>
      }
    >
      <p className="py-2 text-center text-[15px]" style={{ color: colors.ink }}>
        {message}
      </p>
    </Modal>
  );
}
