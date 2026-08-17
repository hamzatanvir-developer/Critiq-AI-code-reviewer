const SOURCE_LANGUAGES = {
  ".js": "JavaScript",
  ".jsx": "React",
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".py": "Python",
  ".java": "Java",
  ".cpp": "C++",
  ".c": "C",
};

function pathFromEntry(entry) {
  return typeof entry === "string" ? entry : entry?.path;
}

function normalizedPath(entry) {
  const path = pathFromEntry(entry);
  return typeof path === "string" ? path.replaceAll("\\", "/") : null;
}

function isInFolder(path, folders) {
  return path
    .toLowerCase()
    .split("/")
    .slice(0, -1)
    .some((segment) => folders.includes(segment));
}

function extensionOf(path) {
  const filename = path.split("/").at(-1)?.toLowerCase() ?? "";
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex === -1 ? "" : filename.slice(dotIndex);
}

export function getFileLanguage(path) {
  if (path.toLowerCase().endsWith("/package.json") || path.toLowerCase() === "package.json") {
    return "JavaScript";
  }
  return SOURCE_LANGUAGES[extensionOf(path)] ?? null;
}

export function filterImportantFiles(tree) {
  if (!Array.isArray(tree)) return [];

  return tree
    .map(normalizedPath)
    .filter(Boolean)
    .map((path) => {
      const lowerPath = path.toLowerCase();
      const filename = lowerPath.split("/").at(-1);
      const isPackageJson = filename === "package.json";
      let score = 0;

      if (isInFolder(lowerPath, ["node_modules", "dist", "build", ".next"])) score -= 100;
      if (filename === ".env" || filename?.startsWith(".env.")) score -= 100;
      if (filename?.endsWith(".min.js") || filename?.endsWith(".bundle.js")) score -= 50;
      if (isInFolder(lowerPath, ["tests", "__tests__", "spec"])) score -= 5;

      if (["index.js", "main.js", "app.js", "server.js"].includes(filename)) score += 10;
      if (isPackageJson) score += 8;
      if (isInFolder(lowerPath, ["src", "app", "lib", "core"])) score += 5;
      if (isInFolder(lowerPath, ["services", "controllers", "models"])) score += 4;
      if (isInFolder(lowerPath, ["utils", "helpers", "hooks"])) score += 3;
      if (isInFolder(lowerPath, ["components"])) score += 2;

      return {
        path,
        score,
        supported: Boolean(getFileLanguage(path)),
        excluded:
          score <= -50 || isInFolder(lowerPath, ["tests", "__tests__", "spec"]),
      };
    })
    .filter((file) => file.supported && !file.excluded)
    .sort(
      (first, second) =>
        second.score - first.score || first.path.localeCompare(second.path),
    )
    .slice(0, 20)
    .map(({ path }) => path);
}

export function getFullFileTree(tree) {
  if (!Array.isArray(tree)) {
    return {
      totalFiles: 0,
      analyzableFiles: 0,
      skippedFiles: 0,
      structure: {},
      languages: {},
    };
  }

  const paths = tree
    .filter((entry) => typeof entry === "string" || !entry?.type || entry.type === "blob")
    .map(normalizedPath)
    .filter(Boolean);
  const structure = {};
  const languages = {};
  let analyzableFiles = 0;

  for (const path of paths) {
    const segments = path.split("/");
    const filename = segments.pop();
    const folder = segments.join("/") || "(root)";
    (structure[folder] ??= []).push(filename);

    const language = SOURCE_LANGUAGES[extensionOf(path)];
    if (language) {
      analyzableFiles += 1;
      languages[language] = (languages[language] ?? 0) + 1;
    }
  }

  for (const files of Object.values(structure)) files.sort();

  return {
    totalFiles: paths.length,
    analyzableFiles,
    skippedFiles: paths.length - analyzableFiles,
    structure: Object.fromEntries(
      Object.entries(structure).sort(([first], [second]) => first.localeCompare(second)),
    ),
    languages: Object.fromEntries(
      Object.entries(languages).sort(([first], [second]) => first.localeCompare(second)),
    ),
  };
}
