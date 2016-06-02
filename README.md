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
| MATTERMOST\_SSL\_NOVERIFY | No | set to 'true' to allow connections when certs can not be verified (ie: self-signed, etc. - MITM risks) |
| MATTERMOST\_LOG\_LEVEL | No | set log level (default=info) |

## Mattermost 3.0

This client always tries to track the latest version of Mattermost.
As verion `3.x` of Mattermost is a major release and introduces backwards incompatible changes make sure you
are using the latest version of this library.

## Older versions

For interaction with Mattermost versions older than `3.0` please use version `1.5.0` of this library.

# TODO

- Write tests
- Implement more API calls
- Support non HTTPS connections

# License

The code is licensed under MIT
