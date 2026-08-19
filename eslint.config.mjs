import neolutionEslintConfig from "@neolution-ch/eslint-config-neolution";

export default [
  {
    // Release/CI helpers, not part of the action bundle. generate-dependabot-changeset.mjs is
    // vendored from the neolution-ch release playbook and kept byte-identical so it can be re-synced.
    ignores: ["scripts/**"],
  },
  ...neolutionEslintConfig.configs.flat.typescript,
];
