import { auth } from "@/lib/firebase";

const maxFiles = 20;
const maxFileContentLength = 3000;

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

async function fetchFromGitHubProxy(parameters) {
  const currentUser = auth.currentUser;

  if (!currentUser) {
    throw new Error("Authentication required.");
  }

  const idToken = await currentUser.getIdToken();
  const searchParameters = new URLSearchParams(parameters);
  const response = await fetch(`/api/github?${searchParameters}`, {
    headers: {
      Authorization: `Bearer ${idToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`GitHub request failed with status ${response.status}.`);
  }

  return response.json();
}

export async function fetchRepoTree(repoUrl) {
  const { username, reponame } = parseRepoUrl(repoUrl);
  const data = await fetchFromGitHubProxy({
    action: "tree",
    username,
    reponame,
  });

  return (data.tree ?? [])
    .filter((entry) => entry.type === "blob" && typeof entry.path === "string")
    .map((entry) => entry.path);
}

export function filterImportantFiles(tree) {
  if (!Array.isArray(tree)) return [];

  const excludedFolders = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    "coverage",
  ]);
  const codeExtensions = new Set([
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".py",
    ".java",
    ".cpp",
    ".c",
  ]);
  const imageExtensions = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".svg",
    ".ico",
  ]);

  return tree
    .map((entry) => (typeof entry === "string" ? entry : entry?.path))
    .filter((filePath) => typeof filePath === "string" && filePath.length > 0)
    .filter((filePath) => {
      const normalizedPath = filePath.replaceAll("\\", "/");
      const segments = normalizedPath.toLowerCase().split("/");
      const filename = segments.at(-1);
      const extensionIndex = filename.lastIndexOf(".");
      const extension = extensionIndex >= 0 ? filename.slice(extensionIndex) : "";
      const isCriticalCss =
        extension === ".css" &&
        /^(app|critical|global|globals|main|style|styles)\.css$/i.test(filename);

      if (segments.some((segment) => excludedFolders.has(segment))) return false;
      if (
        filename === "package-lock.json" ||
        filename === "yarn.lock" ||
        filename === ".env" ||
        filename.startsWith(".env.") ||
        imageExtensions.has(extension) ||
        extension === ".md"
      ) {
        return false;
      }

      if (extension === ".json") return filename === "package.json";
      return codeExtensions.has(extension) || isCriticalCss;
    })
    .map((filePath) => {
      const normalizedPath = filePath.replaceAll("\\", "/");
      const lowerPath = normalizedPath.toLowerCase();
      const filename = lowerPath.split("/").at(-1);
      const nameWithoutExtension = filename.replace(/\.[^.]+$/, "");
      let score = 0;

      if (/(index|main|app|page)/.test(nameWithoutExtension)) score += 3;
      if (/(^|\/)(src|app|lib|services|components)\//.test(lowerPath)) {
        score += 2;
      }
      if (/(^|\/)(utils|helpers|hooks)\//.test(lowerPath)) score += 1;

      return { path: normalizedPath, score };
    })
    .sort((first, second) =>
      second.score - first.score || first.path.localeCompare(second.path),
    )
    .slice(0, maxFiles)
    .map(({ path }) => path);
}

export async function fetchFileContent(username, reponame, filePath) {
  try {
    const data = await fetchFromGitHubProxy({
      action: "file",
      username,
      reponame,
      filePath,
    });

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
  const data = await fetchFromGitHubProxy({
    action: "metadata",
    username,
    reponame,
  });

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
