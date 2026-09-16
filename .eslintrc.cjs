module.exports = {
  env: { browser: true, es2022: true, webextensions: true },
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  parserOptions: { sourceType: "module" },
  ignorePatterns: ["dist", "node_modules"],
};
