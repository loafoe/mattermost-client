https       = require 'https'
querystring = require 'querystring'
WebSocket   = require 'ws'
Log            = require 'log'
{EventEmitter} = require 'events'
pingInterval = 60000

User = require './user.coffee'
Message = require './message.coffee'

class Client extends EventEmitter
    constructor: (@host, @group, @email, @password, @options={wssPort: 443}) ->
        @authenticated = false
        @connected = false
        @token = null

        @self = null
        @channels = {}
        @users = {}
        @teams = {}

        @ws = null
        @_messageID = 0
        @_pending = {}
        
        @_connAttempts  = 0

        @logger = new Log process.env.MATTERMOST_LOG_LEVEL or 'info'

    login: ->
        @logger.info 'Logging in...'
        @_apiCall 'POST', '/users/login', {name: @group, email: @email, password: @password}, @_onLogin

    _onLogin: (data, headers) =>
        if data
            if not data.id
                @authenticated = false
                @reconnect()
            else
                @authenticated = true
                # Continue happy flow here
                @token = headers.token
                @socketUrl = 'wss://' + @host + (if @options.wssPort? then ':'+ @options.wssPort else ':443') + '/api/v1/websocket'
                @logger.debug 'Websocket URL: ' + @socketUrl
                @self = new User @, data
                @emit 'loggedIn', @self
                # Load userlist
                @_apiCall 'GET', '/users/profiles', null, @_onProfiles
                @_apiCall 'GET', '/channels/', null, @_onChannels
                @_apiCall 'GET', '/teams/me', null, @_onTeams
                @connect()
        else
            @emit 'error', data
            @authenticated = false
            @reconnect()

    _onTeams: (data, headers) =>
        if data
            @teams = data
            @logger.debug 'Found '+Object.keys(@teams).length+' teams.'
        else
            @logger.error 'Failed to load teams from server.'
            @emit 'error', { msg: 'failed to load teams.' }

    _onProfiles: (data, headers) =>
        if data
            @users = data
            @logger.debug 'Found '+Object.keys(@users).length+' profiles.'
        else
            @logger.error 'Failed to load profiles from server.'
            @emit 'error', { msg: 'failed to load profiles'}
    
    _onChannels: (data, headers) =>
        if data
            @channels = data.members
            @logger.debug 'Found '+Object.keys(@channels).length+' channels.'
            @channel_details = data.channels
        else
            @logger.error 'Failed to get subscribed channels list from server.'
            @emit 'error', { msg: 'failed to get channel list'}

    connect: ->
        @logger.info 'Connecting...'
        options =
            headers: {authorization: "BEARER " + @token}

        # Set up websocket connection to server
        @ws = new WebSocket @socketUrl, options

        @ws.on 'error', (error) =>
            @emit 'error', error

        @ws.on 'open', =>
            @connected = true
            @emit 'connected'
            @_connAttempts = 0
            @_lastPong = Date.now()
            @_pongTimeout = setInterval =>
                if not @connected then return

                @logger.debug 'ping'
                @_send {"action": "ping"}
                if @_lastPong? and Date.now() - @_lastPong > (2*pingInterval)
                    @logger.error "Last pong is too old: %d", (Date.now() - @_lastPong) / 1000
                    @authenticated = false
                    @connected = false
                    @reconnect()
            , pingInterval

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
        m = new Message @, message
        switch message.action
            when 'ping'
                @logger.debug 'ACK ping'
                @_lastPong = Date.now()
                @emit 'ping'
            when 'posted'
                @emit 'message', m
            when 'typing', 'post_edit', 'post_deleted', 'user_added', 'user_removed'
                # Generic hadler
                @emit message.action, message
            when 'channel_viewed', 'preference_changed', 'ephemeral_message'
                # These are personal messages
                @emit message.action, message
            when 'new_user'
                # Reload all users for now as, /users/profiles/{id} gives us a 403 currently
                @_apiCall 'GET', '/users/profiles', null, @_onProfiles
                @emit 'new_user', message
            else
                @logger.debug 'Received unhandled message type: '+message.action
                @logger.debug message

    getUserByID: (id) ->
        @users[id]

    getUserByEmail: (email) ->
        for u of @users
            if @users[u].email == email
                return @users[u]

    getChannelByID: (id) ->
        @channels[id]

    postMessage: (msg, channelID) ->
        postData =
            message: msg
            filenames: []
            create_at: Date.now()
            user_id: @self.id
            channel_id: channelID

        @_apiCall 'POST', '/channels/' + channelID + '/create', postData, (data, header) =>
            @logger.debug 'Posted message.'
            return true


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


    _apiCall: (method, path, params, callback) ->
        post_data = ''
        post_data = JSON.stringify(params) if params?
        options =
            hostname: @host
            method: method
            path: '/api/v1' + path
            headers:
                'Content-Type': 'application/json'
                'Content-Length': post_data.length
        options.headers['Authorization'] = 'BEARER '+@token if @token

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
