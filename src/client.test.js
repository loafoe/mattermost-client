jest.mock('request');
const requestMock = require('request');
const Client = require('./client');

const SERVER_URL = 'test.foo.bar'

afterEach(() => {
    jest.clearAllMocks();
});

describe('Mattermost login ...', () => {

    test('should login with credentials', () => {
        const tested = new Client(SERVER_URL, 'dummy', {});
        tested.login('obiwan.kenobi@jedi.org', 'password', null);
        expect(requestMock).toHaveBeenCalledWith({
            headers: expect.objectContaining({
                "Content-Type": "application/json",
                "X-Requested-With": "XMLHttpRequest",
            }),
            json: {
                "login_id": "obiwan.kenobi@jedi.org",
                "password": "password",
                "token": null,
            },
            method: "POST",
            rejectUnauthorized: true,
            uri: `https://${SERVER_URL}/api/v4/users/login`,
        }, expect.anything());
    });

    test('should login with token', () => {
        const tested = new Client(SERVER_URL, 'dummy', {});
        tested.tokenLogin('obiwanKenobiDummyToken');
        expect(requestMock).toHaveBeenCalledWith({
            headers: expect.objectContaining({
                "Authorization": "BEARER obiwanKenobiDummyToken",
                "Content-Type": "application/json",
                "X-Requested-With": "XMLHttpRequest",
            }),
            json: null,
            method: "GET",
            rejectUnauthorized: true,
            uri: `https://${SERVER_URL}/api/v4/users/me`,
        }, expect.anything());
    });

});

describe('Client callbacks', () => {
    beforeEach(() => {
        Client.prototype.emit = jest.fn();
        Client.prototype.getMe = jest.fn();
        Client.prototype.getPreferences = jest.fn();
        Client.prototype.getTeams = jest.fn();
        Client.prototype.reconnect = jest.fn();
        Client.prototype.loadUsers = jest.fn();
        Client.prototype.loadChannels = jest.fn();
        Client.prototype.connect = jest.fn();
    });

    describe('_onLogin', () => {
        test('should reconnect when bad data', () => {
            const tested = new Client(SERVER_URL, 'dummy', {});
            tested._onLogin({}, {});

            expect(Client.prototype.reconnect).toHaveBeenCalled();
            expect(tested.authenticated).toBeFalsy();
            expect(tested._reconnecting).toBeFalsy();
        });

        test('should reconnect when null data', () => {
            const tested = new Client(SERVER_URL, 'dummy', {});
            tested._onLogin(null, {});

            expect(Client.prototype.reconnect).toHaveBeenCalled();
            expect(Client.prototype.emit).toHaveBeenCalledWith('error', null);
            expect(tested.authenticated).toBeFalsy();
            expect(tested._reconnecting).toBeFalsy();
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
        const PRELOADED_USERS = { "obiwan": { "id": "obiwan" }, "yoda": { "id": "yoda" } };
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
                "luke": { "id": "luke" }
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
        const SAMPLE_CHANNELS = { "jedi": { "id": "jedi" }, "sith": { "id": "sith" } };
        test('should fail receive channels', () => {
            const tested = new Client(SERVER_URL, 'dummy', {});
            tested._onChannels({ error: 'No jedi available' }, null, null);

            expect(Client.prototype.emit).toHaveBeenCalledWith('error', expect.objectContaining({msg: expect.anything()}));
        });

        test('should receive channels', () => {
            const tested = new Client(SERVER_URL, 'dummy', {});
            tested._onChannels([{id: 'jedi'}, {id: 'sith'}], null, null);

            expect(Client.prototype.emit).toHaveBeenCalledWith('channelsLoaded', expect.anything());
            expect(tested.channels).toEqual(SAMPLE_CHANNELS);
        });
    });

    describe('_onPreferences', () => {
        const SAMPLE_PREFERENCES = {
            "user_id": "obiwan",
            "category": "user",
            "name": "Obiwan",
            "value": "Kenobi"
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
            id: "obiwan",
            category: "user",
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
            id: "jedi",
            name: "Light Side",
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
