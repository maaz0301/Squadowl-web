'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Card, PageHeader, Textarea, useAlert } from '@/components/ui';
import { useSubmitFeedbackMutation } from '@/features/queries';

function RatingRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const colors = useThemeColors();
  return (
    <div className="flex flex-col gap-2 mb-4">
      <label className="text-sm font-bold" style={{ color: colors.ink }}>
        {label}
      </label>
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <Button
            key={n}
            label={String(n)}
            size="sm"
            variant={value === n ? 'primary' : 'secondary'}
            onClick={() => onChange(n)}
          />
        ))}
      </div>
    </div>
  );
}

export default function FeedbackPage() {
  const colors = useThemeColors();
  const { alert } = useAlert();
  const submit = useSubmitFeedbackMutation();

  const [overallExperience, setOverallExperience] = useState(4);
  const [easeOfUse, setEaseOfUse] = useState(4);
  const [teamHubScheduling, setTeamHubScheduling] = useState(4);
  const [valueForMoney, setValueForMoney] = useState(4);
  const [whatIsWorkingWell, setWhatIsWorkingWell] = useState('');
  const [whatCanBeImproved, setWhatCanBeImproved] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await submit.mutateAsync({
        overallExperience,
        easeOfUse,
        teamHubScheduling,
        valueForMoney,
        whatIsWorkingWell,
        whatCanBeImproved,
      });
      setSubmitted(true);
    } catch (err) {
      await alert('Error', err instanceof Error ? err.message : 'Could not submit feedback.');
    }
  };

  if (submitted) {
    return (
      <>
        <PageHeader title="Feedback" showBack backHref="/profile" />
        <Card accent className="mt-4 flex flex-col items-center gap-4 py-12 text-center">
          <h2 className="text-2xl font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
            Thank you!
          </h2>
          <p className="max-w-md text-sm" style={{ color: colors.inkMuted }}>
            Your feedback helps us improve the coach and evaluator experience.
          </p>
          <Link href="/profile">
            <Button label="Back to Profile" />
          </Link>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Team Feedback Survey"
        subtitle="Help us improve the platform"
        showBack
        backHref="/profile"
      />

      <Card className="mt-4 max-w-2xl">
        <p className="mb-4 text-sm" style={{ color: colors.inkMuted }}>
          Rate your experience with assessments, scoring, and Team Hub.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <RatingRow label="Overall experience" value={overallExperience} onChange={setOverallExperience} />
          <RatingRow label="Ease of use" value={easeOfUse} onChange={setEaseOfUse} />
          <RatingRow label="Team Hub & scheduling" value={teamHubScheduling} onChange={setTeamHubScheduling} />
          <RatingRow label="Value for money" value={valueForMoney} onChange={setValueForMoney} />

          <div className="flex flex-col gap-1">
            <label className="text-sm font-bold" style={{ color: colors.ink }}>
              What&apos;s working well?
            </label>
            <Textarea
              rows={3}
              value={whatIsWorkingWell}
              onChange={(e) => setWhatIsWorkingWell(e.target.value)}
              placeholder="Tell us what features you love..."
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-bold" style={{ color: colors.ink }}>
              What can be improved?
            </label>
            <Textarea
              rows={3}
              value={whatCanBeImproved}
              onChange={(e) => setWhatCanBeImproved(e.target.value)}
              placeholder="Tell us what features or changes you would like to see..."
            />
          </div>

          <div className="pt-2">
            <Button label="Submit Feedback" loading={submit.isPending} />
          </div>
        </form>
      </Card>
    </>
  );
}
