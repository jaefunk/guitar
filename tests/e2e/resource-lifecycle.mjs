const RESOURCE_NAMES = new Set(['browser', 'context', 'preview', 'outputDir']);

export class E2ELifecycle {
  #resources = new Map();
  #pending = new Set();
  #cleanupChain = Promise.resolve();
  #abortError = null;

  get aborted() { return this.#abortError !== null; }

  acquire(name, factory, dispose) {
    this.#validateName(name);
    this.#throwIfAborted();
    const acquisition = this.#performAcquire(name, factory, dispose);
    this.#pending.add(acquisition);
    void acquisition.then(() => {
      this.#pending.delete(acquisition);
    }, () => {
      this.#pending.delete(acquisition);
    });
    return acquisition;
  }

  release(name) {
    this.#validateName(name);
    const resource = this.#resources.get(name);
    this.#resources.delete(name);
    return this.#enqueue(resource ? [resource] : []);
  }

  cleanup() {
    const captured = [...this.#resources.values()].reverse();
    this.#resources.clear();
    return this.#enqueue(captured);
  }

  async abort(reason = new Error('E2E workflow aborted')) {
    if (!this.aborted) {
      this.#abortError = reason instanceof Error ? reason : new Error(String(reason));
    }
    await this.cleanup();
    await Promise.allSettled([...this.#pending]);
    await this.cleanup();
  }

  #enqueue(resources) {
    const dispose = async () => {
      await Promise.allSettled(resources.map(({ value, dispose: disposeOne }) => (
        Promise.resolve().then(() => disposeOne(value))
      )));
    };
    this.#cleanupChain = this.#cleanupChain.then(dispose, dispose);
    return this.#cleanupChain;
  }

  async #performAcquire(name, factory, dispose) {
    const value = await factory();
    if (this.aborted) {
      await Promise.allSettled([Promise.resolve().then(() => dispose(value))]);
      throw this.#abortError;
    }
    if (this.#resources.has(name)) {
      await Promise.allSettled([Promise.resolve().then(() => dispose(value))]);
      throw new Error(`E2E resource is already assigned: ${name}`);
    }
    this.#resources.set(name, { value, dispose });
    return value;
  }

  #throwIfAborted() {
    if (this.aborted) throw this.#abortError;
  }

  #validateName(name) {
    if (!RESOURCE_NAMES.has(name)) throw new Error(`Unknown E2E resource: ${name}`);
  }
}
