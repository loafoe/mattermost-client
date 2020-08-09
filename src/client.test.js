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

    describe('_onLogin', () => {
        beforeEach(() => {
            Client.prototype.emit = jest.fn();
            Client.prototype.getMe = jest.fn();
            Client.prototype.getPreferences = jest.fn();
            Client.prototype.getTeams = jest.fn();
            Client.prototype.reconnect = jest.fn();
        });

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
});