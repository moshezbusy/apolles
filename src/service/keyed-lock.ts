/**
 * Runs the tasks of one key strictly one after the other; different keys
 * do not wait for each other. Used so that book, reconcile, cancel and
 * resolve of one booking can never interleave (two of them reading the same
 * record and then overwriting each other's result).
 *
 * In-process only: correct for one server instance, like the file store.
 */
export class KeyedLock {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(task);
    // The next task waits for this one to end, whether it failed or not.
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key); // nobody queued behind us: forget the key
    });
    return result;
  }
}
