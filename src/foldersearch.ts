import * as core from "@actions/core";
import * as fs from "fs";
import * as path from "path";

/**
 *
 * @param currentPath
 * @param ignoreFolders
 */
async function findPackageJsonFolders(currentPath: string, ignoreFolders: string[]): Promise<string[]> {
  const dirents = fs.readdirSync(currentPath, { withFileTypes: true });
  const foundFolders: string[] = [];
  for (const dirent of dirents) {
    const fullPath = path.join(currentPath, dirent.name);
    if (dirent.isDirectory()) {
      if (fullPath.includes("node_modules") || dirent.name.startsWith(".")) {
        continue;
      }

      if (ignoreFolders.some((folder) => dirent.name.startsWith(folder))) {
        core.info(`Skipping folder: ${fullPath} due ignoreFolders setting`);
        continue;
      }

      let packageJsonPath = path.join(fullPath, "package.json");
      packageJsonPath = await path.resolve(packageJsonPath);

      try {
        fs.accessSync(packageJsonPath);
      } catch (error) {
        // package.json does not exist in the directory
        continue;
      }

      foundFolders.push(fullPath);
    }
  }
  return foundFolders;
}

export { findPackageJsonFolders };
