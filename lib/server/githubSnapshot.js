import "server-only";

const SHA = /^[a-f0-9]{40}$/i;
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_BYTES = 200_000;
const MAX_SOURCE_CHARACTERS = 50_000;

export class GitHubScanError extends Error {
  constructor(message, status = 502, reason = "github-error") {
    super(message);
    this.name = "GitHubScanError";
    this.status = status;
    this.reason = reason;
  }
}

export function parseRepositoryUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new GitHubScanError(
      "Enter a valid public GitHub repository URL.",
      400,
    );
  }
  const parts = url.pathname.replace(/\/$/, "").split("/").slice(1);
  const [owner, rawName] = parts;
  const repository = rawName?.replace(/\.git$/i, "");
  const validPart = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    parts.length !== 2 ||
    !validPart.test(owner ?? "") ||
    !validPart.test(repository ?? "")
  ) {
    throw new GitHubScanError(
      "Use https://github.com/owner/repository without a branch or file path.",
      400,
    );
  }
  return { owner, repository };
}

async function readBoundedJson(response, maximum) {
  if (Number(response.headers.get("content-length")) > maximum) {
    await response.body?.cancel();
    throw new GitHubScanError(
      "GitHub response exceeded the scan size limit.",
      502,
      "response-too-large",
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw new GitHubScanError("GitHub returned an empty response.");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new GitHubScanError(
          "GitHub response exceeded the scan size limit.",
          502,
          "response-too-large",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks, size).toString("utf8"));
  } catch {
    throw new GitHubScanError("GitHub returned invalid JSON.");
  }
}

export function createGitHubClient({
  owner,
  repository,
  deadline,
  fetchImpl = fetch,
  token = process.env.GITHUB_TOKEN,
}) {
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
  return async function get(path, maximum = MAX_JSON_BYTES) {
    const remaining = deadline - Date.now();
    if (remaining <= 0)
      throw new GitHubScanError("Scan time budget reached.", 504, "time-limit");
    try {
      const response = await fetchImpl(`${base}${path}`, {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(Math.min(5_000, remaining)),
      });
      if (!response.ok) {
        await response.body?.cancel();
        const rateLimited =
          response.status === 429 ||
          (response.status === 403 &&
            (response.headers.get("x-ratelimit-remaining") === "0" ||
              response.headers.has("retry-after")));
        throw new GitHubScanError(
          rateLimited
            ? "GitHub rate limit reached. Try again later."
            : response.status === 404
              ? "Repository not found or not public."
              : "GitHub could not complete the request.",
          rateLimited ? 429 : response.status === 404 ? 404 : 502,
          rateLimited ? "github-rate-limit" : "github-error",
        );
      }
      return await readBoundedJson(response, maximum);
    } catch (error) {
      if (error instanceof GitHubScanError) throw error;
      throw new GitHubScanError(
        "GitHub request failed or timed out.",
        502,
        "fetch-failed",
      );
    }
  };
}

function validEntry(entry) {
  return (
    typeof entry?.path === "string" &&
    entry.path.length <= 4096 &&
    !entry.path.includes("\\") &&
    !entry.path
      .split("/")
      .some((part) => !part || part === "." || part === "..") &&
    SHA.test(entry.sha ?? "") &&
    ["blob", "tree", "commit"].includes(entry.type)
  );
}

/** Traverse immutable tree IDs. Limits are explicit, never presented as a full scan. */
export async function discoverTree(
  get,
  rootSha,
  { maxEntries = 10_000, maxTreeRequests = 16 } = {},
) {
  if (!SHA.test(rootSha))
    throw new GitHubScanError("GitHub returned an invalid tree identifier.");
  const first = await get(`/git/trees/${rootSha}?recursive=1`);
  if (!Array.isArray(first.tree))
    throw new GitHubScanError("GitHub returned an invalid tree.");
  const entries = new Map();
  const reasons = new Set();
  const add = (entry) => {
    if (!validEntry(entry)) {
      reasons.add("invalid-tree-entry");
      return;
    }
    if (entries.size >= maxEntries && !entries.has(entry.path)) {
      reasons.add("entry-limit");
      return;
    }
    entries.set(entry.path, entry);
  };
  if (!first.truncated) {
    first.tree.forEach(add);
    return {
      entries: [...entries.values()],
      complete: reasons.size === 0,
      reasons: [...reasons],
      treeRequests: 1,
    };
  }

  // GitHub documents non-recursive subtree traversal when recursive results truncate.
  // Do not combine the partial recursive tree with the traversal (double counts).
  const queue = [{ sha: rootSha, prefix: "", ancestors: new Set() }];
  let cursor = 0;
  let treeRequests = 1;
  while (
    cursor < queue.length &&
    entries.size < maxEntries &&
    treeRequests < maxTreeRequests
  ) {
    const task = queue[cursor++];
    let data;
    try {
      treeRequests++;
      data = await get(`/git/trees/${task.sha}`);
    } catch (error) {
      reasons.add(error.reason ?? "tree-fetch-failed");
      break;
    }
    if (!Array.isArray(data.tree)) {
      reasons.add("invalid-tree-response");
      break;
    }
    if (data.truncated) reasons.add("github-tree-truncated");
    for (const entry of data.tree) {
      if (!validEntry(entry) || entry.path.includes("/")) {
        reasons.add("invalid-tree-entry");
        continue;
      }
      const path = task.prefix ? `${task.prefix}/${entry.path}` : entry.path;
      add({ ...entry, path });
      if (entry.type === "tree" && entries.size < maxEntries) {
        if (entry.sha === task.sha || task.ancestors.has(entry.sha)) {
          reasons.add("tree-cycle");
          continue;
        }
        queue.push({
          sha: entry.sha,
          prefix: path,
          ancestors: new Set([...task.ancestors, task.sha]),
        });
      }
    }
  }
  if (cursor < queue.length || entries.size >= maxEntries)
    reasons.add(
      entries.size >= maxEntries ? "entry-limit" : "tree-request-limit",
    );
  return {
    entries: [...entries.values()],
    complete: reasons.size === 0,
    reasons: [...reasons],
    treeRequests,
  };
}

export async function openRepositorySnapshot(get, options) {
  // Fail closed: a server PAT must never grant users access to its private repos.
  const metadata = await get("");
  if (metadata.private !== false)
    throw new GitHubScanError(
      "Only public GitHub repositories are supported.",
      404,
      "not-public",
    );
  const commit = await get("/commits/HEAD");
  if (!SHA.test(commit.sha ?? "") || !SHA.test(commit.commit?.tree?.sha ?? ""))
    throw new GitHubScanError("GitHub returned an invalid commit.");
  const tree = await discoverTree(get, commit.commit.tree.sha, options);
  return {
    metadata,
    commitSha: commit.sha,
    treeSha: commit.commit.tree.sha,
    ...tree,
  };
}

export async function readSnapshotFile(get, entry) {
  if (
    !validEntry(entry) ||
    entry.type !== "blob" ||
    !["100644", "100755"].includes(entry.mode)
  )
    return { reason: "not-regular-file" };
  if (entry.size > MAX_SOURCE_BYTES) return { reason: "file-size-limit" };
  try {
    const data = await get(`/git/blobs/${entry.sha}`, 300_000);
    if (
      data.sha !== entry.sha ||
      data.encoding !== "base64" ||
      typeof data.content !== "string"
    )
      return { reason: "invalid-blob" };
    const encoded = data.content.replace(/\s/g, "");
    if (
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        encoded,
      )
    )
      return { reason: "invalid-encoding" };
    const bytes = Buffer.from(encoded, "base64");
    if (typeof entry.size === "number" && bytes.length !== entry.size)
      return { reason: "blob-size-mismatch" };
    if (bytes.length > MAX_SOURCE_BYTES) return { reason: "file-size-limit" };
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (content.length > MAX_SOURCE_CHARACTERS)
      return { reason: "file-size-limit" };
    if (content.includes("\0")) return { reason: "binary-file" };
    return { content };
  } catch (error) {
    return { reason: error.reason ?? "unreadable-file" };
  }
}

export async function readSnapshotBatch(
  get,
  entries,
  { concurrency = 4 } = {},
) {
  const results = new Array(entries.length);
  let next = 0;
  async function worker() {
    while (next < entries.length) {
      const index = next++;
      results[index] = {
        path: entries[index].path,
        blobSha: entries[index].sha,
        ...(await readSnapshotFile(get, entries[index])),
      };
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.max(1, Math.min(4, concurrency, entries.length)) },
      worker,
    ),
  );
  return results;
}
