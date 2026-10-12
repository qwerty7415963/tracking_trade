module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/apps", "<rootDir>/packages"],
  testMatch: ["**/*.spec.ts"],
  moduleNameMapper: {
    "^@tracking-auto/(.*)$": "<rootDir>/packages/$1/src",
  },
};
