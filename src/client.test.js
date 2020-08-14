jest.mock('request');
jest.mock('ws');
const requestMock = require('request');
const WebSocketMock = require('ws');

const Client = require('./client');

const SERVER_URL = 'test.foo.bar';

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
            json: {
                login_id: 'obiwan.kenobi@jedi.org',
                password: 'password',
                token: null,
            },
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
    beforeEach(() => {
        Client.prototype.emit = jest.fn();
        jest.spyOn(Client.prototype, 'getMe');
        jest.spyOn(Client.prototype, 'getPreferences');
        jest.spyOn(Client.prototype, 'getTeams');
        jest.spyOn(Client.prototype, 'reconnect');
        jest.spyOn(Client.prototype, 'loadUsers');
        jest.spyOn(Client.prototype, 'loadChannels');
        jest.spyOn(Client.prototype, 'connect');
        jest.spyOn(Client.prototype, '_send');
    });

    describe('_onLogin', () => {
        test('should reconnect when bad data', () => {
            const tested = new Client(SERVER_URL, 'dummy', {});
            tested._onLogin({}, {});

            expect(Client.prototype.reconnect).toHaveBeenCalled();
            expect(tested.authenticated).toBeFalsy();
            expect(tested._reconnecting).toBeTruthy();
        });

        test('should reconnect when null data', () => {
            const tested = new Client(SERVER_URL, 'dummy', {});
            tested._onLogin(null, {});

            expect(Client.prototype.reconnect).toHaveBeenCalled();
            expect(Client.prototype.emit).toHaveBeenCalledWith('error', null);
            expect(tested.authenticated).toBeFalsy();
            expect(tested._reconnecting).toBeTruthy();
        });

        test('should retrieve info when success', () => {
            const tested = new Client(SERVER_URL, 'dummy', {});
            tested._onLogin({ id: 'obiwan' }, {});

            expect(Client.prototype.reconnect).not.toHaveBeenCalled();
            expect(Client.prototype.emit).toHaveBeenCalledWith('loggedIn', expect.objectContaining({ id: 'obiwan' }));
            expect(tested.socketUrl).toEqual(`wss://${SERVER_URL}/api/v4/websocket`);
            expect(tested.self).toEqual({ id: 'obiwan' });
            expect(tested.authenticated).toBeTruthy();
        });
    });

    describe('_onLoadUser(s)', () => {
        const PRELOADED_USERS = { obiwan: { id: 'obiwan' }, yoda: { id: 'yoda' } };
        test('should failed on bad data', () => {
            const tested = new Client(SERVER_URL, 'dummy', {});
            tested._onLoadUsers(null, null, null);
            expect(Client.prototype.emit).toHaveBeenCalledWith('error', expect.objectContaining({ msg: expect.anything() }));
        });

        test('should load users', () => {
            Client.prototype.loadUsers = jest.fn();
            const tested = new Client(SERVER_URL, 'dummy', {});
            tested._onLoadUsers([{ id: 'obiwan' }, { id: 'yoda' }], null, { page: null });
            expect(Client.prototype.emit).toHaveBeenCalledWith('profilesLoaded', expect.anything());
            expect(tested.users).toEqual(PRELOADED_USERS);
            expect(Client.prototype.loadUsers).not.toHaveBeenCalled();
        });

        test('should load multipage users', () => {
            Client.prototype.loadUsers = jest.fn();
            const tested = new Client(SERVER_URL, 'dummy', {});
            tested._onLoadUsers([{ id: 'obiwan' }, { id: 'yoda' }], null, { page: 1 });
            expect(Client.prototype.loadUsers).toHaveBeenCalledWith(2);
        });

        test('should load user', () => {
            const tested = new Client(SERVER_URL, 'dummy', {});
            tested.users = PRELOADED_USERS;
            tested._onLoadUser({ id: 'luke' }, null, null);

            expect(Client.prototype.emit).toHaveBeenCalledWith('profilesLoaded', expect.anything());
            expect(tested.users).toEqual(expect.objectContaining({
                ...PRELOADED_USERS,
                luke: { id: 'luke' },
            }));
        });

        test('should fail load user', () => {
            const tested = new Client(SERVER_URL, 'dummy', {});
            tested.users = PRELOADED_USERS;
            tested._onLoadUser({ error: 'No jedi available' }, null, null);

            expect(Client.prototype.emit).not.toHaveBeenCalled();
            expect(tested.users).toEqual(PRELOADED_USERS);
        });
    });

    describe('_onChannels', () => {
        const SAMPLE_CHANNELS = { jedi: { id: 'jedi' }, sith: { id: 'sith' } };
        test('should fail receive channels', () => {
            const tested = new Client(SERVER_URL, 'dummy', {});
            tested._onChannels({ error: 'No jedi available' }, null, null);

            expect(Client.prototype.emit).toHaveBeenCalledWith('error', expect.objectContaining({ msg: expect.anything() }));
        });

        test('should receive channels', () => {
            const tested = new Client(SERVER_URL, 'dummy', {});
            tested._onChannels([{ id: 'jedi' }, { id: 'sith' }], null, null);

            expect(Client.prototype.emit).toHaveBeenCalledWith('channelsLoaded', expect.anything());
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
            const tested = new Client(SERVER_URL, 'dummy', {});
            tested._onPreferences({ error: 'error' }, null, null);

            expect(Client.prototype.reconnect).toHaveBeenCalled();
        });

        test('should receive preferences', () => {
            const tested = new Client(SERVER_URL, 'dummy', {});
            tested._onPreferences(SAMPLE_PREFERENCES, null, null);

            expect(Client.prototype.emit).toHaveBeenCalledWith('preferencesLoaded', expect.anything());
            expect(tested.preferences).toEqual(SAMPLE_PREFERENCES);
        });
    });

    describe('_onMe', () => {
        const SAMPLE_ME = {
            id: 'obiwan',
            category: 'user',
        };
        test('should fail receive me', () => {
            const tested = new Client(SERVER_URL, 'dummy', {});
            tested._onMe({ error: 'error' }, null, null);

            expect(Client.prototype.reconnect).toHaveBeenCalled();
        });

        test('should receive me', () => {
            const tested = new Client(SERVER_URL, 'dummy', {});
            tested._onMe(SAMPLE_ME, null, null);

            expect(Client.prototype.emit).toHaveBeenCalledWith('meLoaded', expect.anything());
            expect(tested.me).toEqual(SAMPLE_ME);
        });
    });

    describe('_onTeams', () => {
        const SAMPLE_TEAMS = [{
            id: 'jedi',
            name: 'Light Side',
        }];
        test('should fail receive teams', () => {
            const tested = new Client(SERVER_URL, 'dummy', {});
            tested._onTeams({ error: 'error' }, null, null);

            expect(Client.prototype.reconnect).toHaveBeenCalled();
        });

        test('should receive teams', () => {
            const tested = new Client(SERVER_URL, 'dummy', {});
            tested._onTeams(SAMPLE_TEAMS, null, null);

            expect(Client.prototype.emit).toHaveBeenCalledWith('teamsLoaded', expect.anything());
            expect(Client.prototype.loadUsers).toHaveBeenCalled();
            expect(Client.prototype.loadChannels).toHaveBeenCalled();
            expect(Client.prototype.connect).toHaveBeenCalled();
            expect(tested.teams).toEqual(SAMPLE_TEAMS);
            expect(tested.teamID).toBeFalsy();
        });

        test('should receive teams', () => {
            const tested = new Client(SERVER_URL, 'dummy', {});
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
            jest.spyOn(Client.prototype, '_send');
        });
        test('should ws return error', () => {
            const onCall = WebSocketMock.prototype.on.mock.calls[0];
            expect(onCall[0]).toEqual('error');
            onCall[1]('testing error return');
            expect(Client.prototype.emit).toHaveBeenCalledWith('error', 'testing error return');
        });

        test('should ws return open', () => {
            const onCall = WebSocketMock.prototype.on.mock.calls[1];
            expect(onCall[0]).toEqual('open');
            onCall[1]('testing error return');
            expect(Client.prototype.emit).toHaveBeenCalledWith('connected');
            expect(Client.prototype._send).toHaveBeenCalledWith(
                {
                    action: 'authentication_challenge', data: { token: null }, id: 1, seq: 1,
                },
            );
            expect(tested._pongTimeout).not.toBeNull();
        });
    });

    describe('Pong timeout', () => {
        const tested = new Client(SERVER_URL, 'dummy', {});

        beforeEach(() => {
            jest.spyOn(Client.prototype, 'reconnect').mockImplementation(() => {});
            jest.spyOn(Client.prototype, '_send');
            tested.connect();
            const onCall = WebSocketMock.prototype.on.mock.calls[1];
            expect(onCall[0]).toEqual('open');
            jest.useFakeTimers();
            jest.clearAllTimers();
            onCall[1]();
            Client.prototype._send.mockReset();
        });

        test('should ping pong', () => {
            expect(setInterval).toBeCalled();

            tested.connected = true;
            tested._lastPong = Date.now() - 1;
            jest.runOnlyPendingTimers();
            expect(Client.prototype._send).toHaveBeenCalledWith({ action: 'ping' });
        });

        test('should reconnect if note connected', () => {
            expect(setInterval).toBeCalled();
            tested.connected = false;
            jest.runOnlyPendingTimers();
            expect(Client.prototype.reconnect).toHaveBeenCalled();
        });

        test('should reconnect if last ping too late', () => {
            expect(setInterval).toBeCalled();
            tested.connected = true;
            tested._lastPong = Date.now() - (3 * tested._pingInterval);
            jest.runOnlyPendingTimers();
            expect(Client.prototype.reconnect).toHaveBeenCalled();
        });
    });

    describe('close websocket handlers', () => {
        const tested = new Client(SERVER_URL, 'dummy', {});

        beforeEach(() => {
            jest.spyOn(Client.prototype, 'reconnect').mockImplementation(() => {});
            tested.connect();
        });

        test('should close socket', () => {
            tested.connected = true;
            tested.autoReconnect = false;
            const onCall = WebSocketMock.prototype.on.mock.calls[3];
            expect(onCall[0]).toEqual('close');
            onCall[1](200, 'obiwan');

            expect(Client.prototype.emit).toHaveBeenCalledWith('close', 200, 'obiwan');
            expect(Client.prototype.reconnect).not.toHaveBeenCalled();
            expect(tested.connected).toBeFalsy();
        });

        test('should close socket with autoreconnect', () => {
            tested.connected = true;
            tested.autoReconnect = true;
            const onCall = WebSocketMock.prototype.on.mock.calls[3];
            expect(onCall[0]).toEqual('close');
            onCall[1](200, 'obiwan');

            expect(Client.prototype.emit).toHaveBeenCalledWith('close', 200, 'obiwan');
            expect(Client.prototype.reconnect).toHaveBeenCalled();
            expect(tested.connected).toBe(false);
        });
    });

    test('should reconnect', () => {
        jest.useFakeTimers();
        const tested = new Client(SERVER_URL, 'dummy', {});
        tested.connect();
        this._reconnecting = false;
        tested._pongTimeout = 65;

        tested.reconnect();

        expect(clearInterval).toBeCalled();
        expect(tested.ws.close).toHaveBeenCalled();
        expect(setTimeout).toBeCalled();
    });

    test.skip('should avoid infinite reconnection', () => {
        jest.useFakeTimers();
        const tested = new Client(SERVER_URL, 'dummy', {});
        tested.connect();
        this._reconnecting = true;
        tested._pongTimeout = 65;

        tested.reconnect();

        expect(clearInterval).not.toBeCalled();
        expect(tested.ws.close).not.toHaveBeenCalled();
        expect(setTimeout).not.toBeCalled();
    });

    test('should login from reconnect', () => {
        jest.useFakeTimers();
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
