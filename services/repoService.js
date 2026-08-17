import { auth } from "@/lib/firebase";
import {
  filterImportantFiles,
  getFullFileTree,
} from "@/lib/repoTree";

const maxFileContentLength = 3000;

export { filterImportantFiles, getFullFileTree };

function parseRepoUrl(repoUrl) {
  const url = new URL(repoUrl);

  if (url.hostname.toLowerCase() !== "github.com") {
    throw new Error("The repository URL must use github.com.");
  }

  const [username, rawRepositoryName] = url.pathname
    .split("/")
    .filter(Boolean);
  const reponame = rawRepositoryName?.replace(/\.git$/i, "");

  if (!username || !reponame) {
    throw new Error("The GitHub URL must include an owner and repository name.");
  }

  return { username, reponame };
}

async function fetchFromGitHubProxy(url, type) {
  const currentUser = auth.currentUser;

  if (!currentUser) {
    throw new Error("Authentication required.");
  }

  const idToken = await currentUser.getIdToken();
  const response = await fetch("/api/github", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url, type }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`GitHub request failed with status ${response.status}.`);
  }

  return response.json();
}

export async function fetchRepoTree(repoUrl) {
  const { username, reponame } = parseRepoUrl(repoUrl);
  const url = `https://api.github.com/repos/${encodeURIComponent(username)}/${encodeURIComponent(reponame)}/git/trees/HEAD?recursive=1`;
  const data = await fetchFromGitHubProxy(url, "tree");

  return (data.tree ?? [])
    .filter((entry) => entry.type === "blob" && typeof entry.path === "string")
    .map((entry) => entry.path);
}

export async function fetchFileContent(username, reponame, filePath) {
  try {
    const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
    const url = `https://api.github.com/repos/${encodeURIComponent(username)}/${encodeURIComponent(reponame)}/contents/${encodedPath}`;
    const data = await fetchFromGitHubProxy(url, "content");

    if (data.type !== "file" || typeof data.content !== "string") return null;

    const binaryContent = globalThis.atob(data.content.replace(/\s/g, ""));
    const bytes = Uint8Array.from(binaryContent, (character) =>
      character.charCodeAt(0),
    );

    return new TextDecoder("utf-8")
      .decode(bytes)
      .slice(0, maxFileContentLength);
  } catch {
    return null;
  }
}

export async function fetchRepoMetadata(username, reponame) {
  const url = `https://api.github.com/repos/${encodeURIComponent(username)}/${encodeURIComponent(reponame)}`;
  const data = await fetchFromGitHubProxy(url, "metadata");

  return {
    name: data.name,
    description: data.description,
    language: data.language,
    stars: data.stargazers_count,
    forks: data.forks_count,
    size: data.size,
    default_branch: data.default_branch,
  };
}
