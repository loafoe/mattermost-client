jest.mock('request');
const requestMock = require('request');
const Client = require('./client');

const SERVER_URL = 'test.foo.bar'

beforeEach(() => {
    jest.clearAllMocks();
});

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