// Stop waiting even when a host API does not implement AbortSignal. The operation
// must use this at asynchronous boundaries before starting further work or writes.
export function abortable(signal, task) {
  return new Promise((resolve, reject) => {
    const stopped = () => Object.assign(new Error('已停止回复'), {name: 'AbortError'});
    if (signal.aborted) { reject(stopped()); return; }
    const abort = () => reject(stopped());
    signal.addEventListener('abort', abort, {once: true});
    Promise.resolve().then(() => {
      if (signal.aborted) throw stopped();
      return task();
    }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
