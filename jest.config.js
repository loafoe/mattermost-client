module.exports = {
    collectCoverage: true,
    testResultsProcessor: 'jest-sonar-reporter',
    testEnvironment: 'node',
    coveragePathIgnorePatterns: [
        '/node_modules/',
        '/tests/'
    ]
};
