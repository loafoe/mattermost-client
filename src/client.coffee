https       = require 'https'
querystring = require 'querystring'
WebSocket   = require 'ws'
Log            = require 'log'
{EventEmitter} = require 'events'

User = require './user.coffee'

class Client extends EventEmitter
    constructor: (@host, @group, @email, @password, @options={wssPort: 443}) ->
        @authenticated = false
        @connected = false
        @token = null

        @self = null
        @channels = {}
        @users = {}

        @socketUrl = 'wss://' + @host + (if @options.wssPort? then ':'+ @options.wssPort else ':443') + '/api/v1/websocket'

        @ws = null

        @logger = new Log process.env.MATTERMOST_LOG_LEVEL or 'info'

    login: ->
        @logger.info 'Connecting...'
        @_apiCall 'v1/users/login', {name: @group, email: @email, password: @password}, @_onLogin

    _onLogin: (data, headers) =>
        if data
            if not data.id
                @authenticated = false
                #Reconnect here
            else
                @authenticated = true
                # Continue happy flow here
                @token = headers.token
                @logger.info 'Websocket URL: ' + @socketUrl
                @self = new User @, data
                @emit 'loggedIn', @self
                @connect()
        else
            @emit 'error', data
            @authenticated = false
            # Reconnect here

    connect: ->
        # Set up websocket connection to server
        
    # Private functions
    #

    _apiCall: (method, params, callback) ->
        post_data = JSON.stringify(params)
        options =
            hostname: @host
            method: 'POST'
            path: '/api/' + method
            headers:
                'Content-Type': 'application/json'
                'Content-Length': post_data.length
        req = https.request(options)

        req.on 'response', (res) =>
            buffer = ''
            res.on 'data', (chunk) ->
                buffer += chunk
            res.on 'end', =>
                if callback?
                    if res.statusCode is 200
                        value = JSON.parse(buffer)
                        callback(value, res.headers)
                    else
                        callback({'id': null, 'error': 'API response: '+res.statusCode}, res.headers)

        req.on 'error', (error) =>
            if callback? then callback({'id': null, 'error': error.errno})

        req.write('' + post_data)
        req.end()

module.exports = Client
