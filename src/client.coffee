https       = require 'https'
querystring = require 'querystring'
WebSocket   = require 'ws'
TextEncoder = require 'text-encoding'
Log            = require 'log'
{EventEmitter} = require 'events'
defaultPingInterval = 60000

User = require './user.coffee'
Message = require './message.coffee'

apiPrefix = '/api/v3'
usersRoute = '/users'
teamsRoute = '/teams'

class Client extends EventEmitter
    constructor: (@host, @group, @email, @password, @options={wssPort: 443}) ->
        @authenticated = false
        @connected = false
        @token = null

        @self = null
        @channels = {}
        @users = {}
        @teams = {}
        @teamID = null

        @ws = null
        @_messageID = 0
        @_pending = {}
        @_pingInterval = if @options.pingInterval? then @options.pingInterval else defaultPingInterval
        @autoReconnect = if @options.autoReconnect? then @options.autoReconnect else true
        @_connecting = false
        @_reconnecting = false

        @_connAttempts  = 0

        @logger = new Log process.env.MATTERMOST_LOG_LEVEL or 'info'

    login: ->
        @logger.info 'Logging in...'
        @_apiCall 'POST', usersRoute + '/login', {login_id: @email, password: @password}, @_onLogin

    _onLogin: (data, headers) =>
        if data
            if not data.id
                @logger.error 'Login call failed'
                @authenticated = false
                @_reconnecting = false
                @reconnect()
            else
                @authenticated = true
                # Continue happy flow here
                @token = headers.token
                @socketUrl = 'wss://' + @host + (if @options.wssPort? then ':'+ @options.wssPort else ':443') + apiPrefix + usersRoute + '/websocket'
                @logger.info 'Websocket URL: ' + @socketUrl
                @self = new User @, data
                @emit 'loggedIn', @self
                @getInitialLoad()
        else
            @emit 'error', data
            @authenticated = false
            @reconnect()

    _onInitialLoad: (data, headers) =>
        if data
            @teams = data.teams
            @logger.debug 'Found '+Object.keys(@teams).length+' teams.'
            for t in @teams
                @logger.debug "Testing #{t.name} == #{@group}"
                if t.name == @group
                    @logger.debug "Found team! #{t.id}"
                    @teamID = t.id
                    break
            @preferences = data.preferences
            @config = data.client_cfg
            @loadUsersList()
            @connect()
        else
            @logger.error 'Failed to load teams from server.'
            @emit 'error', { msg: 'failed to load teams.' }

    _onProfiles: (data, headers) =>
        if data
            @users = data
            @logger.debug 'Found '+Object.keys(@users).length+' profiles.'
            @emit 'profilesLoaded', { profiles: @users }
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

    channelRoute: (channelId) ->
        @teamRoute() + '/channels/' + channelId

    teamRoute: ->
        teamsRoute + '/' + @teamID

    getInitialLoad: ->
        @_apiCall 'GET', usersRoute + '/initial_load', null, @_onInitialLoad

    loadUsersList: ->
        # Load userlist
        @_apiCall 'GET', usersRoute + '/profiles/' + @teamID, null, @_onProfiles
        @_apiCall 'GET', @channelRoute(''), null, @_onChannels


    connect: ->
        if @_connecting
            return
        @_connecting = true
        @logger.info 'Connecting...'
        options =
            headers: {authorization: "BEARER " + @token}

        # Set up websocket connection to server
        @ws = new WebSocket @socketUrl, options

        @ws.on 'error', (error) =>
            @emit 'error', error

        @ws.on 'open', =>
            @_connecting = false
            @_reconnecting = false
            @connected = true
            @emit 'connected'
            @_connAttempts = 0
            @_lastPong = Date.now()
            @logger.info 'Starting pinger...'
            @_pongTimeout = setInterval =>
                if not @connected
                    @logger.error 'Not connected in pongTimeout'
                    @reconnect()
                    return
                if @_lastPong? and (Date.now() - @_lastPong) > (2*@_pingInterval)
                    @logger.error "Last pong is too old: %d", (Date.now() - @_lastPong) / 1000
                    @authenticated = false
                    @connected = false
                    @reconnect()
                else
                    @logger.info 'ping'
                    @_send {"action": "ping"}
            , @_pingInterval

        @ws.on 'message', (data, flags) =>
            @onMessage JSON.parse(data)

        @ws.on 'close', (code, message) =>
            @emit 'close', code, message
            @connected = false
            @socketUrl = null
            if @autoReconnect
                @reconnect()
        return true

    reconnect: ->
        if @_reconnecting
            return
        @_reconnecting = true
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
        , timeout


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
                @logger.info 'ACK ping'
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
                @_apiCall 'GET', usersRoute + '/profiles/' + @teamID, null, @_onProfiles
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

    getUserDirectMessageChannel: (userID, callback) ->
        postData =
            user_id: userID
        @_apiCall 'POST', '/channels/create_direct', postData, (data, headers) =>
            @logger.debug 'Requested new DM channel for user ' + userID + '.'

            # If there's no error, return the new DM channel ID
            unless data.error
                return callback({'id': data.id}, {})

            # Mattermost throws an error if a DM channel already exists
            # We can look through all the channels and find the one that only
            # contains us and the target user and has a total of 2 members
            for channel, details of @getAllChannels()
                @getChannelInfo channel, 2, (info) =>
                    return if info.member_count is not 2
                    for member in info.members
                        if member.id is userID
                            callback({'id': info.id}, {})

    getChannelInfo: (channelID, memberLimit, callback) ->
        @_apiCall 'GET', '/channels/' + channelID + '/extra_info/' + memberLimit, null, (data, header) =>
            callback(data)

    getAllChannels: ->
        @channels

    getChannelByID: (id) ->
        @channels[id]

    customMessage: (postData, channelID) ->
        @_apiCall 'POST', @channelRoute(channelID) + '/posts/create', postData, (data, header) =>
            @logger.debug 'Posted custom message.'
            return true

    postMessage: (msg, channelID) ->
        postData =
            message: msg
            filenames: []
            create_at: Date.now()
            user_id: @self.id
            channel_id: channelID

        @_apiCall 'POST', @channelRoute(channelID) + '/posts/create', postData, (data, header) =>
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
            path: apiPrefix + path
            headers:
                'Content-Type': 'application/json'
                'Content-Length': new TextEncoder.TextEncoder('utf-8').encode(post_data).length
        options.headers['Authorization'] = 'BEARER '+@token if @token
        @logger.debug "#{method} #{path}"
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
            if callback? then callback({'id': null, 'error': error.errno}, {})

        req.write('' + post_data)
        req.end()

module.exports = Client
