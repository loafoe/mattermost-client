jest.mock('request');
jest.mock('ws');
const requestMock = require('request');
const WebSocketMock = require('ws');

const Client = require('../src/client');
const User = require('../src/user');

const SERVER_URL = 'test.foo.bar';

beforeEach(() => {
    Client.prototype.emit = jest.fn();
});

afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
});

describe('Mattermost login ...', () => {
    test('should login with credentials', () => {
        const tested = new Client(SERVER_URL, 'dummy', {});
        tested.login('obiwan.kenobi@jedi.org', 'password', null);
        expect(requestMock).toHaveBeenCalledWith({
            headers: expect.objectContaining({
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
            }),
            json: expect.objectContaining({
                login_id: 'obiwan.kenobi@jedi.org',
                token: null,
            }),
            method: 'POST',
            rejectUnauthorized: true,
            uri: `https://${SERVER_URL}/api/v4/users/login`,
        }, expect.anything());
    });

    test('should login with token', () => {
        const tested = new Client(SERVER_URL, 'dummy', {});
        tested.tokenLogin('obiwanKenobiDummyToken');
        expect(requestMock).toHaveBeenCalledWith({
            headers: expect.objectContaining({
                Authorization: 'BEARER obiwanKenobiDummyToken',
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
            }),
            json: null,
            method: 'GET',
            rejectUnauthorized: true,
            uri: `https://${SERVER_URL}/api/v4/users/me`,
        }, expect.anything());
    });
});

describe('Client callbacks', () => {
    let tested;
    beforeEach(() => {
        jest.useFakeTimers();
        tested = new Client(SERVER_URL, 'dummy', {});
        jest.spyOn(tested, 'getMe');
        jest.spyOn(tested, 'getPreferences');
        jest.spyOn(tested, 'getTeams');
        jest.spyOn(tested, 'reconnect');
        jest.spyOn(tested, 'loadUsers');
        jest.spyOn(tested, 'loadChannels');
        jest.spyOn(tested, 'connect');
        jest.spyOn(tested, '_send');
    });

    describe('_onLogin', () => {
        test('should reconnect when bad data', () => {
            tested._onLogin({}, {});

            expect(tested.reconnect).toHaveBeenCalled();
            expect(tested.authenticated).toBeFalsy();
            expect(tested._reconnecting).toBeTruthy();
        });

        test('should reconnect when null data', () => {
            tested._onLogin(null, {});

            expect(tested.reconnect).toHaveBeenCalled();
            expect(tested.emit).toHaveBeenCalledWith('error', null);
            expect(tested.authenticated).toBeFalsy();
            expect(tested._reconnecting).toBeTruthy();
        });

        test('should retrieve info when success', () => {
            tested._onLogin({id: 'obiwan'}, {});

            expect(tested.reconnect).not.toHaveBeenCalled();
            expect(tested.emit).toHaveBeenCalledWith('loggedIn', expect.objectContaining({id: 'obiwan'}));
            expect(tested.socketUrl).toEqual(`wss://${SERVER_URL}/api/v4/websocket`);
            expect(tested.self).toEqual({id: 'obiwan'});
            expect(tested.authenticated).toBeTruthy();
        });
    });

    describe('_onLoadUser(s)', () => {
        const PRELOADED_USERS = {obiwan: {id: 'obiwan'}, yoda: {id: 'yoda'}};
        test('should failed on bad data', () => {
            tested._onLoadUsers(null, null, null);
            expect(tested.emit).toHaveBeenCalledWith('error', expect.objectContaining({msg: expect.anything()}));
        });

        test('should load users', () => {
            tested._onLoadUsers([{id: 'obiwan'}, {id: 'yoda'}], null, {page: null});
            expect(tested.emit).toHaveBeenCalledWith('profilesLoaded', expect.anything());
            expect(tested.users).toEqual(PRELOADED_USERS);
            expect(tested.loadUsers).not.toHaveBeenCalled();
        });

        test('should load multipage users', () => {
            tested._onLoadUsers([{id: 'obiwan'}, {id: 'yoda'}], null, {page: 1});
            expect(tested.loadUsers).toHaveBeenCalledWith(2);
        });

        test('should load user', () => {
            tested.users = PRELOADED_USERS;
            tested._onLoadUser({id: 'luke'}, null, null);

            expect(tested.emit).toHaveBeenCalledWith('profilesLoaded', expect.anything());
            expect(tested.users).toEqual(expect.objectContaining({
                ...PRELOADED_USERS,
                luke: {id: 'luke'},
            }));
        });

        test('should fail load user', () => {
            tested.emit = jest.fn();
            tested.users = PRELOADED_USERS;
            tested._onLoadUser({error: 'No jedi available'}, null, null);

            expect(tested.emit).not.toHaveBeenCalled();
            expect(tested.users).toEqual(PRELOADED_USERS);
        });
    });

    describe('_onChannels', () => {
        const SAMPLE_CHANNELS = {jedi: {id: 'jedi'}, sith: {id: 'sith'}};
        test('should fail receive channels', () => {
            tested._onChannels({error: 'No jedi available'}, null, null);

            expect(tested.emit).toHaveBeenCalledWith('error', expect.objectContaining({msg: expect.anything()}));
        });

        test('should receive channels', () => {
            tested._onChannels([{id: 'jedi'}, {id: 'sith'}], null, null);

            expect(tested.emit).toHaveBeenCalledWith('channelsLoaded', expect.anything());
            expect(tested.channels).toEqual(SAMPLE_CHANNELS);
        });
    });

    describe('_onPreferences', () => {
        const SAMPLE_PREFERENCES = {
            user_id: 'obiwan',
            category: 'user',
            name: 'Obiwan',
            value: 'Kenobi',
        };
        test('should fail receive preferences', () => {
            tested._onPreferences({error: 'error'}, null, null);

            expect(tested.reconnect).toHaveBeenCalled();
        });

        test('should receive preferences', () => {
            tested._onPreferences(SAMPLE_PREFERENCES, null, null);

            expect(tested.emit).toHaveBeenCalledWith('preferencesLoaded', expect.anything());
            expect(tested.preferences).toEqual(SAMPLE_PREFERENCES);
        });
    });

    describe('_onMe', () => {
        const SAMPLE_ME = {
            id: 'obiwan',
            category: 'user',
        };
        test('should fail receive me', () => {
            tested._onMe({error: 'error'}, null, null);

            expect(tested.reconnect).toHaveBeenCalled();
        });

        test('should receive me', () => {
            tested._onMe(SAMPLE_ME, null, null);

            expect(tested.emit).toHaveBeenCalledWith('meLoaded', expect.anything());
            expect(tested.me).toEqual(SAMPLE_ME);
        });
    });

    describe('_onTeams', () => {
        const SAMPLE_TEAMS = [{
            id: 'jedi',
            name: 'Light Side',
        }];
        test('should fail receive teams', () => {
            tested._onTeams({error: 'error'}, null, null);

            expect(tested.reconnect).toHaveBeenCalled();
        });

        test('should receive teams', () => {
            tested._onTeams(SAMPLE_TEAMS, null, null);

            expect(tested.emit).toHaveBeenCalledWith('teamsLoaded', expect.anything());
            expect(tested.loadUsers).toHaveBeenCalled();
            expect(tested.loadChannels).toHaveBeenCalled();
            expect(tested.connect).toHaveBeenCalled();
            expect(tested.teams).toEqual(SAMPLE_TEAMS);
            expect(tested.teamID).toBeFalsy();
        });

        test('should receive teams', () => {
            tested.group = 'Light Side';
            tested._onTeams(SAMPLE_TEAMS, null, null);
            expect(tested.teamID).toBeTruthy();
        });
    });
});

describe('Route builder', () => {
    test('should build team route', () => {
        const tested = new Client(SERVER_URL, 'dummy', {});
        tested.teamID = 'obiwan';
        const actual = tested.teamRoute();
        expect(actual).toEqual('/users/me/teams/obiwan');
    });

    test('should build channel route', () => {
        const tested = new Client(SERVER_URL, 'dummy', {});
        tested.teamID = 'light';
        const actual = tested.channelRoute('jedi');
        expect(actual).toEqual('/users/me/teams/light/channels/jedi');
    });
});

describe('Simple requesters', () => {
    const tested = new Client(SERVER_URL, 'dummy', {});
    const EXPECTED = (route) => ({
        headers: expect.objectContaining({
            Authorization: 'BEARER obiwanKenobiDummyToken',
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
        }),
        json: null,
        method: 'GET',
        rejectUnauthorized: true,
        uri: `https://${SERVER_URL}/api/v4/users/me${route}`,
    });

    beforeEach(() => {
        tested.token = 'obiwanKenobiDummyToken';
    });

    test('should get me', () => {
        tested.getMe();
        expect(requestMock).toHaveBeenCalledWith(EXPECTED(''), expect.anything());
    });

    test('should get my preferences', () => {
        tested.getPreferences();
        expect(requestMock).toHaveBeenCalledWith(EXPECTED('/preferences'), expect.anything());
    });

    test('should get my teams', () => {
        tested.getTeams();
        expect(requestMock).toHaveBeenCalledWith(EXPECTED('/teams'), expect.anything());
    });

    test('should load users page', () => {
        tested.teamID = 'jedi';
        tested.loadUsers();
        expect(requestMock).toHaveBeenCalledWith({
            headers: expect.objectContaining({
                Authorization: 'BEARER obiwanKenobiDummyToken',
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
            }),
            json: null,
            method: 'GET',
            rejectUnauthorized: true,
            uri: `https://${SERVER_URL}/api/v4/users?page=0&per_page=200&in_team=jedi`,
        }, expect.anything());
    });

    test('should load specific user', () => {
        tested.teamID = 'jedi';
        tested.loadUser('yoda');
        expect(requestMock).toHaveBeenCalledWith({
            headers: expect.objectContaining({
                Authorization: 'BEARER obiwanKenobiDummyToken',
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
            }),
            json: null,
            method: 'GET',
            rejectUnauthorized: true,
            uri: `https://${SERVER_URL}/api/v4/users/yoda`,
        }, expect.anything());
    });

    test('should load team channels', () => {
        tested.teamID = 'jedi';
        tested.loadChannels();
        expect(requestMock).toHaveBeenCalledWith({
            headers: expect.objectContaining({
                Authorization: 'BEARER obiwanKenobiDummyToken',
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
            }),
            json: null,
            method: 'GET',
            rejectUnauthorized: true,
            uri: `https://${SERVER_URL}/api/v4/users/me/teams/jedi/channels`,
        }, expect.anything());
    });
});

describe('Connect / Reconnect / Disconnect', () => {
    test('should connect to mattermost', () => {
        const tested = new Client(SERVER_URL, 'dummy', {});
        tested.connect();
        expect(WebSocketMock.prototype.on).toHaveBeenCalledWith('error', expect.anything());
        expect(WebSocketMock.prototype.on).toHaveBeenCalledWith('open', expect.anything());
        expect(WebSocketMock.prototype.on).toHaveBeenCalledWith('message', expect.anything());
        expect(WebSocketMock.prototype.on).toHaveBeenCalledWith('close', expect.anything());
    });

    describe('connect websocket handlers', () => {
        const tested = new Client(SERVER_URL, 'dummy', {});
        beforeEach(() => {
            tested.connect();
            jest.spyOn(tested, '_send');
        });
        test('should ws return error', () => {
            const onCall = WebSocketMock.prototype.on.mock.calls[0];
            expect(onCall[0]).toEqual('error');
            onCall[1]('testing error return');
            expect(tested.emit).toHaveBeenCalledWith('error', 'testing error return');
        });

        test('should ws return open', () => {
            const onCall = WebSocketMock.prototype.on.mock.calls[1];
            expect(onCall[0]).toEqual('open');
            onCall[1]('testing error return');
            expect(tested.emit).toHaveBeenCalledWith('connected');
            expect(tested._send).toHaveBeenCalledWith(
                {
                    action: 'authentication_challenge', data: {token: null},
                },
            );
            expect(tested._pongTimeout).not.toBeNull();
        });
    });

    describe('Pong timeout', () => {
        const tested = new Client(SERVER_URL, 'dummy', {});

        beforeEach(() => {
            jest.useFakeTimers();
            jest.clearAllTimers();
            jest.spyOn(global, 'setInterval');
            jest.spyOn(tested, 'reconnect').mockImplementation();
            jest.spyOn(tested, '_send');
            tested.connect();
            const onCall = WebSocketMock.prototype.on.mock.calls[1];
            expect(onCall[0]).toEqual('open');
            onCall[1]();
            tested._send.mockReset();
        });

        test('should ping pong', () => {
            expect(setInterval).toBeCalled();

            tested.connected = true;
            tested._lastPong = Date.now() - 1;
            jest.runOnlyPendingTimers();
            expect(tested._send).toHaveBeenCalledWith({action: 'ping'});
        });

        test('should reconnect if note connected', () => {
            expect(setInterval).toBeCalled();
            tested.connected = false;
            jest.runOnlyPendingTimers();
            expect(tested.reconnect).toHaveBeenCalled();
        });

        test('should reconnect if last ping too late', () => {
            expect(setInterval).toBeCalled();
            tested.connected = true;
            tested._lastPong = Date.now() - (3 * tested._pingInterval);
            jest.runOnlyPendingTimers();
            expect(tested.reconnect).toHaveBeenCalled();
        });
    });

    describe('close websocket handlers', () => {
        const tested = new Client(SERVER_URL, 'dummy', {});

        beforeEach(() => {
            jest.spyOn(tested, 'reconnect').mockImplementation();
            tested.connect();
        });

        test('should close socket', () => {
            tested.connected = true;
            tested.autoReconnect = false;
            const onCall = WebSocketMock.prototype.on.mock.calls[3];
            expect(onCall[0]).toEqual('close');
            onCall[1](200, 'obiwan');

            expect(tested.emit).toHaveBeenCalledWith('close', 200, 'obiwan');
            expect(tested.reconnect).not.toHaveBeenCalled();
            expect(tested.connected).toBeFalsy();
        });

        test('should close socket with autoreconnect', () => {
            tested.connected = true;
            tested.autoReconnect = true;
            const onCall = WebSocketMock.prototype.on.mock.calls[3];
            expect(onCall[0]).toEqual('close');
            onCall[1](200, 'obiwan');

            expect(tested.emit).toHaveBeenCalledWith('close', 200, 'obiwan');
            expect(tested.reconnect).toHaveBeenCalled();
            expect(tested.connected).toBe(false);
        });
    });

    test('should reconnect', () => {
        jest.useFakeTimers();
        jest.spyOn(global, 'clearInterval');
        jest.spyOn(global, 'setTimeout');
        const tested = new Client(SERVER_URL, 'dummy', {});
        tested.connect();
        this._reconnecting = false;
        tested._pongTimeout = 65;

        tested.reconnect();

        expect(clearInterval).toBeCalled();
        expect(tested.ws.close).toHaveBeenCalled();
        expect(setTimeout).toBeCalled();
    });

    test('should avoid infinite reconnection', () => {
        jest.useFakeTimers();
        jest.spyOn(global, 'clearInterval');
        jest.spyOn(global, 'setTimeout');
        const tested = new Client(SERVER_URL, 'dummy', {});
        tested.connect();
        tested._reconnecting = true;
        tested._pongTimeout = 65;

        tested.reconnect();

        expect(clearInterval).not.toBeCalled();
        expect(tested.ws.close).not.toHaveBeenCalled();
        expect(setTimeout).not.toBeCalled();
    });

    test('should login from reconnect', () => {
        jest.useFakeTimers();
        jest.spyOn(global, 'clearInterval');
        jest.spyOn(global, 'setTimeout');
        const tested = new Client(SERVER_URL, 'dummy', {});
        tested.login('obiwan.kenobi@jedi.com', 'the4th', null);
        jest.spyOn(tested, 'login');
        tested.connect();
        this._reconnecting = true;
        tested._pongTimeout = 65;

        jest.clearAllTimers();
        tested.reconnect();
        jest.runOnlyPendingTimers();
        expect(tested.login).toHaveBeenCalledWith('obiwan.kenobi@jedi.com', 'the4th', null);
    });

    test('should login from reconnect with token', () => {
        jest.useFakeTimers();
        const tested = new Client(SERVER_URL, 'dummy', {});
        tested.tokenLogin('obiwan.kenobi.rules');
        jest.spyOn(tested, 'tokenLogin');
        tested.connect();
        this._reconnecting = true;
        tested._pongTimeout = 65;

        jest.clearAllTimers();
        tested.reconnect();
        jest.runOnlyPendingTimers();
        expect(tested.tokenLogin).toHaveBeenCalledWith('obiwan.kenobi.rules');
    });

    test('should disconnect when never connected', () => {
        const tested = new Client(SERVER_URL, 'dummy', {});
        expect(tested.disconnect()).toBeFalsy();
    });

    test('should disconnect when connected', () => {
        jest.useFakeTimers();
        jest.spyOn(global, 'clearInterval');

        const tested = new Client(SERVER_URL, 'dummy', {});
        tested.connect();
        const onCall = WebSocketMock.prototype.on.mock.calls[1];
        expect(onCall[0]).toEqual('open');
        onCall[1]();
        expect(tested.disconnect()).toBeTruthy();
        expect(clearInterval).toBeCalled();
        expect(tested.ws.close).toBeCalled();
    });
});

describe('Mattermost Message reciever', () => {
    const tested = new Client(SERVER_URL, 'dummy', {});

    test('should receive post', () => {
        tested.onMessage({event: 'ping'});
        expect(tested.emit).toHaveBeenCalledWith('ping', expect.anything());

        tested.onMessage({data: {text: 'pong'}});
        expect(tested.emit).toHaveBeenCalledWith('ping', expect.anything());
    });

    test.each([
        'added_to_team',
        'authentication_challenge',
        'channel_converted',
        'channel_created',
        'channel_deleted',
        'channel_member_updated',
        'channel_updated',
        'channel_viewed',
        'config_changed',
        'delete_team',
        'ephemeral_message',
        'hello',
        'typing',
        'post_edit',
        'post_deleted',
        'preference_changed',
        'user_added',
        'user_removed',
        'user_role_updated',
        'user_updated',
        'status_change',
        'webrtc',
    ])('should receive %s events', (eventName) => {
        tested.onMessage({event: eventName});
        expect(tested.emit).toHaveBeenCalledWith(eventName, expect.anything());
    });

    test('should receive posted events', () => {
        tested.onMessage({event: 'posted'});
        expect(tested.emit).toHaveBeenCalledWith('message', expect.anything());
    });

    test('should receive new user events', () => {
        jest.spyOn(tested, 'loadUser');
        tested.onMessage({event: 'new_user', data: {user_id: 'obiwan'}});
        expect(tested.emit).toHaveBeenCalledWith('new_user', expect.anything());
        expect(tested.loadUser).toHaveBeenCalledWith('obiwan');
    });
});

describe('Basic Getters', () => {
    const tested = new Client(SERVER_URL, 'dummy', {});
    const CHANNELS_SAMPLE = {
        jedi: {id: 'jedi', name: 'jedi'},
        sith: {id: 'sith', name: 'sith'},
        yobiwan: {id: 'yobiwan', name: 'yoda__obiwan'},
    };
    beforeEach(() => {
        tested.users = {
            obiwan: {id: 'obiwan', email: 'obiwan.kenobi@jedi.com'},
            yoda: {id: 'yoda', email: 'yoda@jedi.com'},
        };
        tested.self = new User(tested.users.obiwan);
        tested.channels = CHANNELS_SAMPLE;
    });

    test('should get user by id', () => {
        const actual = tested.getUserByID('obiwan');
        expect(actual.id).toEqual('obiwan');
    });

    test('should get user by email', () => {
        const actual = tested.getUserByEmail('yoda@jedi.com');
        expect(actual.id).toEqual('yoda');
    });

    test('should get existing direct user channel', () => {
        let actual;
        tested.getUserDirectMessageChannel('yoda', (channel) => {
            actual = channel;
        });
        expect(actual).toEqual(expect.objectContaining({id: 'yobiwan'}));
    });

    test('should get non existing direct user channel', () => {
        let actual;
        jest.spyOn(tested, 'createDirectChannel').mockImplementation((userId, callback) => callback({id: 'libiwan'}));
        tested.getUserDirectMessageChannel('luke', (channel) => {
            actual = channel;
        });
        expect(tested.createDirectChannel).toBeCalled();
        expect(actual).toEqual(expect.objectContaining({id: 'libiwan'}));
    });

    test('should get channels', () => {
        expect(tested.getAllChannels()).toEqual(CHANNELS_SAMPLE);
    });

    test('should get channel by id', () => {
        expect(tested.getChannelByID('jedi')).toEqual({id: 'jedi', name: 'jedi'});
    });

    test('should find channel by name', () => {
        expect(tested.findChannelByName('sith')).toEqual({id: 'sith', name: 'sith'});
    });

    test('should chunck message', () => {
        expect(Client._chunkMessage('x'.repeat(5000))).toEqual(['x'.repeat(4000), 'x'.repeat(1000)]);
    });
});

describe('Mattermost messaging', () => {
    const tested = new Client(SERVER_URL, 'dummy', {});
    beforeEach(() => {
        tested.self = new User({id: 'obiwan', email: 'obiwan.kenobi@jedi.com'});
        tested.teamID = 'jedi';
        jest.spyOn(tested, '_apiCall');
    });

    test('should send custom message', () => {
        tested.customMessage({message: 'The Force will be with you'}, 'jedi');
        expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({
            json: {channel_id: 'jedi', message: 'The Force will be with you'},
            method: 'POST',
            uri: 'https://test.foo.bar/api/v4/posts',
        }), expect.anything());
        const callback = tested._apiCall.mock.calls[0][3];
        expect(callback('', '')).toBeTruthy();
    });

    test('should send very long message', () => {
        const veryLongMessage = 'x'.repeat(5000);
        tested.customMessage({message: veryLongMessage}, 'jedi');
        expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({
            json: {channel_id: 'jedi', message: 'x'.repeat(4000)},
            method: 'POST',
            uri: 'https://test.foo.bar/api/v4/posts',
        }), expect.anything());

        const callback = tested._apiCall.mock.calls[0][3];
        callback('', '');

        expect(requestMock).toHaveBeenLastCalledWith(expect.objectContaining({
            json: {channel_id: 'jedi', message: 'x'.repeat(1000)},
            method: 'POST',
            uri: 'https://test.foo.bar/api/v4/posts',
        }), expect.anything());
    });

    test('should post message', () => {
        tested.postMessage('The Force will be with you', 'jedi');
        expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({
            json: {
                channel_id: 'jedi',
                create_at: 0,
                file_ids: [],
                message: 'The Force will be with you',
                user_id: 'obiwan',
            },
            method: 'POST',
            uri: 'https://test.foo.bar/api/v4/posts',
        }), expect.anything());
        const callback = tested._apiCall.mock.calls[0][3];
        expect(callback('', '')).toBeTruthy();
    });

    test('should post complex message', () => {
        tested.postMessage({
            message: 'The Force will be with you',
            props: {type: 'bold'},
            file_ids: ['obiwan.xml']
        }, 'jedi');
        expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({
            json: {
                channel_id: 'jedi',
                create_at: 0,
                file_ids: ['obiwan.xml'],
                message: 'The Force will be with you',
                props: {type: 'bold'},
                user_id: 'obiwan',
            },
            method: 'POST',
            uri: 'https://test.foo.bar/api/v4/posts',
        }), expect.anything());
        const callback = tested._apiCall.mock.calls[0][3];
        expect(callback('', '')).toBeTruthy();
    });

    test('should post very long message', () => {
        const veryLongMessage = 'x'.repeat(5000);
        tested.postMessage(veryLongMessage, 'jedi');
        expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({
            json: {
                channel_id: 'jedi', create_at: 0, file_ids: [], message: 'x'.repeat(4000), user_id: 'obiwan',
            },
            method: 'POST',
            uri: 'https://test.foo.bar/api/v4/posts',
        }), expect.anything());

        const callback = tested._apiCall.mock.calls[0][3];
        callback('', '');

        expect(requestMock).toHaveBeenLastCalledWith(expect.objectContaining({
            json: {
                channel_id: 'jedi', create_at: 0, file_ids: [], message: 'x'.repeat(1000), user_id: 'obiwan',
            },
            method: 'POST',
            uri: 'https://test.foo.bar/api/v4/posts',
        }), expect.anything());
    });

    test('should open dialog', () => {
        tested.dialog('dialogId', 'https://blog.i-run.si', {
            callback_id: 'string',
            title: 'string',
        });
        expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({
            json: {
                dialog: {callback_id: 'string', title: 'string'},
                trigger_id: 'dialogId',
                url: 'https://blog.i-run.si',
            },
            method: 'POST',
            uri: 'https://test.foo.bar/api/v4/actions/dialogs/open',
        }), expect.anything());
    });

    test('should edit post', () => {
        tested.editPost('postId', 'The Force will be with you, always');
        expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({
            json: {id: 'postId', message: 'The Force will be with you, always'},
            method: 'PUT',
            uri: 'https://test.foo.bar/api/v4/posts/postId',
        }), expect.anything());
    });

    test('should upload file', () => {
        const callback = jest.fn();
        tested.uploadFile('postId', 'The Force will be with you, always', callback);
        expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({
            formData: {channel_id: 'postId', files: 'The Force will be with you, always'},
            method: 'POST',
            uri: 'https://test.foo.bar/api/v4/files',
        }), expect.anything());

        const apiCallback = tested._apiCall.mock.calls[0][3];
        apiCallback('');
        expect(callback).toBeCalled();
    });

    test('should fail when react without self', () => {
        expect(tested.react('messageId', 'metal')).toBeFalsy();
    });

    test('should react to post', () => {
        tested.react('messageId', 'metal');
        expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({
            json: {
                create_at: 0, emoji_name: 'metal', post_id: 'messageId', user_id: 'obiwan',
            },
            method: 'POST',
            uri: 'https://test.foo.bar/api/v4/reactions',
        }), expect.anything());

        const apiCallback = tested._apiCall.mock.calls[0][3];
        apiCallback('');
    });

    test('should unreact to post', () => {
        tested.unreact('messageId', 'metal');
        expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({
            method: 'DELETE',
            uri: 'https://test.foo.bar/api/v4/users/me/posts/messageId/reactions/metal',
        }), expect.anything());

        const apiCallback = tested._apiCall.mock.calls[0][3];
        apiCallback('');
    });

    test('should create direct channel', () => {
        const callback = jest.fn();
        tested.createDirectChannel('yoda', callback);
        expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({
            json: ['yoda', 'obiwan'],
            method: 'POST',
            uri: 'https://test.foo.bar/api/v4/channels/direct',
        }), expect.anything());

        const apiCallback = tested._apiCall.mock.calls[0][3];
        apiCallback('');
        expect(callback).toBeCalled();
    });

    test('should set channel header', () => {
        tested.setChannelHeader('channelId', 'May The 4th');
        expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({
            json: {channel_id: 'channelId', channel_header: 'May The 4th'},
            method: 'POST',
            uri: 'https://test.foo.bar/api/v4/users/me/teams/jedi/channels/update_header',
        }), expect.anything());

        const apiCallback = tested._apiCall.mock.calls[0][3];
        expect(apiCallback('')).toBeTruthy();
    });

    test('should post command', () => {
        tested.postCommand('channelId', '/command');
        expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({
            json: {channel_id: 'channelId', command: '/command'},
            method: 'POST',
            uri: 'https://test.foo.bar/api/v4/commands/execute',
        }), expect.anything());

        const apiCallback = tested._apiCall.mock.calls[0][3];
        expect(apiCallback('')).toBeTruthy();
    });
});

describe('Private methods', () => {
    const tested = new Client(SERVER_URL, 'dummy', {});
    beforeEach(() => {
        tested.connect();
        tested.connected = true;
    });

    test('should send through websocket', () => {
        const actual = tested._send({id: 'ID', text: 'May the 4th'});
        expect(actual).not.toBeFalsy();
        expect(tested.ws.send).toHaveBeenCalledWith('{"id":1,"text":"May the 4th","seq":1}');
    });

    test('should fail to send when not connected', () => {
        tested.connected = false;
        const actual = tested._send({id: 'ID', text: 'May the 4th'});
        expect(actual).toBeFalsy();
        expect(tested.ws.send).not.toHaveBeenCalled();
    });

    test('should call api with error', () => {
        const callback = jest.fn();
        tested._apiCall('POST', '/test', null, callback, null);
        expect(requestMock).toHaveBeenCalled();

        const requestCallArgs = requestMock.mock.calls[0];
        requestCallArgs[1]({errno: 404, msg: 'error message'}, null, null);
        expect(callback).toHaveBeenCalledWith({error: 404, id: null}, {}, {});
    });

    test('should call api with status error', () => {
        const callback = jest.fn();
        tested._apiCall('POST', '/test', null, callback, null);
        expect(requestMock).toHaveBeenCalled();

        const requestCallArgs = requestMock.mock.calls[0];
        requestCallArgs[1](null, {
            statusCode: 404,
            headers: {Content: 'application/json'}
        }, '{"id":1,"text":"May the 4th","seq":1}');
        expect(callback).toHaveBeenCalledWith(
            {error: 'API response: 404 "{\\"id\\":1,\\"text\\":\\"May the 4th\\",\\"seq\\":1}"', id: null},
            {Content: 'application/json'}, {},
        );
    });

    test('should call api with 20x return', () => {
        const callback = jest.fn();
        tested._apiCall('POST', '/test', null, callback, null);
        expect(requestMock).toHaveBeenCalled();

        const requestCallArgs = requestMock.mock.calls[0];
        requestCallArgs[1](null, {
            statusCode: 200,
            headers: {Content: 'application/json'}
        }, '{"id":1,"text":"May the 4th","seq":1}');
        expect(callback).toHaveBeenCalledWith(
            {id: 1, seq: 1, text: 'May the 4th'}, {Content: 'application/json'}, {},
        );
    });
});
