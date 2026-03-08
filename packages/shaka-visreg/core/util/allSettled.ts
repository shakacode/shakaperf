export default function allSettled (promises: Promise<unknown>[]) {
  return Promise.all(promises.map(function (promise) {
    return promise.then(function (value) {
      return { state: 'fulfilled', value };
    }).catch(function (reason) {
      return { state: 'rejected', reason };
    });
  }));
}
