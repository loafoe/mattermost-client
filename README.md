# Mattermost-client

Mattermost client which uses the Web API and websockets

# Features

The client was primarily written for use by the [Matteruser](https://github.com/loafoe/hubot-matteruser) Hubot adapter.
The initial implementation thus contains only the minimal set of API calls to support this. Pull requests to expand API support are very welcome!

## Highlights

- Logs into Mattermost team server with username and password
- Connects via websocket for real-time interaction
- Can post messages to joined channels
- Can be invited to channels / DMs since its just a regular user
- Initiate DMs to users

## Environment variables

The following environment variables may be defined to alter behavior:

| Variable | Required | Description |
|----------|----------|-------------|
| MATTERMOST\_TLS\_VERIFY | No | (default: true) set to 'false' to allow connections when certs can not be verified (ex: self-signed, internal CA, ... - MITM risks) |
| MATTERMOST\_LOG\_LEVEL | No | (default: info) set log level (also: debug, ...) |
| MATTERMOST\_USE\_TLS | No | (default: true) set to 'false' to use http/ws instead of https/wss |

## Mattermost 3.6

This client always tries to track the latest version of Mattermost.
As version `3.6` of Mattermost might introduce backwards incompatible API changes make sure you are using the latest version of this library.

## Older versions of Mattermost

For interaction with Mattermost versions please use version of the library matching the Mattermost version

# TODO

- Write tests
- Implement more API calls

# License

The code is licensed under MIT
