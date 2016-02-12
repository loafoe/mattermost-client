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
        @_messageID = 0
        @_pending = {}
        
        @_connAttempts  = 0

        @logger = new Log process.env.MATTERMOST_LOG_LEVEL or 'info'

    login: ->
        @logger.info 'Logging in...'
        @_apiCall '/users/login', {name: @group, email: @email, password: @password}, @_onLogin

    _onLogin: (data, headers) =>
        if data
            if not data.id
                @authenticated = false
                @reconnect()
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
            @reconnect()

    connect: ->
        @logger.info 'Connecting...'
        options =
            headers: {authorization: "BEARER " + @token}

        @logger.info 'Opening WebSocket: ' + JSON.stringify(options)
        # Set up websocket connection to server
        @ws = new WebSocket @socketUrl, options

        @ws.on 'error', (error) =>
            @emit 'error', error

        @ws.on 'open', =>
            @_connAttempts = 0
            @_lastPong = Date.now()
            @_pongTimeout = setInterval =>
                if not @connected then return

                @logger.debug 'ping'
                @_send {"type": "ping"}
                if @_lastPong? and Date.now() - @_lastPong > 10000
                    @logger.error "Last pong is too old: %d", (Date.now() - @_lastPong) / 1000
                    @authenticated = false
                    @connected = false
                    @reconnect()
            , 5000

        @ws.on 'message', (data, flags) =>
            @onMessage JSON.parse(data)

        @ws.on 'close', (code, message) =>
            @emit 'close', code, message
            @connected = false
            @socketUrl = null

        return true

    reconnect: ->
        if @_pongTimeout
            clearInterval @_pongTimeout
            @_pongTimeout = null
        @authenticated = false

        if @ws
            @ws.close()
        
        @_connAttempts++
        
        timeout = @_connAttempts * 1000
        @logger.info "Reconnecting in %dms", timeout
        setTimeout =>
            @logger.info 'Attempting reconnect'
            @login()
        , 5000


    disconnect: ->
        if not @connected
            return false
        else
            @autoReconnect = false
            if @_pongTimeout
                clearInterval @_pongTimeout
                @_pongTimeout = null
            @ws.close()
            return true

    onMessage: (message) ->
        @emit 'raw_message', message

        switch message.action
            when "blaat"
                @emit "blaat"
            else
                @logger.info 'Received message type: '+message.action
                @logger.info message

    # Private functions
    #
    _send: (message) ->
        if not @connected
            return false
        else
            message.id = ++@_messageID
            @_pending[message.id] = message
            @ws.send JSON.stringify(message)
            return message


    _apiCall: (method, params, callback) ->
        post_data = JSON.stringify(params)
        options =
            hostname: @host
            method: 'POST'
            path: '/api/v1' + method
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
