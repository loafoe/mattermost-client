const request = require('request');
const WebSocket = require('ws');
const TextEncoder = require('text-encoding');
const Log = require('log');
const { EventEmitter } = require('events');
const HttpsProxyAgent = require('https-proxy-agent');

const defaultPingInterval = 60000;

const User = require('./user');
const Message = require('./message');

const apiPrefix = '/api/v4';
const usersRoute = '/users';
const messageMaxRunes = 4000;

const tlsverify = !(process.env.MATTERMOST_TLS_VERIFY || '').match(/^false|0|no|off$/i);
const useTLS = !(process.env.MATTERMOST_USE_TLS || '').match(/^false|0|no|off$/i);

class Client extends EventEmitter {
    constructor(host, group, options) {
        super();
        this.host = host;
        this.group = group;
        this.options = options || { wssPort: 443, httpPort: 80 };

        this.authenticated = false;
        this.connected = false;
        this.personalAccessToken = false;
        this.token = null;

        this.self = null;
        this.channels = {};
        this.users = {};
        this.teams = {};
        this.teamID = null;

        this.ws = null;
        this._messageID = 0;
        this._pending = {};

        this._pingInterval = (this.options.pingInterval != null)
            ? this.options.pingInterval
            : defaultPingInterval;

        this.autoReconnect = (this.options.autoReconnect != null)
            ? this.options.autoReconnect
            : true;

        this.httpProxy = (this.options.httpProxy != null) ? this.options.httpProxy : false;
        this._connecting = false;
        this._reconnecting = false;

        this._connAttempts = 0;

        this.logger = new Log(process.env.MATTERMOST_LOG_LEVEL || 'info');

        // Binding because async calls galore
        this._onLogin = this._onLogin.bind(this);
        this._onLoadUsers = this._onLoadUsers.bind(this);
        this._onLoadUser = this._onLoadUser.bind(this);
        this._onChannels = this._onChannels.bind(this);
        this._onPreferences = this._onPreferences.bind(this);
        this._onMe = this._onMe.bind(this);
        this._onTeams = this._onTeams.bind(this);
    }

    login(email, password, mfaToken) {
        this.personalAccessToken = false;
        this.email = email;
        this.password = password;
        this.mfaToken = mfaToken;
        this.logger.info('Logging in...');
        return this._apiCall(
            'POST',
            `${usersRoute}/login`,
            {
                login_id: this.email,
                password: this.password,
                token: this.mfaToken,
            },
            this._onLogin,
        );
    }

    tokenLogin(token) {
        this.token = token;
        this.personalAccessToken = true;
        this.logger.info('Logging in with personal access token...');
        const uri = `${usersRoute}/me`;
        return this._apiCall('GET', uri, null, this._onLogin);
    }

    _onLogin(data, headers) {
        if (data) {
            if (!data.id) {
                this.logger.error('Login call failed', JSON.stringify(data));
                this.authenticated = false;
                this._reconnecting = false;
                return this.reconnect();
            }
            this.authenticated = true;
            // Continue happy flow here
            if (!this.personalAccessToken) {
                this.token = headers.token;
            }
            // TODO: split into multiple lines
            this.socketUrl = `${(useTLS ? 'wss://' : 'ws://') + this.host + ((useTLS && (this.options.wssPort != null)) ? `:${this.options.wssPort}` : ((this.options.httpPort != null) ? `:${this.options.httpPort}` : '')) + apiPrefix}/websocket`;
            this.logger.info(`Websocket URL: ${this.socketUrl}`);
            this.self = new User(data);
            this.emit('loggedIn', this.self);
            this.getMe();
            this.getPreferences();
            return this.getTeams();
        }
        this.emit('error', data);
        this.authenticated = false;
        return this.reconnect();
    }

    _onLoadUsers(data, _headers, params) {
        if (data && !data.error) {
            for (const user of data) {
                this.users[user.id] = user;
            }
            this.logger.info(`Found ${Object.keys(data).length} profiles.`);
            this.emit('profilesLoaded', data);
            if ((Object.keys(data).length > 0) && (params.page != null)) {
                return this.loadUsers(params.page + 1); // Trigger next page loading
            }
        } else {
            this.logger.error('Failed to load profiles from server.');
            return this.emit('error', { msg: 'failed to load profiles' });
        }
    }

    _onLoadUser(data, _headers, _params) {
        if (data && !data.error) {
            this.users[data.id] = data;
            return this.emit('profilesLoaded', [data]);
        }
    }

    _onChannels(data, _headers, _params) {
        if (data && !data.error) {
            for (const channel of data) {
                this.channels[channel.id] = channel;
            }
            this.logger.info(`Found ${Object.keys(data).length} subscribed channels.`);
            return this.emit('channelsLoaded', data);
        }
        this.logger.error(`Failed to get subscribed channels list from server: ${data.error}`);
        return this.emit('error', { msg: 'failed to get channel list' });
    }

    _onPreferences(data, _headers, _params) {
        if (data && !data.error) {
            this.preferences = data;
            this.emit('preferencesLoaded', data);
            return this.logger.info('Loaded Preferences...');
        }
        this.logger.error(`Failed to load Preferences...${data.error}`);
        return this.reconnect();
    }

    _onMe(data, _headers, _params) {
        if (data && !data.error) {
            this.me = data;
            this.emit('meLoaded', data);
            return this.logger.info('Loaded Me...');
        }
        this.logger.error(`Failed to load Me...${data.error}`);
        return this.reconnect();
    }

    _onTeams(data, _headers, _params) {
        if (data && !data.error) {
            this.teams = data;
            this.emit('teamsLoaded', data);
            this.logger.info(`Found ${Object.keys(this.teams).length} teams.`);
            for (const team of this.teams) {
                this.logger.debug(`Testing ${team.name} == ${this.group}`);
                if (team.name.toLowerCase() === this.group.toLowerCase()) {
                    this.logger.info(`Found team! ${team.id}`);
                    this.teamID = team.id;
                    break;
                }
            }
            this.loadUsers();
            this.loadChannels();
            return this.connect(); // FIXME
        }
        this.logger.error('Failed to load Teams...');
        return this.reconnect();
    }

    channelRoute(channelId) {
        return `${this.teamRoute()}/channels/${channelId}`;
    }

    teamRoute() {
        return `${usersRoute}/me/teams/${this.teamID}`;
    }

    getMe() {
        const uri = `${usersRoute}/me`;
        this.logger.info(`Loading ${uri}`);
        return this._apiCall('GET', uri, null, this._onMe);
    }

    getPreferences() {
        const uri = `${usersRoute}/me/preferences`;
        this.logger.info(`Loading ${uri}`);
        return this._apiCall('GET', uri, null, this._onPreferences);
    }

    getTeams() {
        const uri = `${usersRoute}/me/teams`;
        this.logger.info(`Loading ${uri}`);
        return this._apiCall('GET', uri, null, this._onTeams);
    }

    loadUsers(page) {
        if (page == null) { page = 0; }
        const uri = `/users?page=${page}&per_page=200&in_team=${this.teamID}`;
        this.logger.info(`Loading ${uri}`);
        return this._apiCall('GET', uri, null, this._onLoadUsers, { page });
    }

    loadUser(user_id) {
        const uri = `/users/${user_id}`;
        this.logger.info(`Loading ${uri}`);
        return this._apiCall('GET', uri, null, this._onLoadUser, {});
    }

    loadChannels(page) {
        if (page == null) { page = 0; }
        const uri = `/users/me/teams/${this.teamID}/channels`;
        this.logger.info(`Loading ${uri}`);
        return this._apiCall('GET', uri, null, this._onChannels);
    }


    connect() {
        if (this._connecting) { return; }

        this._connecting = true;
        this.logger.info('Connecting...');
        const options = { rejectUnauthorized: tlsverify };

        if (this.httpProxy) { options.agent = new HttpsProxyAgent(this.httpProxy); }

        // Set up websocket connection to server
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.ws = new WebSocket(this.socketUrl, options);

        this.ws.on('error', (error) => {
            this._connecting = false;
            return this.emit('error', error);
        });

        this.ws.on('open', () => {
            this._connecting = false;
            this._reconnecting = false;
            this.connected = true;
            this.emit('connected');
            this._connAttempts = 0;
            this._lastPong = Date.now();
            const challenge = {
                action: 'authentication_challenge',
                data: {
                    token: this.token,
                },
            };
            this.logger.info('Sending challenge...');
            this._send(challenge);
            this.logger.info('Starting pinger...');
            return this._pongTimeout = setInterval(() => {
                if (!this.connected) {
                    this.logger.error('Not connected in pongTimeout');
                    this.reconnect();
                    return;
                }
                if ((this._lastPong != null) && ((Date.now() - this._lastPong) > (2 * this._pingInterval))) {
                    this.logger.error('Last pong is too old: %d', (Date.now() - this._lastPong) / 1000);
                    this.authenticated = false;
                    this.connected = false;
                    return this.reconnect();
                }
                this.logger.info('ping');
                return this._send({ action: 'ping' });
            },
            this._pingInterval);
        });

        this.ws.on('message', (data, _flags) => this.onMessage(JSON.parse(data)));

        this.ws.on('close', (code, message) => {
            this.emit('close', code, message);
            this._connecting = false;
            this.connected = false;
            this.socketUrl = null;
            if (this.autoReconnect) {
                return this.reconnect();
            }
        });
        return true;
    }

    reconnect() {
        if (this._reconnecting) {
            this.logger.info('WARNING: Already reconnecting.');
        }
        this._connecting = false;
        this._reconnecting = true;

        if (this._pongTimeout) {
            clearInterval(this._pongTimeout);
            this._pongTimeout = null;
        }
        this.authenticated = false;

        if (this.ws) {
            this.ws.close();
        }

        this._connAttempts++;

        const timeout = this._connAttempts * 1000;
        this.logger.info('Reconnecting in %dms', timeout);
        return setTimeout(
            () => {
                this.logger.info('Attempting reconnect');
                if (this.personalAccessToken) {
                    return this.tokenLogin(this.token);
                }
                return this.login(this.email, this.password, this.mfaToken);
            },
            timeout,
        );
    }


    disconnect() {
        if (!this.connected) {
            return false;
        }
        this.autoReconnect = false;
        if (this._pongTimeout) {
            clearInterval(this._pongTimeout);
            this._pongTimeout = null;
        }
        this.ws.close();
        return true;
    }

    onMessage(message) {
        this.emit('raw_message', message);
        const m = new Message(message);
        switch (message.event) {
        case 'ping':
            // Deprecated
            this.logger.info('ACK ping');
            this._lastPong = Date.now();
            return this.emit('ping', message);
        case 'posted':
            return this.emit('message', m);
        case 'added_to_team':
        case 'authentication_challenge':
        case 'channel_converted':
        case 'channel_created':
        case 'channel_deleted':
        case 'channel_member_updated':
        case 'channel_updated':
        case 'channel_viewed':
        case 'config_changed':
        case 'delete_team':
        case 'ephemeral_message':
        case 'hello':
        case 'typing':
        case 'post_edit':
        case 'post_deleted':
        case 'preference_changed':
        case 'user_added':
        case 'user_removed':
        case 'user_role_updated':
        case 'user_updated':
        case 'status_change':
        case 'webrtc':
            // Generic handler
            return this.emit(message.event, message);
        case 'new_user':
            this.loadUser(message.data.user_id);
            return this.emit('new_user', message);
        default:
            // Check for `pong` response
            if ((message.data ? message.data.text : undefined) && (message.data.text === 'pong')) {
                this.logger.info('ACK ping (2)');
                this._lastPong = Date.now();
                return this.emit('ping', message);
            }
            this.logger.debug('Received unhandled message:');
            return this.logger.debug(message);
        }
    }

    getUserByID(id) {
        return this.users[id];
    }

    getUserByEmail(email) {
        for (const user in this.users) {
            if (this.users[user].email === email) {
                return this.users[user];
            }
        }
    }

    getUserDirectMessageChannel(userID, callback) {
        // check if channel already exists
        let channel = `${this.self.id}__${userID}`;
        channel = this.findChannelByName(channel);
        if (!channel) {
            // check if channel in other direction exists
            channel = `${userID}__${this.self.id}`;
            channel = this.findChannelByName(channel);
        }
        if (channel) {
            // channel obviously doesn't exist, let's create it
            if (callback != null) { callback(channel); }
            return;
        }
        return this.createDirectChannel(userID, callback);
    }

    getAllChannels() {
        return this.channels;
    }

    getChannelByID(id) {
        return this.channels[id];
    }

    customMessage(postData, channelID) {
        let chunks;
        if (postData.message != null) {
            chunks = this._chunkMessage(postData.message);
            postData.message = chunks.shift();
        }
        postData.channel_id = channelID;
        return this._apiCall('POST', '/posts', postData, (_data, _headers) => {
            this.logger.debug('Posted custom message.');
            if ((chunks != null ? chunks.length : undefined) > 0) {
                this.logger.debug(`Recursively posting remainder of customMessage: (${chunks.length})`);
                postData.message = chunks.join();
                return this.customMessage(postData, channelID);
            }
            return true;
        });
    }

    dialog(trigger_id, url, dialog) {
        const postData = {
            trigger_id,
            url,
            dialog,
        };
        return this._apiCall('POST', '/actions/dialogs/open', postData, (_data, _headers) => {
            this.logger.debug('Created dialog');
        });
    }

    editPost(post_id, msg) {
        let postData = msg;
        if (typeof msg === 'string') {
            postData = {
                id: post_id,
                message: msg,
            };
        }
        return this._apiCall('PUT', `/posts/${post_id}`, postData, (_data, _headers) => {
            this.logger.debug('Edited post');
        });
    }

    uploadFile(channel_id, file, callback) {
        const formData = {
            channel_id,
            files: file,
        };

        return this._apiCall({ method: 'POST' }, '/files', formData, (data, _headers) => {
            this.logger.debug('Posted file');
            return callback(data);
        });
    }

    react(messageID, emoji) {
        const postData = {
            user_id: this.self.id,
            post_id: messageID,
            emoji_name: emoji,
            create_at: 0,
        };
        return this._apiCall('POST', '/reactions', postData, (_data, _headers) => {
            this.logger.debug('Created reaction');
        });
    }

    unreact(messageID, emoji) {
        const uri = `/users/me/posts/${messageID}/reactions/${emoji}`;
        return this._apiCall('DELETE', uri, [], (_data, _headers) => {
            this.logger.debug('Deleted reaction');
        });
    }

    createDirectChannel(userID, callback) {
        const postData = [userID, this.self.id];
        return this._apiCall('POST', '/channels/direct', postData, (data, _headers) => {
            this.logger.info('Created Direct Channel.');
            if (callback != null) { return callback(data); }
        });
    }

    findChannelByName(name) {
        for (const channel in this.channels) {
            if ((this.channels[channel].name === name) || (this.channels[channel].display_name === name)) {
                return this.channels[channel];
            }
        }
        return null;
    }

    _chunkMessage(msg) {
        if (!msg) {
            return [''];
        }
        const message_limit = messageMaxRunes;
        let chunks = [];
        chunks = msg.match(new RegExp(`(.|[\r\n]){1,${message_limit}}`, 'g'));
        return chunks;
    }

    postMessage(msg, channelID) {
        const postData = {
            message: msg,
            file_ids: [],
            create_at: 0,
            user_id: this.self.id,
            channel_id: channelID,
        };

        if (typeof msg === 'string') {
            postData.message = msg;
        } else {
            postData.message = msg.message;
            if (msg.props) {
                postData.props = msg.props;
            }
            if (msg.file_ids) {
                postData.file_ids = msg.file_ids;
            }
        }

        // break apart long messages
        const chunks = this._chunkMessage(postData.message);
        postData.message = chunks.shift();

        return this._apiCall('POST', '/posts', postData, (_data, _headers) => {
            this.logger.debug('Posted message.');

            if ((chunks != null ? chunks.length : undefined) > 0) {
                msg = chunks.join();
                this.logger.debug(`Recursively posting remainder of message: (${(chunks != null ? chunks.length : undefined)})`);
                return this.postMessage(msg, channelID);
            }

            return true;
        });
    }
    
    //post a slash command to a spezific channel    
    postCommand(channelID, cmd){
        const postData = {
            command: cmd,
            channel_id: channelID
        };
        

        return this._apiCall('POST', '/commands/execute', postData, (data, header) => {
            this.logger.debug('Run command.');
            return true;
        });
    }

    setChannelHeader(channelID, header) {
        const postData = {
            channel_id: channelID,
            channel_header: header,
        };

        return this._apiCall('POST', `${this.teamRoute()}/channels/update_header`, postData, (_data, _headers) => {
            this.logger.debug('Channel header updated.');
            return true;
        });
    }

    // Private functions
    //
    _send(message) {
        if (!this.connected) {
            return false;
        }
        message.id = ++this._messageID;
        message.seq = message.id;
        this._pending[message.id] = message;
        this.ws.send(JSON.stringify(message));
        return message;
    }


    _apiCall(method, path, params, callback, callback_params) {
        let isForm = false;
        if (typeof method !== 'string') {
            isForm = true;
            method = method.method;
        }
        if (callback_params == null) { callback_params = {}; }
        let post_data = '';
        if (params != null) { post_data = JSON.stringify(params); }
        const options = {
            uri: (useTLS ? 'https://' : 'http://') + this.host + ((this.options.httpPort != null) ? `:${this.options.httpPort}` : '') + apiPrefix + path,
            method,
            json: params,
            rejectUnauthorized: tlsverify,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': new TextEncoder.TextEncoder('utf-8').encode(post_data).length,
                'X-Requested-With': 'XMLHttpRequest',
            },
        };

        if (this.token) { options.headers.Authorization = `BEARER ${this.token}`; }
        if (this.httpProxy) { options.proxy = this.httpProxy; }

        if (isForm) {
            options.headers['Content-Type'] = 'multipart/form-data';
            delete options.headers['Content-Length'];
            delete options.json;
            options.formData = params;
        }

        this.logger.debug(`${method} ${path}`);
        this.logger.info(`api url:${options.uri}`);

        return request(options, (error, res, value) => {
            if (error) {
                if (callback) {
                    return callback({ id: null, error: error.errno }, {}, callback_params);
                }
            } else if (callback) {
                if ((res.statusCode === 200) || (res.statusCode === 201)) {
                    if (typeof value === 'string') {
                        value = JSON.parse(value);
                    }
                    return callback(value, res.headers, callback_params);
                }
                return callback({ id: null, error: `API response: ${res.statusCode} ${JSON.stringify(value)}` }, res.headers, callback_params);
            }
        });
    }
}


module.exports = Client;
