module.exports = {
    collectCoverage: true,
    testResultsProcessor: 'jest-sonar-reporter',
    coveragePathIgnorePatterns: [
        '/node_modules/',
        '/tests/'
    ]
};
