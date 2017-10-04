request     = require 'request'
querystring = require 'querystring'
WebSocket   = require 'ws'
TextEncoder = require 'text-encoding'
Log            = require 'log'
{EventEmitter} = require 'events'
HttpsProxyAgent = require 'https-proxy-agent'
defaultPingInterval = 60000

User = require './user.coffee'
Message = require './message.coffee'

apiPrefix = '/api/v4'
usersRoute = '/users'
messageMaxRunes = 4000

tlsverify = !(process.env.MATTERMOST_TLS_VERIFY or '').match(/^false|0|no|off$/i)
useTLS = !(process.env.MATTERMOST_USE_TLS or '').match(/^false|0|no|off$/i)

class Client extends EventEmitter
    constructor: (@host, @group, @email, @password, @options={wssPort: 443, httpPort: 80}) ->
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
        @httpProxy = if @options.httpProxy? then @options.httpProxy else false
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
                @socketUrl = (if useTLS then 'wss://' else 'ws://') + @host + (if (useTLS and @options.wssPort?) then ':'+@options.wssPort else '') + '/api/v4/websocket'
                @logger.info 'Websocket URL: ' + @socketUrl
                @self = new User data
                @emit 'loggedIn', @self
                @getMe()
                @getPreferences()
                @getTeams()
        else
            @emit 'error', data
            @authenticated = false
            @reconnect()

    _onLoadUsers: (data, headers, params) =>
        if data && not data.error
            for user in data
              @users[user.id] = user
            @logger.info 'Found '+Object.keys(data).length+' profiles.'
            @emit 'profilesLoaded', data
            if Object.keys(data).length > 0 && params.page?
              @loadUsers(params.page+1) # Trigger next page loading
        else
            @logger.error 'Failed to load profiles from server.'
            @emit 'error', { msg: 'failed to load profiles'}

    _onLoadUser: (data, headers, params) =>
        if data && not data.error
          @users[data.id] = data
          @emit 'profilesLoaded', [data]

    _onChannels: (data, headers, params) =>
        if data && not data.error
            for channel in data
              @channels[channel.id] = channel
            @logger.info 'Found '+Object.keys(data).length+' subscribed channels.'
            @emit 'channelsLoaded', data
        else
            @logger.error 'Failed to get subscribed channels list from server: ' + data.error
            @emit 'error', { msg: 'failed to get channel list'}

    _onPreferences: (data, headers, params) =>
        if data && not data.error
            @preferences = data
            @emit 'preferencesLoaded', data
            @logger.info 'Loaded Preferences...'
        else
            @logger.error 'Failed to load Preferences...' + data.error
            @reconnect()

    _onMe: (data, headers, params) =>
        if data && not data.error
            @me = data
            @emit 'meLoaded', data
            @logger.info 'Loaded Me...'
        else
            @logger.error 'Failed to load Me...' + data.error
            @reconnect()

    _onTeams: (data, headers, params) =>
        if data && not data.error
            @teams = data
            @emit 'teamsLoaded', data
            @logger.info 'Found '+Object.keys(@teams).length+' teams.'
            for t in @teams
                @logger.debug "Testing #{t.name} == #{@group}"
                if t.name.toLowerCase() == @group.toLowerCase()
                    @logger.info "Found team! #{t.id}"
                    @teamID = t.id
                    break
            @loadUsers()
            @loadChannels()
            @connect() # FIXME

    channelRoute: (channelId) ->
        @teamRoute() + '/channels/' + channelId

    teamRoute: ->
        usersRoute + '/me/teams/' + @teamID

    getMe: ->
        uri = usersRoute + '/me'
        @logger.info 'Loading ' + uri
        @_apiCall 'GET', uri, null, @_onMe

    getPreferences: ->
        uri = usersRoute + '/me/preferences'
        @logger.info 'Loading ' + uri
        @_apiCall 'GET', uri, null, @_onPreferences

    getTeams: ->
        uri = usersRoute + '/me/teams'
        @logger.info 'Loading ' + uri
        @_apiCall 'GET', uri, null, @_onTeams

    loadUsers: (page = 0) ->
        uri =  "/users?page=#{page}&per_page=200&in_team=#{@teamID}"
        @logger.info 'Loading ' + uri
        @_apiCall 'GET', uri, null, @_onLoadUsers, { page: page }

    loadUser: (user_id) ->
        uri = "/users/#{user_id}"
        @logger.info 'Loading ' + uri
        @_apiCall 'GET', uri, null, @_onLoadUser, {}

    loadChannels: (page = 0) ->
        uri = "/users/me/teams/#{@teamID}/channels"
        @logger.info 'Loading ' + uri
        @_apiCall 'GET', uri, null, @_onChannels


    connect: ->
        if @_connecting
            return
        @_connecting = true
        @logger.info 'Connecting...'
        options =
            rejectUnauthorized: tlsverify

        options.agent = new HttpsProxyAgent(@httpProxy) if @httpProxy

        # Set up websocket connection to server
        if @ws
            @ws.close()
            @ws = null
        @ws = new WebSocket @socketUrl, options

        @ws.on 'error', (error) =>
            @_connecting = false
            @emit 'error', error

        @ws.on 'open', =>
            @_connecting = false
            @_reconnecting = false
            @connected = true
            @emit 'connected'
            @_connAttempts = 0
            @_lastPong = Date.now()
            challenge = {
              "action": "authentication_challenge",
              "data": {
                "token": @token
              }
            }
            @logger.info 'Sending challenge...'
            @_send challenge
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
            @_connecting = false
            @connected = false
            @socketUrl = null
            if @autoReconnect
                @reconnect()
        return true

    reconnect: ->
        if @_reconnecting
            @logger.info 'WARNING: Already reconnecting.'
        @_connecting = false
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
        m = new Message message
        switch message.event
            when 'ping'
                # Deprecated
                @logger.info 'ACK ping'
                @_lastPong = Date.now()
                @emit 'ping', message
            when 'posted'
                @emit 'message', m
            when 'hello', 'typing', 'post_edit', 'post_deleted', 'user_added', 'user_removed', 'status_change'
                # Generic handler
                @emit message.event, message
            when 'channel_viewed', 'preference_changed', 'ephemeral_message'
                # These are personal messages
                @emit message.event, message
            when 'new_user'
                @loadUser(message.data.user_id)
                @emit 'new_user', message
            else
                # Check for `pong` response
                if message.data?.text? and message.data.text == "pong"
                    @logger.info 'ACK ping (2)'
                    @_lastPong = Date.now()
                    @emit 'ping', message
                else
                    @logger.debug 'Received unhandled message:'
                    @logger.debug message

    getUserByID: (id) ->
        @users[id]

    getUserByEmail: (email) ->
        for u of @users
            if @users[u].email == email
                return @users[u]

    getUserDirectMessageChannel: (userID, callback) ->
        # check if channel already exists
        channel = @self.id + "__" + userID
        channel = @findChannelByName(channel)
        if !channel
            # check if channel in other direction exists
            channel = userID + "__" + @self.id
            channel = @findChannelByName(channel)
        if channel
            # channel obviously doesn't exist, let's create it
            if callback? then callback(channel)
            return
        @createDirectChannel(userID,callback)

    getAllChannels: ->
        @channels

    getChannelByID: (id) ->
        @channels[id]

    customMessage: (postData, channelID) ->
        if postData.message?
            chunks = @_chunkMessage(postData.message)
            postData.message = chunks.shift()
        postData.channel_id = channelID
        @_apiCall 'POST', '/posts', postData, (data, header) =>
            @logger.debug 'Posted custom message.'
            if chunks?.length > 0
              @logger.debug "Recursively posting remainder of customMessage: (#{chunks.length})"
              postData.message = chunks.join()
              return @customMessage(postData, channelID)
            return true

    createDirectChannel: (userID, callback) ->
        postData = [userID, @self.id]
        @_apiCall 'POST', '/channels/direct', postData, (data, headers) =>
            @logger.info 'Created Direct Channel.'
            if callback? then callback(data)

    findChannelByName: (name) ->
        for c of @channels
            if @channels[c].name == name or @channels[c].display_name == name
                return @channels[c]
        return null

    _chunkMessage: (msg) ->
        if not msg
            return ['']
        message_length = new TextEncoder.TextEncoder('utf-8').encode(msg).length
        message_limit = messageMaxRunes
        chunks = []
        chunks = msg.match new RegExp("(.|[\r\n]){1,#{message_limit}}","g")
        return chunks

    postMessage: (msg, channelID) ->
        postData =
            message: msg
            filenames: []
            create_at: 0
            user_id: @self.id
            channel_id: channelID

        if typeof msg is 'string'
          postData.message = msg
        else
          postData.message = msg.message
          if msg.props
            postData.props = msg.props

        # break apart long messages
        chunks = @_chunkMessage(postData.message)
        postData.message = chunks.shift()

        @_apiCall 'POST', '/posts', postData, (data, header) =>
            @logger.debug 'Posted message.'

            if chunks?.length > 0
              msg = chunks.join()
              @logger.debug "Recursively posting remainder of message: (#{chunks?.length})"
              return @postMessage msg, channelID

            return true

    setChannelHeader: (channelID, header) ->
        postData =
            channel_id: channelID
            channel_header: header

        @_apiCall 'POST', @teamRoute() + '/channels/update_header', postData, (data, header) =>
            @logger.debug 'Channel header updated.'
            return true

    # Private functions
    #
    _send: (message) ->
        if not @connected
            return false
        else
            message.id = ++@_messageID
            message.seq = message.id
            @_pending[message.id] = message
            @ws.send JSON.stringify(message)
            return message


    _apiCall: (method, path, params, callback, callback_params = {}) ->
        post_data = ''
        post_data = JSON.stringify(params) if params?
        options =
            uri: (if useTLS then 'https://' else 'http://') + @host + (if @options.httpPort? then ':' + @options.httpPort else "") + apiPrefix + path
            method: method
            json: params
            rejectUnauthorized: tlsverify
            headers:
                'Content-Type': 'application/json'
                'Content-Length': new TextEncoder.TextEncoder('utf-8').encode(post_data).length
        options.headers['Authorization'] = 'BEARER ' + @token if @token
        options.proxy = @httpProxy if @httpProxy
        @logger.debug "#{method} #{path}"
        @logger.info 'api url:' + options.uri
        request options, (error, res, value) ->
            if error
                if callback? then callback({'id': null, 'error': error.errno}, {}, callback_params)
            else
                if callback?
                    if res.statusCode is 200 or res.statusCode is 201
                        if typeof value == 'string'
                            value = JSON.parse(value)
                        callback(value, res.headers, callback_params)
                    else
                        callback({'id': null, 'error': 'API response: ' + res.statusCode}, res.headers, callback_params)


module.exports = Client
