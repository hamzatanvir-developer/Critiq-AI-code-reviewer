import "server-only";
import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "critiq-repository-scans",
  fetch: (url, options = {}) =>
    fetch(url, {
      ...options,
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(12_000)])
        : AbortSignal.timeout(12_000),
    }),
});
