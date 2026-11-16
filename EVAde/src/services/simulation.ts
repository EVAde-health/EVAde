/** The reserved demo UUID prefix and optional server-side synthetic flag. */
export function hasSimulatedData(subject: { user_id?: string; synthetic?: number; source?: string } | null | undefined) {
  return subject?.source === 'simulated' || subject?.synthetic === 1
    || subject?.user_id?.startsWith('00000000-0000-4000-8000-') === true;
}
