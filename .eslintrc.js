module.exports = {
    env: {
        browser: true,
        commonjs: true,
        es6: true,
        node: true,
    },
    extends: [
        'airbnb-base',
    ],
    globals: {
        Atomics: 'readonly',
        SharedArrayBuffer: 'readonly',
    },
    parserOptions: {
        ecmaVersion: 2018,
    },
    rules: {
        'indent': [2, 4],
        'no-underscore-dangle': 'off',
        'camelcase': 'off',
        'no-unused-vars': 'off'
    },
    overrides: [
        {
            files: [
                "**/*.test.js",
                "**/*.spec.js",
                "**/*.spec.jsx"
            ],
            env: {
                jest: true
            }
        }
    ]
};
