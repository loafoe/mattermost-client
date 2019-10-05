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
      'no-unused-vars': 'off',
      'linebreak-style': 'off',
      'arrow-parens': 'off',
      'consistent-return': 'off',
      'class-methods-use-this': 'off'
  },
};
