import * as core from "@actions/core";
import * as fs from "fs";
import path from "path";
import { minimatch } from "minimatch";

/**
 * find packages in subfolders that contain a package.json
 * @param currentPath the path to start searching
 * @param ignoreFolders folders to ignore
 * @param checkRootFolder if true, the root folder is also checked
 * @returns an array of paths to folders that contain a package.json file
 */
function findPackageJsonFolders(currentPath: string, ignoreFolders: string[], checkRootFolder: boolean): string[] {
  const dirents = fs.readdirSync(currentPath, { withFileTypes: true });
  const foundFolders: string[] = [];

  if (checkRootFolder) {
    const packageRootJsonPath = path.join(currentPath, "package.json");
    try {
      fs.accessSync(packageRootJsonPath);
      foundFolders.push(currentPath);
    } catch {
      // no package.json in root folder
    }
  }

  for (const dirent of dirents) {
    const fullPath = path.join(currentPath, dirent.name);
    if (dirent.isDirectory()) {
      if (fullPath.includes("node_modules") || dirent.name.startsWith(".")) {
        continue;
      }

      if (ignoreFolders.some((folder) => minimatch(dirent.name, folder))) {
        core.info(`Skipping folder: ${fullPath} due ignoreFolders setting`);
        continue;
      }

      let packageJsonPath = path.join(fullPath, "package.json");
      packageJsonPath = path.resolve(packageJsonPath);

      try {
        fs.accessSync(packageJsonPath);
      } catch {
        // package.json does not exist in the directory
        continue;
      }

      foundFolders.push(fullPath);
    }
  }
  return foundFolders;
}

/**
 * find folders that contain *.csproj files
 * @param currentPath the path to start searching
 * @param ignoreFolders folders to ignore
 * @returns an array of paths to folders that contain a *.csproj file
 */
function findCsProjectFolders(currentPath: string, ignoreFolders: string[]): string[] {
  const dirents = fs.readdirSync(currentPath, { withFileTypes: true });
  const foundFolders: string[] = [];
  for (const dirent of dirents) {
    const fullPath = path.join(currentPath, dirent.name);
    if (dirent.isDirectory()) {
      if (fullPath.includes("node_modules") || dirent.name.startsWith(".")) {
        continue;
      }

      if (ignoreFolders.some((folder) => minimatch(dirent.name, folder))) {
        core.info(`Skipping folder: ${fullPath} due ignoreFolders setting`);
        continue;
      }

      const files = fs.readdirSync(fullPath);
      const csprojExists = files.some((file) => file.endsWith(".csproj"));

      if (csprojExists) {
        foundFolders.push(fullPath);
      }
    }
  }
  return foundFolders;
}

export { findPackageJsonFolders, findCsProjectFolders };
