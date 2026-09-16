/** Founder RPC errors, with the two that mean "not set up" said plainly. */
export function founderError(error: { message: string; code?: string }): Error & { code?: string } {
  if (error.code === '42501') {
    return withCode({ ...error, message: 'Only founder@tryout.ca can do this.' });
  }
  if (error.code === 'PGRST202' || error.code === '42883' || error.code === '42P01') {
    return withCode({
      ...error,
      message: 'The founder console is not deployed yet — apply 20260916120000_founder_org_management.sql.',
    });
  }
  return withCode(error);
}

/** Same shape SupabaseDataSource's unwrapError() throws: the message, with the SQLSTATE kept on `code`. */
function withCode(error: { message: string; code?: string }): Error & { code?: string } {
  const err = new Error(error.message) as Error & { code?: string };
  err.code = error.code;
  return err;
}
