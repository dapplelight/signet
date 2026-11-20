const [modules, ...rest] = require("jest-expo/jest-preset").transformIgnorePatterns

module.exports = {
  preset: "jest-expo",
  setupFiles: ["<rootDir>/jest.setup.js"],
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
  // jest-expo's list, plus Signet's packages: they ship ES modules.
  transformIgnorePatterns: [modules.replace("(?!(", "(?!(@dapplelight|"), ...rest],
}
