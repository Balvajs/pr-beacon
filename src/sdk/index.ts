import type { commentPr } from './comment-pr';
import { PrBeacon } from './pr-beacon';

/**
 * Runs the provided callback and automatically submits the beacon at the end.
 *
 * @example
 * await submitPrBeacon(async (prBeacon) => {
 *   prBeacon.fail('Something went wrong');
 *   prBeacon.warn('Something looks suspicious');
 * });
 */
export const submitPrBeacon = async (
  callback: (prBeacon: PrBeacon) => Promise<void> | void,
  options?: Parameters<PrBeacon['_submit']>[0] & ConstructorParameters<typeof PrBeacon>[0],
): Promise<ReturnType<typeof commentPr>> => {
  const prBeacon = new PrBeacon(options);

  await callback(prBeacon);

  return prBeacon._submit(options);
};
