module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/apps", "<rootDir>/packages"],
  testMatch: ["**/*.spec.ts"],
  moduleNameMapper: {
    "^@tracking-auto/(.*)$": "<rootDir>/packages/$1/src",
  },
  // This repo has many Nest/ts-jest suites and a large embedded-font module.
  // Uncapped workers on a high-core host can exhaust memory and spawn dozens
  // of node processes during `npm test`.
  maxWorkers: 4,
  workerIdleMemoryLimit: "2GB",
};
