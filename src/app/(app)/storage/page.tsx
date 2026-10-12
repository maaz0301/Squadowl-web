import { redirect } from 'next/navigation';

/** Video storage now lives inside the Library; old links and Stripe returns land there. */
export default async function StoragePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const success = params.success === 'true' ? '?success=true' : '';
  redirect(`/library${success}`);
}
