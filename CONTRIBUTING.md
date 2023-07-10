## Contributing

Like any other open source projects, there are multiple ways to contribute to this project:

* As a developer, depending on your skills and experience,
* As a user who enjoys the project and wants to help.

##### Reporting Bugs

If you found something broken or not working properly, feel free to create an issue in Github with as much information as possible, such as logs and how to reproduce the problem. Before opening the issue, make sure that:

* You have read this documentation,
* You are using the latest version of project,
* You already searched other issues to see if your problem or request was already reported.

##### Improving the Documentation

You can improve this documentation by forking its repository, updating the content and sending a pull request.


#### We ❤️ Pull Requests

A pull request does not need to be a fix for a bug or implementing something new. Software can always be improved, legacy code removed and tests are always welcome!

Please do not be afraid of contributing code, make sure it follows these rules:

* Your code compiles, does not break any of the existing code in the master branch and does not cause conflicts,
* The code is readable and has comments, that aren’t superfluous or unnecessary,
* An overview or context is provided as body of the Pull Request. It does not need to be too extensive.

Extra points if your code comes with tests!


### Build artefact

This project uses `yarn` for building, which can be installed via: 

```shell
npm install --global yarn
```

Then you need to install yarn in the repo by running this in the root of the project:

```shell
yarn install
```

You can then choose to build the dev-version with:

```shell
yarn build:dev 
```

In case you want to build the packed 1-line version, you need to run:

```shell
yarn build:prod
```

This will create the file `./dist/mattermost-client.js`. Every time you have made changes to the mattermost-client, you need to rerun that last command.

To start the implementation of the call, just start an issue, tell your intentions and assign to yourself. Thanks in advance of making this project better!

# Testing

Testing is done using `jest`.

Best to read this document, to understand how jest works. https://jestjs.io/docs/getting-started

The tests are all in `tests/client.test.js`. They all have a generic build up. It needs a dummy mattermost-installation available under `test.foo.bar` - easiest is to use Docker for that. *Some words on how to set up this local Docker easily.*
