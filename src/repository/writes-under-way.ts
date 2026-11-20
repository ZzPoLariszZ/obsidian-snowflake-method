/**
 * The writes on their way to the disk, noted in one place.
 *
 * Whatever changes the disk notes itself here from the moment it is set
 * going until it lands or fails: one write by the repository, the settings
 * file, and a whole save where it enters, which is several writes with the
 * note read back between them. The app gives a closing window three
 * seconds, measured on 1.15, and then takes it away whatever is still being
 * written, so a quit has to wait for what was set going by name rather than
 * hope for it.
 *
 * One list, asked once. There used to be three, each kept by its own rule:
 * this one for the boards' queued changes, a count inside the repository
 * and another beside the settings. A quit asked all three by hand, a new
 * kind of writer would have been a fourth to remember, and none of them
 * could say that a save standing between two of its writes was still owed.
 * A writer of any kind now has one thing to do, which is to pass its
 * promise through here.
 */

const underway = new Set<Promise<unknown>>();

/**
 * Notes a write on its way until it lands or fails, and hands the same
 * promise back, so the call sits around a write without changing what its
 * caller is given.
 */
export function writeUnderWay<T>(run: Promise<T>): Promise<T> {
  underway.add(run);
  const landed = (): void => {
    underway.delete(run);
  };
  run.then(landed, landed);
  return run;
}

/**
 * Every noted write that has not landed, as one promise that never rejects.
 * Null where there is none, so that a caller with nothing to wait for can
 * tell, without a turn of the event loop to find out.
 */
export function writesUnderWay(): Promise<void> | null {
  if (underway.size === 0) return null;
  return Promise.allSettled([...underway]).then(() => undefined);
}
